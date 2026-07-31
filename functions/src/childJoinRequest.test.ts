// ---------------------------------------------------------------------------
// FOCUSED FUNCTIONS TESTS — Child join request with mandatory parent approval
// ---------------------------------------------------------------------------
// These tests exercise the trusted backend logic against an in-memory Firestore
// + Auth mock. They cover the allowed, denied and integrity cases required by
// the child-join spec. They do NOT require the Firebase emulators.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}) as any,
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}));
vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({}) as any,
}));

import {
  submitChildJoinRequestImpl,
  getChildJoinRequestStatusImpl,
  cancelChildJoinRequestImpl,
  approveChildJoinRequestImpl,
  rejectChildJoinRequestImpl,
  purgeExpiredChildJoinRequestsImpl,
  CHILD_JOIN_REQUEST_TTL_MS,
  type ChildJoinContext,
} from './childJoinRequest';
import { signInChildImpl } from './childLogin';

// ---------------------------------------------------------------------------
// In-memory Firestore mock (supports doc/collection/collectionGroup/txn/delete)
// ---------------------------------------------------------------------------

function makeFakeDb() {
  const store = new Map<string, Record<string, unknown>>();

  const applyWrite = (
    path: string,
    data: Record<string, unknown>,
    op: 'set' | 'update' | 'delete',
  ) => {
    if (op === 'set') store.set(path, { ...data });
    else if (op === 'update') store.set(path, { ...(store.get(path) ?? {}), ...data });
    else store.delete(path);
  };

  const snapOf = (path: string) => {
    const data = store.get(path);
    return {
      exists: data !== undefined,
      data: () => data,
      id: path.split('/').pop() as string,
      ref: makeRef(path),
    };
  };

  function makeRef(path: string): any {
    return {
      path,
      id: path.split('/').pop() as string,
      get: async () => snapOf(path),
      set: async (data: Record<string, unknown>) => applyWrite(path, data, 'set'),
      update: async (data: Record<string, unknown>) => applyWrite(path, data, 'update'),
      delete: async () => applyWrite(path, {}, 'delete'),
    };
  }

  const runQuery = (
    matchPath: (key: string) => boolean,
    filters: Array<[string, string, unknown]>,
    max: number,
  ) => {
    const docs = Array.from(store.entries())
      .filter(([key]) => matchPath(key))
      .filter(([, data]) =>
        filters.every(([field, op, value]) => {
          const actual = (data as Record<string, unknown>)[field];
          if (op === '==') return actual === value;
          if (op === '<=') return typeof actual === 'number' && actual <= (value as number);
          throw new Error(`Unsupported fake operator ${op}`);
        }),
      )
      .slice(0, max)
      .map(([key, data]) => ({
        id: key.split('/').pop() as string,
        exists: true,
        data: () => data,
        ref: makeRef(key),
      }));
    return { empty: docs.length === 0, docs, size: docs.length };
  };

  const queryable = (matchPath: (key: string) => boolean) => {
    const build = (filters: Array<[string, string, unknown]>, max: number): any => ({
      where: (field: string, op: string, value: unknown) =>
        build([...filters, [field, op, value]], max),
      limit: (n: number) => build(filters, n),
      get: async () => runQuery(matchPath, filters, max),
    });
    return build([], Number.POSITIVE_INFINITY);
  };

  let idCounter = 0;

  const db: any = {
    store,
    doc: (path: string) => makeRef(path),
    collection: (path: string) => {
      const prefix = `${path}/`;
      const base = queryable(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'));
      return {
        ...base,
        doc: (id?: string) => makeRef(`${path}/${id || `gen-${++idCounter}`}`),
        add: async (data: Record<string, unknown>) => {
          const ref = makeRef(`${path}/gen-${++idCounter}`);
          await ref.set(data);
          return ref;
        },
      };
    },
    collectionGroup: (name: string) =>
      queryable(key => {
        const parts = key.split('/');
        return parts.length >= 2 && parts[parts.length - 2] === name;
      }),
    // Mirrors Firestore's optimistic concurrency: reads are version-checked at
    // commit time and the callback is retried when a read document changed.
    runTransaction: async (cb: (tx: any) => Promise<any>) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const writes: Array<['set' | 'update' | 'delete', string, Record<string, unknown>]> = [];
        const readVersions = new Map<string, string>();
        const version = (path: string) => JSON.stringify(store.get(path) ?? null);
        const tx = {
          get: async (ref: { path: string }) => {
            readVersions.set(ref.path, version(ref.path));
            return snapOf(ref.path);
          },
          set: (ref: { path: string }, data: Record<string, unknown>) => writes.push(['set', ref.path, data]),
          update: (ref: { path: string }, data: Record<string, unknown>) => writes.push(['update', ref.path, data]),
          delete: (ref: { path: string }) => writes.push(['delete', ref.path, {}]),
        };
        const result = await cb(tx);
        let stale = false;
        for (const [path, seen] of readVersions) {
          if (version(path) !== seen) stale = true;
        }
        if (stale) continue;
        for (const [op, path, data] of writes) applyWrite(path, data, op);
        return result;
      }
      throw new Error('TRANSACTION_CONTENTION');
    },
  };
  return db;
}

