// ---------------------------------------------------------------------------
// ACCOUNT DELETION — callable tests (commit 7 scope)
// ---------------------------------------------------------------------------
// Covers the four role scenarios, recent-login enforcement, idempotent
// resume, Auth-deleted-last ordering, and the ride-the-family-deletion path.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    delete: () => ({ __delete: true }),
  },
  Timestamp: {
    fromMillis: (ms: number) => ({ __timestampMs: ms, toMillis: () => ms }),
  },
}));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({}),
}));
vi.mock('firebase-admin/functions', () => ({
  getFunctions: () => ({
    taskQueue: () => ({ enqueue: async () => undefined }),
  }),
}));

import { deleteAccountImpl, RECENT_LOGIN_WINDOW_MS } from './accountDeletion';
import { processFamilyDeletionImpl, type FamilyDeletionContext } from './familyDeletion';

// ---------------------------------------------------------------------------
// In-memory mocks (query + dotted update support)
// ---------------------------------------------------------------------------

const DELETE_SENTINEL = JSON.stringify({ __delete: true });
const isDeleteSentinel = (v: unknown) =>
  !!v && typeof v === 'object' && JSON.stringify(v) === DELETE_SENTINEL;

function applyUpdate(existing: Record<string, any>, updates: Record<string, unknown>) {
  const next = { ...existing };
  for (const [key, value] of Object.entries(updates)) {
    if (key.includes('.')) {
      const parts = key.split('.');
      let node = next;
      for (let i = 0; i < parts.length - 1; i += 1) {
        node[parts[i]] = { ...(node[parts[i]] ?? {}) };
        node = node[parts[i]];
      }
      if (isDeleteSentinel(value)) delete node[parts[parts.length - 1]];
      else node[parts[parts.length - 1]] = value;
    } else if (isDeleteSentinel(value)) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
}

function makeFakeDb() {
  const store = new Map<string, Record<string, any>>();
  const makeRef = (path: string): any => ({
    path,
    id: path.split('/').pop() as string,
    get: async () => snapOf(path),
    set: (data: Record<string, unknown>) => { store.set(path, { ...data }); },
    update: (data: Record<string, unknown>) => { store.set(path, applyUpdate(store.get(path) ?? {}, data)); },
    delete: () => { store.delete(path); },
    listCollections: async () => listCollectionsAt(path),
  });
  const snapOf = (path: string) => ({
    exists: store.has(path),
    data: () => store.get(path),
    id: path.split('/').pop(),
    ref: makeRef(path),
  });
  const docsInCollection = (collPath: string) => {
    const segments = collPath.split('/').length;
    const out: any[] = [];
    for (const key of store.keys()) {
      if (key.startsWith(`${collPath}/`) && key.split('/').length === segments + 1) out.push(snapOf(key));
    }
    return out;
  };
  const listCollectionsAt = (docPath: string) => {
    const segments = docPath.split('/').length;
    const ids = new Set<string>();
    for (const key of store.keys()) {
      if (key.startsWith(`${docPath}/`)) ids.add(key.split('/')[segments]);
    }
    return [...ids].map(id => makeQuery(`${docPath}/${id}`, []));
  };
  const makeQuery = (collPath: string, filters: Array<[string, unknown]>): any => ({
    id: collPath.split('/').pop(),
    where: (field: string, _op: string, value: unknown) => makeQuery(collPath, [...filters, [field, value]]),
    limit: (n: number) => ({
      get: async () => {
        const docs = docsInCollection(collPath)
          .filter(snap => filters.every(([f, v]) => (snap.data() as any)?.[f] === v))
          .slice(0, n);
        return { empty: docs.length === 0, docs, size: docs.length };
      },
    }),
    get: async () => {
      const docs = docsInCollection(collPath)
        .filter(snap => filters.every(([f, v]) => (snap.data() as any)?.[f] === v));
      return { empty: docs.length === 0, docs, size: docs.length };
    },
    doc: (id?: string) => makeRef(`${collPath}/${id || Math.random().toString(36).slice(2)}`),
  });
  const makeCollectionGroupQuery = (collectionId: string, filters: Array<[string, unknown]>): any => ({
    where: (field: string, _op: string, value: unknown) =>
      makeCollectionGroupQuery(collectionId, [...filters, [field, value]]),
    limit: (n: number) => ({
      get: async () => {
        const docs = [...store.keys()]
          .filter(path => path.split('/').at(-2) === collectionId)
          .map(path => snapOf(path))
          .filter(snap => filters.every(([field, value]) => (snap.data() as any)?.[field] === value))
          .slice(0, n);
        return { empty: docs.length === 0, docs, size: docs.length };
      },
    }),
  });
  const db: any = {
    store,
    doc: makeRef,
    collection: (path: string) => makeQuery(path, []),
    collectionGroup: (collectionId: string) => makeCollectionGroupQuery(collectionId, []),
    batch: () => {
      const deletions: any[] = [];
      return {
        delete: (ref: any) => { deletions.push(ref); },
        commit: async () => {
          for (const ref of deletions) store.delete(ref.path);
        },
      };
    },
    runTransaction: async (cb: (tx: any) => Promise<any>) => {
      const writes: Array<['set' | 'update' | 'delete', any, Record<string, unknown>]> = [];
      const tx = {
        get: async (ref: any) => snapOf(ref.path),
        set: (ref: any, data: Record<string, unknown>) => { writes.push(['set', ref, data]); },
        update: (ref: any, data: Record<string, unknown>) => { writes.push(['update', ref, data]); },
        delete: (ref: any) => { writes.push(['delete', ref, {}]); },
      };
      const result = await cb(tx);
      for (const [op, ref, data] of writes) {
        if (op === 'set') store.set(ref.path, { ...data });
        else if (op === 'update') store.set(ref.path, applyUpdate(store.get(ref.path) ?? {}, data));
        else store.delete(ref.path);
      }
      return result;
    },
  };
  return db as any;
}

function makeFakeAuth() {
  const users = new Map<string, Record<string, any>>();
  const deleted: string[] = [];
  const revoked: string[] = [];
  const notFound = () => Object.assign(new Error('nf'), { code: 'auth/user-not-found' });
  return {
    users,
    deleted,
    revoked,
    getUser: async (uid: string) => {
      const u = users.get(uid);
      if (!u) throw notFound();
      return { uid, disabled: u.disabled === true, customClaims: u.customClaims ?? {} };
    },
    updateUser: async (uid: string, opts: Record<string, unknown>) => {
      const u = users.get(uid);
      if (!u) throw notFound();
      users.set(uid, { ...u, ...opts });
      return { uid };
    },
    deleteUser: async (uid: string) => {
      if (!users.has(uid)) throw notFound();
      users.delete(uid);
      deleted.push(uid);
    },
    setCustomUserClaims: async (uid: string, claims: Record<string, unknown>) => {
      const u = users.get(uid);
      if (!u) throw notFound();
      users.set(uid, { ...u, customClaims: { ...claims } });
    },
    revokeRefreshTokens: async (uid: string) => { revoked.push(uid); },
  } as any;
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

const FAMILY_ID = 'fam-acct-1';
const NOW = 50_000_000;
const FRESH_AUTH = NOW - 1_000; // authenticated 1s ago

function makeCtx(db: any, auth: any): FamilyDeletionContext & { enqueued: string[] } {
  const enqueued: string[] = [];
  return {
    db,
    auth,
    enqueue: async (familyId: string) => { enqueued.push(familyId); },
    now: () => NOW,
    invocationId: 'acct-test',
    enqueued,
  } as any;
}

let db: any;
let auth: any;
let ctx: ReturnType<typeof makeCtx>;

beforeEach(() => {
  db = makeFakeDb();
  auth = makeFakeAuth();
  ctx = makeCtx(db, auth);
  db.store.set(`families/${FAMILY_ID}`, { name: 'Acct Family', ownerId: 'owner-uid' });
  db.store.set('users/owner-uid', { familyId: FAMILY_ID, role: 'owner', displayName: 'Owner' });
  db.store.set('users/parent-uid', { familyId: FAMILY_ID, role: 'parent', displayName: 'Parent' });
  db.store.set('users/teen-uid', { familyId: FAMILY_ID, role: 'child', displayName: 'Teen' });
  db.store.set('users/managed-uid', { familyId: FAMILY_ID, role: 'child', isManaged: true });
  db.store.set(`families/${FAMILY_ID}/users/parent-uid`, { role: 'parent' });
  db.store.set(`families/${FAMILY_ID}/users/owner-uid`, { role: 'owner' });
  for (const uid of ['owner-uid', 'parent-uid', 'teen-uid']) {
    auth.users.set(uid, { customClaims: { familyId: FAMILY_ID } });
  }
});

// ---------------------------------------------------------------------------

describe('deleteAccountImpl — guards', () => {
  it('requires a recent login within the 5-minute window', async () => {
    await expect(deleteAccountImpl(ctx, 'parent-uid', {}, NOW - RECENT_LOGIN_WINDOW_MS - 1))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'RECENT_LOGIN_REQUIRED' });
    expect(db.store.has('users/parent-uid')).toBe(true);
  });

  it('rejects managed children: parents delete them via the child flow', async () => {
    await expect(deleteAccountImpl(ctx, 'managed-uid', {}, FRESH_AUTH))
      .rejects.toMatchObject({ code: 'permission-denied', message: 'MANAGED_CHILD_ACCOUNT' });
  });
});