function makeFakeAuth() {
  const users = new Map<string, Record<string, unknown>>();
  const claims = new Map<string, Record<string, unknown>>();
  const deleted: string[] = [];
  let counter = 0;
  const auth: any = {
    users,
    claims,
    deleted,
    createUser: async (opts: Record<string, unknown>) => {
      for (const u of users.values()) {
        if (u.email === opts.email) {
          const err: any = new Error('email exists');
          err.code = 'auth/email-already-exists';
          throw err;
        }
      }
      const uid = `auth-${++counter}`;
      users.set(uid, { ...opts, uid });
      return { uid };
    },
    updateUser: async (uid: string, opts: Record<string, unknown>) => {
      users.set(uid, { ...(users.get(uid) ?? { uid }), ...opts, uid });
      return { uid };
    },
    setCustomUserClaims: async (uid: string, c: Record<string, unknown>) => {
      claims.set(uid, c);
    },
    getUser: async (uid: string) => {
      const u = users.get(uid);
      if (!u) throw new Error('user-not-found');
      return { uid, disabled: u.disabled === true, email: u.email };
    },
    deleteUser: async (uid: string) => {
      users.delete(uid);
      claims.delete(uid);
      deleted.push(uid);
    },
    createCustomToken: async (uid: string) => `token-for-${uid}`,
  };
  return auth;
}

// ---------------------------------------------------------------------------
// World builder
// ---------------------------------------------------------------------------

const FAMILY_ID = 'fam-1';
const FAMILY_CODE = 'ABC123';
const OTHER_FAMILY_ID = 'fam-2';
const OTHER_FAMILY_CODE = 'ZZZ999';

let currentNow = new Date('2026-01-01T00:00:00.000Z');
let idSeq = 0;
let secretSeq = 0;

function makeCtx(overrides: Partial<ChildJoinContext> = {}): ChildJoinContext & {
  db: any;
  auth: any;
} {
  const db = makeFakeDb();
  const auth = makeFakeAuth();

  db.store.set(`families/${FAMILY_ID}`, { inviteCode: FAMILY_CODE, name: 'Test Family' });
  db.store.set(`families/${OTHER_FAMILY_ID}`, { inviteCode: OTHER_FAMILY_CODE, name: 'Other Family' });
  db.store.set('users/parent-1', { familyId: FAMILY_ID, role: 'parent', displayName: 'Parent One' });
  db.store.set('users/owner-1', { familyId: FAMILY_ID, role: 'owner', displayName: 'Owner One' });
  db.store.set('users/parent-2', { familyId: OTHER_FAMILY_ID, role: 'parent', displayName: 'Other Parent' });
  db.store.set('users/child-1', { familyId: FAMILY_ID, role: 'child', isManaged: true, displayName: 'Kid' });

  return {
    db,
    auth,
    now: () => currentNow,
    generateId: () => `joinreq-${++idSeq}`,
    generateSecret: () => `request-secret-${++secretSeq}`,
    ...overrides,
  } as any;
}