describe('deleteAccountImpl — non-owner adult', () => {
  it('removes daily check-in history after family membership was already cleared', async () => {
    db.store.set('users/left-uid', { role: 'parent', displayName: 'Already Left' });
    auth.users.set('left-uid', { customClaims: {} });
    db.store.set(`families/${FAMILY_ID}/daily_checkins/left-checkin`, { userId: 'left-uid' });
    db.store.set(`families/${FAMILY_ID}/daily_checkins/owner-checkin`, { userId: 'owner-uid' });
    db.store.set(`families/${FAMILY_ID}/daily_checkin_skips/left-skip`, { userId: 'left-uid' });
    db.store.set(`families/${FAMILY_ID}/daily_checkin_skips/owner-skip`, { userId: 'owner-uid' });

    const result = await deleteAccountImpl(ctx, 'left-uid', {}, FRESH_AUTH);

    expect(result.status).toBe('completed');
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkins/left-checkin`)).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkin_skips/left-skip`)).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkins/owner-checkin`)).toBe(true);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkin_skips/owner-skip`)).toBe(true);
  });

  it('pages collection-group cleanup until more than 500 records are gone', async () => {
    db.store.set('users/left-uid', { role: 'parent', displayName: 'Already Left' });
    auth.users.set('left-uid', { customClaims: {} });
    for (let index = 0; index < 501; index += 1) {
      db.store.set(`families/${FAMILY_ID}/daily_checkins/checkin-${index}`, { userId: 'left-uid' });
      db.store.set(`families/${FAMILY_ID}/daily_checkin_skips/skip-${index}`, { userId: 'left-uid' });
    }
    db.store.set(`families/${FAMILY_ID}/daily_checkins/owner-checkin`, { userId: 'owner-uid' });
    db.store.set(`families/${FAMILY_ID}/daily_checkin_skips/owner-skip`, { userId: 'owner-uid' });

    await deleteAccountImpl(ctx, 'left-uid', {}, FRESH_AUTH);

    expect([...db.store.values()].some(data => data.userId === 'left-uid')).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkins/owner-checkin`)).toBe(true);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkin_skips/owner-skip`)).toBe(true);
  });

  it('deletes profile, membership projection, claims and Auth (last), preserving the family', async () => {
    db.store.set(`families/${FAMILY_ID}/daily_checkins/parent-checkin`, { userId: 'parent-uid' });
    db.store.set(`families/${FAMILY_ID}/daily_checkins/owner-checkin`, { userId: 'owner-uid' });
    db.store.set(`families/${FAMILY_ID}/daily_checkin_skips/parent-skip`, { userId: 'parent-uid' });
    db.store.set(`families/${FAMILY_ID}/daily_checkin_skips/owner-skip`, { userId: 'owner-uid' });

    const result = await deleteAccountImpl(ctx, 'parent-uid', {}, FRESH_AUTH);
    expect(result.status).toBe('completed');
    expect(db.store.has('users/parent-uid')).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/users/parent-uid`)).toBe(false);
    expect(auth.deleted).toContain('parent-uid');
    expect(auth.revoked).toContain('parent-uid');
    // Family and other members untouched.
    expect(db.store.get(`families/${FAMILY_ID}`).name).toBe('Acct Family');
    expect(db.store.get('users/owner-uid').role).toBe('owner');
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkins/parent-checkin`)).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkin_skips/parent-skip`)).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkins/owner-checkin`)).toBe(true);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkin_skips/owner-skip`)).toBe(true);
  });

  it('a self-registered child adult account can also delete itself', async () => {
    const result = await deleteAccountImpl(ctx, 'teen-uid', {}, FRESH_AUTH);
    expect(result.status).toBe('completed');
    expect(db.store.has('users/teen-uid')).toBe(false);
    expect(auth.deleted).toContain('teen-uid');
  });

  it('is idempotent: retry after profile deletion still deletes the Auth user', async () => {
    db.store.delete('users/parent-uid');
    const result = await deleteAccountImpl(ctx, 'parent-uid', {}, FRESH_AUTH);
    expect(result.status).toBe('completed');
    expect(auth.deleted).toContain('parent-uid');
    const again = await deleteAccountImpl(ctx, 'parent-uid', {}, FRESH_AUTH);
    expect(again.status).toBe('completed');
  });
});

describe('deleteAccountImpl — owner with successor', () => {
  it('transfers ownership to the chosen eligible adult then deletes the owner', async () => {
    db.store.set(`families/${FAMILY_ID}/daily_checkins/owner-checkin`, { userId: 'owner-uid' });
    db.store.set(`families/${FAMILY_ID}/daily_checkins/parent-checkin`, { userId: 'parent-uid' });
    db.store.set(`families/${FAMILY_ID}/daily_checkin_skips/owner-skip`, { userId: 'owner-uid' });
    db.store.set(`families/${FAMILY_ID}/daily_checkin_skips/parent-skip`, { userId: 'parent-uid' });

    const result = await deleteAccountImpl(ctx, 'owner-uid', { successorUid: 'parent-uid' }, FRESH_AUTH);
    expect(result.status).toBe('completed');
    expect(db.store.get('users/parent-uid').role).toBe('owner');
    expect(db.store.get(`families/${FAMILY_ID}`).ownerId).toBe('parent-uid');
    expect(db.store.has('users/owner-uid')).toBe(false);
    expect(auth.deleted).toContain('owner-uid');
    expect(auth.deleted).not.toContain('parent-uid');
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkins/owner-checkin`)).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkin_skips/owner-skip`)).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkins/parent-checkin`)).toBe(true);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkin_skips/parent-skip`)).toBe(true);
  });

  it('cleans the orphaned owner records before completing account deletion', async () => {
    db.store.delete(`families/${FAMILY_ID}`);
    db.store.set(`families/${FAMILY_ID}/daily_checkins/owner-checkin`, { userId: 'owner-uid' });
    db.store.set(`families/${FAMILY_ID}/daily_checkins/parent-checkin`, { userId: 'parent-uid' });
    db.store.set(`families/${FAMILY_ID}/daily_checkin_skips/owner-skip`, { userId: 'owner-uid' });
    db.store.set(`families/${FAMILY_ID}/daily_checkin_skips/parent-skip`, { userId: 'parent-uid' });

    const result = await deleteAccountImpl(ctx, 'owner-uid', {}, FRESH_AUTH);

    expect(result.status).toBe('completed');
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkins/owner-checkin`)).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkin_skips/owner-skip`)).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkins/parent-checkin`)).toBe(true);
    expect(db.store.has(`families/${FAMILY_ID}/daily_checkin_skips/parent-skip`)).toBe(true);
  });

  it('requires the successor when eligible adults exist', async () => {
    await expect(deleteAccountImpl(ctx, 'owner-uid', {}, FRESH_AUTH))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'SUCCESSOR_REQUIRED' });
    expect(db.store.get('users/owner-uid').role).toBe('owner');
  });

  it.each([
    ['a child', 'teen-uid'],
    ['a managed child', 'managed-uid'],
    ['an outsider', 'stranger-uid'],
  ])('rejects %s as successor', async (_label, uid) => {
    db.store.set('users/stranger-uid', { familyId: 'other-family', role: 'parent' });
    await expect(deleteAccountImpl(ctx, 'owner-uid', { successorUid: uid }, FRESH_AUTH))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'SUCCESSOR_NOT_ELIGIBLE' });
  });
});

describe('deleteAccountImpl — sole owner (family deletion cascade)', () => {
  beforeEach(() => {
    // Remove the other eligible adult; only managed/self-registered children remain.
    db.store.delete('users/parent-uid');
    db.store.delete(`families/${FAMILY_ID}/users/parent-uid`);
  });

  it('requires the exact family-name confirmation before cascading', async () => {
    await expect(deleteAccountImpl(ctx, 'owner-uid', {}, FRESH_AUTH))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'FAMILY_DELETION_CONFIRMATION_REQUIRED' });
    await expect(deleteAccountImpl(ctx, 'owner-uid', { familyNameConfirmation: 'acct family' }, FRESH_AUTH))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('freezes the family, queues deletion, and registers the riding account job', async () => {
    const result = await deleteAccountImpl(
      ctx, 'owner-uid', { familyNameConfirmation: 'Acct Family' }, FRESH_AUTH,
    );
    expect(result.status).toBe('pending_family_deletion');
    expect(db.store.get(`families/${FAMILY_ID}`).lifecycleState).toBe('deleting');
    expect(db.store.get(`familyDeletionJobs/${FAMILY_ID}`).state).toBe('queued');
    expect(db.store.get('accountDeletionJobs/owner-uid').familyId).toBe(FAMILY_ID);
    expect(ctx.enqueued).toEqual([FAMILY_ID]);
    // Nothing deleted yet; the worker owns the cascade.
    expect(db.store.has('users/owner-uid')).toBe(true);
    expect(auth.deleted).toEqual([]);
  });

  it('the family-deletion worker completes the riding account purge (Auth last)', async () => {
    await deleteAccountImpl(ctx, 'owner-uid', { familyNameConfirmation: 'Acct Family' }, FRESH_AUTH);
    const workerResult = await processFamilyDeletionImpl(ctx, FAMILY_ID);
    expect(workerResult.done).toBe(true);
    expect(db.store.has(`families/${FAMILY_ID}`)).toBe(false);
    expect(db.store.has('users/owner-uid')).toBe(false);
    expect(db.store.has('accountDeletionJobs/owner-uid')).toBe(false);
    expect(auth.deleted).toContain('owner-uid');
    // Repeated deleteAccount call after completion is a stable no-op success.
    const resume = await deleteAccountImpl(ctx, 'owner-uid', {}, FRESH_AUTH);
    expect(resume.status).toBe('completed');
  });

  it('joins an already-running family deletion instead of starting a duplicate', async () => {
    db.store.get(`families/${FAMILY_ID}`).lifecycleState = 'deleting';
    db.store.set(`familyDeletionJobs/${FAMILY_ID}`, { state: 'running', familyId: FAMILY_ID });
    const result = await deleteAccountImpl(ctx, 'owner-uid', {}, FRESH_AUTH);
    expect(result.status).toBe('pending_family_deletion');
    expect(db.store.get('accountDeletionJobs/owner-uid').uid).toBe('owner-uid');
    expect(ctx.enqueued).toEqual([]);
  });
});