const VALID = { familyCode: FAMILY_CODE, username: 'alex', password: 'secret123' };

beforeEach(() => {
  currentNow = new Date('2026-01-01T00:00:00.000Z');
  idSeq = 0;
  secretSeq = 0;
});

async function submitValid(ctx: any, over: Partial<typeof VALID> = {}) {
  return submitChildJoinRequestImpl(ctx, { ...VALID, ...over }, { ip: '1.2.3.4' });
}

function requestDoc(ctx: any, requestId: string, familyId = FAMILY_ID) {
  return ctx.db.store.get(`families/${familyId}/child_join_requests/${requestId}`);
}

// ===========================================================================
// 1. Child submits a request
// ===========================================================================

describe('submitChildJoinRequest', () => {
  it('creates a pending request for a valid form', async () => {
    const ctx = makeCtx();
    const result = await submitValid(ctx);

    expect(result.status).toBe('pending');
    expect(result.requestId).toBeTruthy();
    expect(result.requestSecret).toBeTruthy();
    expect(result.username).toBe('alex');

    const doc = requestDoc(ctx, result.requestId)!;
    expect(doc.status).toBe('pending');
    expect(doc.normalizedUsername).toBe('alex');
    expect(doc.displayUsername).toBe('alex');
    expect(doc.familyId).toBe(FAMILY_ID);
  });

  it('creates no family membership and no active child identity', async () => {
    const ctx = makeCtx();
    await submitValid(ctx);

    const userDocs = [...ctx.db.store.keys()].filter(k => k.startsWith('users/'));
    // Only the seeded users remain — no new managed child profile.
    expect(userDocs.sort()).toEqual(
      ['users/child-1', 'users/owner-1', 'users/parent-1', 'users/parent-2'].sort(),
    );
    expect([...ctx.db.store.keys()].some(k => k.includes('/childLogins/'))).toBe(false);
    // The provisional Auth user exists but is disabled and unclaimed.
    const authUsers = [...ctx.auth.users.values()];
    expect(authUsers).toHaveLength(1);
    expect(authUsers[0].disabled).toBe(true);
    expect(ctx.auth.claims.size).toBe(0);
  });

  it('reserves the normalized username while pending', async () => {
    const ctx = makeCtx();
    const result = await submitValid(ctx, { username: '  Alex  ' });
    const reservation = ctx.db.store.get(`families/${FAMILY_ID}/childLoginIndex/alex`);
    expect(reservation).toMatchObject({ status: 'reserved', reservedByRequestId: result.requestId });
  });

  it('rejects a duplicate pending request for the same family + username', async () => {
    const ctx = makeCtx();
    await submitValid(ctx);
    await expect(submitValid(ctx)).rejects.toMatchObject({ message: 'USERNAME_TAKEN' });
  });

  it('rejects a normalized username collision (different casing/spacing)', async () => {
    const ctx = makeCtx();
    await submitValid(ctx, { username: 'alex' });
    await expect(submitValid(ctx, { username: '  ALEX ' })).rejects.toMatchObject({
      message: 'USERNAME_TAKEN',
    });
  });

  it('rejects a username already used by an existing child login', async () => {
    const ctx = makeCtx();
    ctx.db.store.set(`families/${FAMILY_ID}/childLoginIndex/alex`, {
      childId: 'child-1',
      normalizedUsername: 'alex',
    });
    await expect(submitValid(ctx)).rejects.toMatchObject({ message: 'USERNAME_TAKEN' });
  });

  it('never writes the plaintext password to Firestore', async () => {
    const ctx = makeCtx();
    await submitValid(ctx);
    const serialized = JSON.stringify([...ctx.db.store.entries()]);
    expect(serialized).not.toContain('secret123');
  });

  it('never returns credential material to the caller', async () => {
    const ctx = makeCtx();
    const result = await submitValid(ctx);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('secret123');
    expect(serialized).not.toContain('@managed.familyquest.app');
    expect(serialized).not.toContain(FAMILY_ID);
  });

  it('returns a generic error for an unknown family code (no existence leak)', async () => {
    const ctx = makeCtx();
    await expect(submitValid(ctx, { familyCode: 'QQQQQQ' })).rejects.toMatchObject({
      message: 'JOIN_REQUEST_FAILED',
    });
  });

  it('returns the same generic error for a malformed family code', async () => {
    const ctx = makeCtx();
    await expect(submitValid(ctx, { familyCode: 'nope' })).rejects.toMatchObject({
      message: 'JOIN_REQUEST_FAILED',
    });
  });

  it('rejects a weak password', async () => {
    const ctx = makeCtx();
    await expect(submitValid(ctx, { password: 'short' })).rejects.toMatchObject({
      message: 'PASSWORD_TOO_SHORT',
    });
  });

  it('rejects an invalid username', async () => {
    const ctx = makeCtx();
    await expect(submitValid(ctx, { username: 'a' })).rejects.toMatchObject({
      message: 'USERNAME_LENGTH',
    });
  });

  it('rate limits repeated attempts', async () => {
    const ctx = makeCtx();
    for (let i = 0; i < 10; i += 1) {
      try {
        await submitChildJoinRequestImpl(
          ctx,
          { ...VALID, username: `user${i}0` },
          { ip: '9.9.9.9' },
        );
      } catch {
        /* ignore individual failures */
      }
    }
    await expect(
      submitChildJoinRequestImpl(ctx, { ...VALID, username: 'lastone' }, { ip: '9.9.9.9' }),
    ).rejects.toMatchObject({ message: 'TOO_MANY_JOIN_REQUESTS' });
  });

  it('sets an expiry consistent with the documented TTL', async () => {
    const ctx = makeCtx();
    const result = await submitValid(ctx);
    expect(result.expiresAt).toBe(currentNow.getTime() + CHILD_JOIN_REQUEST_TTL_MS);
  });
});

// ===========================================================================
// 2. Status polling / cancellation
// ===========================================================================

describe('getChildJoinRequestStatus', () => {
  it('returns the pending status for a valid request secret', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    const status = await getChildJoinRequestStatusImpl(ctx, {
      requestId: submitted.requestId,
      requestSecret: submitted.requestSecret,
    });
    expect(status).toMatchObject({ status: 'pending', username: 'alex' });
  });

  it('denies status reads without the correct secret', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    await expect(
      getChildJoinRequestStatusImpl(ctx, { requestId: submitted.requestId, requestSecret: 'wrong' }),
    ).rejects.toMatchObject({ message: 'JOIN_REQUEST_NOT_FOUND' });
  });

  it('reports expired once the TTL has elapsed', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    currentNow = new Date(currentNow.getTime() + CHILD_JOIN_REQUEST_TTL_MS + 1000);
    const status = await getChildJoinRequestStatusImpl(ctx, {
      requestId: submitted.requestId,
      requestSecret: submitted.requestSecret,
    });
    expect(status.status).toBe('expired');
  });

  it('never exposes family identifiers or credential material', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    const status = await getChildJoinRequestStatusImpl(ctx, {
      requestId: submitted.requestId,
      requestSecret: submitted.requestSecret,
    });
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain(FAMILY_ID);
    expect(serialized).not.toContain(FAMILY_CODE);
    expect(serialized).not.toContain('secret123');
  });
});

describe('cancelChildJoinRequest', () => {
  it('cancels a pending request and releases the reservation', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    const result = await cancelChildJoinRequestImpl(ctx, {
      requestId: submitted.requestId,
      requestSecret: submitted.requestSecret,
    });
    expect(result.status).toBe('cancelled');
    expect(requestDoc(ctx, submitted.requestId)!.status).toBe('cancelled');
    expect(ctx.db.store.get(`families/${FAMILY_ID}/childLoginIndex/alex`)).toBeUndefined();
    expect(ctx.auth.deleted).toHaveLength(1);
  });

  it('allows a fresh request after cancellation', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    await cancelChildJoinRequestImpl(ctx, {
      requestId: submitted.requestId,
      requestSecret: submitted.requestSecret,
    });
    await expect(submitValid(ctx)).resolves.toMatchObject({ status: 'pending' });
  });

  it('refuses cancellation without the secret', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    await expect(
      cancelChildJoinRequestImpl(ctx, { requestId: submitted.requestId, requestSecret: 'nope' }),
    ).rejects.toMatchObject({ message: 'JOIN_REQUEST_NOT_FOUND' });
  });
});

// ===========================================================================
// 3. Parent authorization
// ===========================================================================

describe('parent authorization', () => {
  it('lets a parent in the target family approve', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    const result = await approveChildJoinRequestImpl(ctx, 'parent-1', {
      familyId: FAMILY_ID,
      requestId: submitted.requestId,
    });
    expect(result.status).toBe('approved');
  });

  it('lets an owner in the target family approve', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    await expect(
      approveChildJoinRequestImpl(ctx, 'owner-1', {
        familyId: FAMILY_ID,
        requestId: submitted.requestId,
      }),
    ).resolves.toMatchObject({ status: 'approved' });
  });

  it('lets a parent in the target family reject', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    await expect(
      rejectChildJoinRequestImpl(ctx, 'parent-1', {
        familyId: FAMILY_ID,
        requestId: submitted.requestId,
      }),
    ).resolves.toMatchObject({ status: 'rejected' });
  });

  it('denies a parent from another family', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    await expect(
      approveChildJoinRequestImpl(ctx, 'parent-2', {
        familyId: FAMILY_ID,
        requestId: submitted.requestId,
      }),
    ).rejects.toMatchObject({ message: 'NOT_AUTHORIZED' });
    await expect(
      rejectChildJoinRequestImpl(ctx, 'parent-2', {
        familyId: FAMILY_ID,
        requestId: submitted.requestId,
      }),
    ).rejects.toMatchObject({ message: 'NOT_AUTHORIZED' });
  });

  it('denies a child in the target family', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    await expect(
      approveChildJoinRequestImpl(ctx, 'child-1', {
        familyId: FAMILY_ID,
        requestId: submitted.requestId,
      }),
    ).rejects.toMatchObject({ message: 'NOT_AUTHORIZED' });
  });

  it('denies an unknown caller', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    await expect(
      approveChildJoinRequestImpl(ctx, 'ghost', {
        familyId: FAMILY_ID,
        requestId: submitted.requestId,
      }),
    ).rejects.toMatchObject({ message: 'NOT_AUTHORIZED' });
  });

  it('cannot approve an expired request', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    currentNow = new Date(currentNow.getTime() + CHILD_JOIN_REQUEST_TTL_MS + 1000);
    await expect(
      approveChildJoinRequestImpl(ctx, 'parent-1', {
        familyId: FAMILY_ID,
        requestId: submitted.requestId,
      }),
    ).rejects.toMatchObject({ message: 'REQUEST_EXPIRED' });
    expect(requestDoc(ctx, submitted.requestId)!.status).toBe('expired');
  });

  it('rejects a duplicate approval safely', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    await approveChildJoinRequestImpl(ctx, 'parent-1', {
      familyId: FAMILY_ID,
      requestId: submitted.requestId,
    });
    await expect(
      approveChildJoinRequestImpl(ctx, 'parent-1', {
        familyId: FAMILY_ID,
        requestId: submitted.requestId,
      }),
    ).rejects.toMatchObject({ message: 'REQUEST_NOT_PENDING' });
    const children = [...ctx.db.store.keys()].filter(k =>
      k.startsWith('users/') && (ctx.db.store.get(k) as any).joinRequestId === submitted.requestId,
    );
    expect(children).toHaveLength(1);
  });

  it('cannot approve a cancelled request', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    await cancelChildJoinRequestImpl(ctx, {
      requestId: submitted.requestId,
      requestSecret: submitted.requestSecret,
    });
    await expect(
      approveChildJoinRequestImpl(ctx, 'parent-1', {
        familyId: FAMILY_ID,
        requestId: submitted.requestId,
      }),
    ).rejects.toMatchObject({ message: 'REQUEST_NOT_PENDING' });
  });
});

// ===========================================================================
// 4. Approval result
// ===========================================================================

describe('approval result', () => {
  it('creates the managed-child identity using the existing model', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    const result = await approveChildJoinRequestImpl(ctx, 'parent-1', {
      familyId: FAMILY_ID,
      requestId: submitted.requestId,
    });

    const child = ctx.db.store.get(`users/${result.childId}`) as Record<string, unknown>;
    expect(child).toMatchObject({
      role: 'child',
      familyId: FAMILY_ID,
      isManaged: true,
      hasLogin: true,
      loginEnabled: true,
      username: 'alex',
      requiresPasswordChange: false,
    });
    expect(child.authUid).toBeTruthy();
  });

  it('server-assigns the role and family (never client supplied)', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    const result = await approveChildJoinRequestImpl(ctx, 'parent-1', {
      familyId: FAMILY_ID,
      requestId: submitted.requestId,
    });
    const authUid = (ctx.db.store.get(`users/${result.childId}`) as any).authUid;
    expect(ctx.auth.claims.get(authUid)).toMatchObject({
      role: 'child',
      familyId: FAMILY_ID,
      childId: result.childId,
      managedChild: true,
    });
  });

  it('finalizes the username reservation', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    const result = await approveChildJoinRequestImpl(ctx, 'parent-1', {
      familyId: FAMILY_ID,
      requestId: submitted.requestId,
    });
    const index = ctx.db.store.get(`families/${FAMILY_ID}/childLoginIndex/alex`) as any;
    expect(index).toMatchObject({ childId: result.childId, normalizedUsername: 'alex' });
    expect(index.status).toBeUndefined();
    expect(index.reservedByRequestId).toBeUndefined();
  });

  it('records who approved and when', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    await approveChildJoinRequestImpl(ctx, 'parent-1', {
      familyId: FAMILY_ID,
      requestId: submitted.requestId,
    });
    const doc = requestDoc(ctx, submitted.requestId)!;
    expect(doc.status).toBe('approved');
    expect(doc.resolvedBy).toBe('parent-1');
    expect(doc.resolvedAt).toBeTruthy();
  });

  it('enables the previously disabled Auth user', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    const result = await approveChildJoinRequestImpl(ctx, 'parent-1', {
      familyId: FAMILY_ID,
      requestId: submitted.requestId,
    });
    const authUid = (ctx.db.store.get(`users/${result.childId}`) as any).authUid;
    expect(ctx.auth.users.get(authUid)!.disabled).toBe(false);
  });

  it('lets the approved child sign in with the existing child sign-in flow', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    await approveChildJoinRequestImpl(ctx, 'parent-1', {
      familyId: FAMILY_ID,
      requestId: submitted.requestId,
    });

    const signIn = await signInChildImpl(
      { db: ctx.db as any, auth: ctx.auth as any, verifyPassword: async () => true },
      { familyCode: FAMILY_CODE, username: 'alex', password: 'secret123' },
    );
    expect(signIn.customToken).toMatch(/^token-for-/);
  });

  it('does not expose password-derived material in the parent-readable document', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    await approveChildJoinRequestImpl(ctx, 'parent-1', {
      familyId: FAMILY_ID,
      requestId: submitted.requestId,
    });
    const serialized = JSON.stringify(requestDoc(ctx, submitted.requestId));
    expect(serialized).not.toContain('secret123');
    expect(serialized).not.toContain('@managed.familyquest.app');
    expect(serialized).not.toContain('Hash');
  });
});

// ===========================================================================
// 5. Rejection
// ===========================================================================

describe('rejection', () => {
  it('creates no membership and releases the reservation', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    await rejectChildJoinRequestImpl(ctx, 'parent-1', {
      familyId: FAMILY_ID,
      requestId: submitted.requestId,
    });

    expect(requestDoc(ctx, submitted.requestId)!.status).toBe('rejected');
    expect(ctx.db.store.get(`families/${FAMILY_ID}/childLoginIndex/alex`)).toBeUndefined();
    expect([...ctx.db.store.keys()].filter(k => k.startsWith('users/'))).toHaveLength(4);
    expect(ctx.auth.deleted).toHaveLength(1);
  });

  it('permits a later fresh request with the same username', async () => {
    const ctx = makeCtx();
    const first = await submitValid(ctx);
    await rejectChildJoinRequestImpl(ctx, 'parent-1', {
      familyId: FAMILY_ID,
      requestId: first.requestId,
    });
    await expect(submitValid(ctx)).resolves.toMatchObject({ status: 'pending' });
  });

  it('records the rejecting parent', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    await rejectChildJoinRequestImpl(ctx, 'parent-1', {
      familyId: FAMILY_ID,
      requestId: submitted.requestId,
    });
    expect(requestDoc(ctx, submitted.requestId)!.resolvedBy).toBe('parent-1');
  });
});

// ===========================================================================
// 6. Expiry sweep
// ===========================================================================

describe('purgeExpiredChildJoinRequests', () => {
  it('expires stale pending requests and releases their reservations', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    currentNow = new Date(currentNow.getTime() + CHILD_JOIN_REQUEST_TTL_MS + 1000);

    const result = await purgeExpiredChildJoinRequestsImpl(ctx);
    expect(result.expired).toBe(1);
    expect(requestDoc(ctx, submitted.requestId)!.status).toBe('expired');
    expect(ctx.db.store.get(`families/${FAMILY_ID}/childLoginIndex/alex`)).toBeUndefined();
    expect(ctx.auth.deleted).toHaveLength(1);
  });

  it('leaves fresh pending requests untouched', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    const result = await purgeExpiredChildJoinRequestsImpl(ctx);
    expect(result.expired).toBe(0);
    expect(requestDoc(ctx, submitted.requestId)!.status).toBe('pending');
  });

  it('allows a fresh request after expiry', async () => {
    const ctx = makeCtx();
    await submitValid(ctx);
    currentNow = new Date(currentNow.getTime() + CHILD_JOIN_REQUEST_TTL_MS + 1000);
    await purgeExpiredChildJoinRequestsImpl(ctx);
    await expect(submitValid(ctx)).resolves.toMatchObject({ status: 'pending' });
  });
});

// ===========================================================================
// 7. Concurrency
// ===========================================================================

describe('concurrency', () => {
  it('prevents two concurrent requests from claiming the same username', async () => {
    const ctx = makeCtx();
    const results = await Promise.allSettled([submitValid(ctx), submitValid(ctx)]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    const reservations = [...ctx.db.store.keys()].filter(k =>
      k.startsWith(`families/${FAMILY_ID}/childLoginIndex/`),
    );
    expect(reservations).toHaveLength(1);
  });

  it('prevents two concurrent approvals from creating two children', async () => {
    const ctx = makeCtx();
    const submitted = await submitValid(ctx);
    const results = await Promise.allSettled([
      approveChildJoinRequestImpl(ctx, 'parent-1', {
        familyId: FAMILY_ID,
        requestId: submitted.requestId,
      }),
      approveChildJoinRequestImpl(ctx, 'owner-1', {
        familyId: FAMILY_ID,
        requestId: submitted.requestId,
      }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const created = [...ctx.db.store.entries()].filter(
      ([key, value]) => key.startsWith('users/') && (value as any).joinRequestId === submitted.requestId,
    );
    expect(created).toHaveLength(1);
  });
});
