// ---------------------------------------------------------------------------
// FAMILY DELETION — worker / lease / recovery tests (commit 4 scope)
// ---------------------------------------------------------------------------
// Exercises processFamilyDeletionImpl and recoverFamilyDeletionJobsImpl
// against an in-memory Firestore mock with query, dotted-path update and
// listCollections support. Covers the spec's phase runner requirements:
// full happy path, idempotent re-run, lease exclusion and takeover,
// retry_wait gating, linkage hard-fail, transient retry with backoff,
// attempt exhaustion, and recovery scheduler eligibility.
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

import {
  processFamilyDeletionImpl,
  recoverFamilyDeletionJobsImpl,
  type FamilyDeletionContext,
  type FamilyDeletionJob,
} from './familyDeletion';

// ---------------------------------------------------------------------------
// In-memory Firestore mock with queries + dotted updates + listCollections
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

  // Every numeric leaseExpiresAt write to a job document, tagged with the
  // phase the job was in at the time, so tests can prove in-phase renewal.
  const leaseWrites: Array<{ phase: string; leaseExpiresAt: number }> = [];
  const recordLease = (path: string, data: Record<string, unknown>) => {
    if (!path.startsWith('familyDeletionJobs/')) return;
    const value = data.leaseExpiresAt;
    if (typeof value !== 'number') return;
    leaseWrites.push({ phase: (store.get(path)?.phase ?? 'unknown') as string, leaseExpiresAt: value });
  };

  const makeRef = (path: string): any => ({
    path,
    id: path.split('/').pop() as string,
    get: async () => snapOf(path),
    set: (data: Record<string, unknown>) => { store.set(path, { ...data }); },
    update: (data: Record<string, unknown>) => {
      recordLease(path, data);
      store.set(path, applyUpdate(store.get(path) ?? {}, data));
    },
    delete: () => { store.delete(path); },
    listCollections: async () => listCollectionsAt(path),
  });

  const snapOf = (path: string) => {
    const data = store.get(path);
    return {
      exists: data !== undefined,
      data: () => data,
      id: path.split('/').pop(),
      ref: makeRef(path),
    };
  };

  const docsInCollection = (collPath: string) => {
    const segments = collPath.split('/').length;
    const out: Array<ReturnType<typeof snapOf>> = [];
    for (const key of store.keys()) {
      if (key.startsWith(`${collPath}/`) && key.split('/').length === segments + 1) {
        out.push(snapOf(key));
      }
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
    path: collPath,
    where: (field: string, _op: string, value: unknown) =>
      makeQuery(collPath, [...filters, [field, value]]),
    limit: (n: number) => makeQuery(collPath, filters).__withLimit(n),
    __withLimit: (n: number) => ({
      get: async () => {
        const docs = docsInCollection(collPath)
          .filter(snap => filters.every(([field, value]) => (snap.data() as any)?.[field] === value))
          .slice(0, n);
        return { empty: docs.length === 0, docs, size: docs.length };
      },
    }),
    get: async () => {
      const docs = docsInCollection(collPath)
        .filter(snap => filters.every(([field, value]) => (snap.data() as any)?.[field] === value));
      return { empty: docs.length === 0, docs, size: docs.length };
    },
    doc: (id?: string) => makeRef(`${collPath}/${id || Math.random().toString(36).slice(2)}`),
  });

  // Every committed transaction records its write operations so tests can
  // assert atomic grouping (e.g. receipt + family delete in one transaction).
  const txLog: Array<Array<string>> = [];

  const db: any = {
    store,
    txLog,
    leaseWrites,
    doc: makeRef,
    collection: (path: string) => makeQuery(path, []),
    runTransaction: async (cb: (tx: any) => Promise<any>) => {
      const writes: Array<['set' | 'update' | 'delete', any, Record<string, unknown>]> = [];
      const tx = {
        get: async (ref: any) => snapOf(ref.path),
        set: (ref: any, data: Record<string, unknown>) => { writes.push(['set', ref, data]); },
        update: (ref: any, data: Record<string, unknown>) => { writes.push(['update', ref, data]); },
        delete: (ref: any) => { writes.push(['delete', ref, {}]); },
      };
      const result = await cb(tx);
      txLog.push(writes.map(([op, ref]) => `${op} ${ref.path}`));
      for (const [op, ref, data] of writes) {
        if (op === 'set') store.set(ref.path, { ...data });
        else if (op === 'update') {
          recordLease(ref.path, data);
          store.set(ref.path, applyUpdate(store.get(ref.path) ?? {}, data));
        }
        else store.delete(ref.path);
      }
      return result;
    },
  };
  return db as any;
}

// ---------------------------------------------------------------------------
// In-memory Auth mock
// ---------------------------------------------------------------------------

function makeFakeAuth() {
  const users = new Map<string, Record<string, any>>();
  const deleted: string[] = [];
  const revoked: string[] = [];
  const disabled: string[] = [];

  const notFound = () => Object.assign(new Error('user not found'), { code: 'auth/user-not-found' });

  const auth: any = {
    users,
    deleted,
    revoked,
    disabledLog: disabled,
    getUser: async (uid: string) => {
      const u = users.get(uid);
      if (!u) throw notFound();
      return { uid, disabled: u.disabled === true, customClaims: u.customClaims ?? {} };
    },
    updateUser: async (uid: string, opts: Record<string, unknown>) => {
      const u = users.get(uid);
      if (!u) throw notFound();
      users.set(uid, { ...u, ...opts });
      if (opts.disabled === true) disabled.push(uid);
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
  };
  return auth as any;
}

// ---------------------------------------------------------------------------
// World builder
// ---------------------------------------------------------------------------

const FAMILY_ID = 'fam-worker-1';
const NOW = 10_000_000;

function makeCtx(db: any, auth: any, overrides: Partial<FamilyDeletionContext> = {}): FamilyDeletionContext & { enqueued: string[] } {
  const enqueued: string[] = [];
  return {
    db,
    auth,
    enqueue: async (familyId: string) => { enqueued.push(familyId); },
    now: () => NOW,
    invocationId: 'worker-A',
    enqueued,
    ...overrides,
  } as any;
}

function makeJob(overrides: Partial<FamilyDeletionJob> = {}): FamilyDeletionJob {
  return {
    schemaVersion: 1,
    familyId: FAMILY_ID,
    clientReqId: 'seed-req-00000001',
    requestedBy: 'owner-uid',
    state: 'queued',
    phase: 'inventory_members',
    attemptCount: 0,
    phaseAttemptCount: 0,
    leaseOwner: null,
    leaseExpiresAt: null,
    nextAttemptAt: null,
    createdAt: { __serverTimestamp: true },
    startedAt: null,
    updatedAt: { __serverTimestamp: true },
    lastErrorCode: null,
    lastErrorAt: null,
    progress: {
      processedMembers: 0,
      deletedManagedIdentities: 0,
      clearedSelfRegisteredProfiles: 0,
      deletedExternalRecords: 0,
      deletedFamilyDocuments: 0,
    },
    ...overrides,
  };
}

function seedWorld(db: any, auth: any) {
  db.store.set(`families/${FAMILY_ID}`, {
    name: 'Worker Family',
    lifecycleState: 'deleting',
    deletionJobId: FAMILY_ID,
    deletionRequestedBy: 'owner-uid',
  });
  db.store.set(`familyDeletionJobs/${FAMILY_ID}`, makeJob());

  // Self-registered owner and parent (profiles preserved, family fields cleared).
  // Seeded with the REAL profile schema (R2): rewardPoints/lifetimeXP/streaks/
  // wallet mirror/join linkage/last*TxId markers.
  db.store.set('users/owner-uid', {
    uid: 'owner-uid', familyId: FAMILY_ID, role: 'owner', displayName: 'Owner',
    email: 'o@example.com', avatarUrl: 'https://avatar/owner', avatarId: 'starter-cat',
    rewardPoints: 120, lifetimeXP: 4200, currentStreak: 3, longestStreak: 9,
    lastActiveDate: 'ts', walletBalance: 550, joinRequestId: 'jr-1',
    lastGoalTxId: 'tx-goal', lastManualTxId: 'tx-manual', lastTransferTxId: 'tx-transfer',
    lastTransferReqId: 'req-transfer', lastPenaltyTxId: 'tx-penalty',
    lastFundTxId: 'tx-fund', lastBehaviourEventId: 'ev-1', lastRedemptionId: 'red-1',
    lastReversalId: 'rev-1',
  });
  auth.users.set('owner-uid', { customClaims: { familyId: FAMILY_ID, role: 'owner' } });
  db.store.set('users/parent-uid', { familyId: FAMILY_ID, role: 'parent', displayName: 'Parent' });
  auth.users.set('parent-uid', { customClaims: { familyId: FAMILY_ID, role: 'parent' } });

  // Managed child WITH a provisioned login (all links agree).
  db.store.set('users/child-login', {
    familyId: FAMILY_ID, role: 'child', isManaged: true, hasLogin: true, authUid: 'auth-child-1',
  });
  db.store.set(`families/${FAMILY_ID}/childLogins/child-login`, { authUid: 'auth-child-1' });
  auth.users.set('auth-child-1', {
    customClaims: { managedChild: true, childId: 'child-login', familyId: FAMILY_ID, role: 'child' },
  });

  // Managed child WITHOUT a login (profile only).
  db.store.set('users/child-plain', { familyId: FAMILY_ID, role: 'child', isManaged: true });

  // Family subcollection documents.
  db.store.set(`families/${FAMILY_ID}/tasks/t1`, { title: 'Task 1' });
  db.store.set(`families/${FAMILY_ID}/wallets/w1`, { balance: 100 });
  db.store.set(`families/${FAMILY_ID}/savings_goals/g1`, { name: 'Bike' });
  db.store.set(`families/${FAMILY_ID}/savings_goals/g1/contributions/c1`, { amount: 5 });

  // External references.
  db.store.set('familyMembershipIdempotency/idem1', { familyId: FAMILY_ID });
  db.store.set('task_occurrences/occ1', { familyId: FAMILY_ID });
  db.store.set('gamification_events/ev1', { familyId: FAMILY_ID });

  // Unrelated data that must survive.
  db.store.set('users/stranger-uid', { familyId: 'other-family', role: 'owner' });
  db.store.set('task_occurrences/occ-other', { familyId: 'other-family' });
  db.store.set('families/other-family', { name: 'Other' });
}

let db: any;
let auth: any;
let ctx: ReturnType<typeof makeCtx>;

beforeEach(() => {
  db = makeFakeDb();
  auth = makeFakeAuth();
  ctx = makeCtx(db, auth);
  seedWorld(db, auth);
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('processFamilyDeletionImpl — full run', () => {
  it('runs all phases to completion, deleting the family document last', async () => {
    const result = await processFamilyDeletionImpl(ctx, FAMILY_ID);
    expect(result.done).toBe(true);
    expect(result.state).toBe('completed');

    // Family document, job, subcollections and external refs all gone.
    expect(db.store.has(`families/${FAMILY_ID}`)).toBe(false);
    expect(db.store.has(`familyDeletionJobs/${FAMILY_ID}`)).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/tasks/t1`)).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/wallets/w1`)).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/savings_goals/g1`)).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/savings_goals/g1/contributions/c1`)).toBe(false);
    expect(db.store.has(`families/${FAMILY_ID}/childLogins/child-login`)).toBe(false);
    expect(db.store.has('familyMembershipIdempotency/idem1')).toBe(false);
    expect(db.store.has('task_occurrences/occ1')).toBe(false);
    expect(db.store.has('gamification_events/ev1')).toBe(false);

    // Durable receipt written with the spec schema only (R3).
    const receipt = db.store.get(`familyDeletionReceipts/${FAMILY_ID}`);
    expect(receipt).toBeDefined();
    expect(Object.keys(receipt).sort()).toEqual([
      'completedAt', 'expiresAt', 'familyId', 'outcome', 'requestedBy', 'schemaVersion', 'startedAt',
    ]);
    expect(receipt.familyId).toBe(FAMILY_ID);
    expect(receipt.schemaVersion).toBe(1);
    expect(receipt.requestedBy).toBe('owner-uid');
    expect(receipt.outcome).toBe('completed');
    expect(receipt.startedAt).toBeDefined();
    expect(receipt.completedAt).toBeDefined();
    // expiresAt is a Timestamp 30 days after completion, never a raw number.
    expect(typeof receipt.expiresAt).toBe('object');
    expect(receipt.expiresAt.toMillis()).toBe(NOW + 30 * 24 * 60 * 60 * 1000);
    expect(receipt.progress).toBeUndefined();
    expect(receipt.expiresAtMs).toBeUndefined();
    expect(JSON.stringify(receipt)).not.toContain('Worker Family');

    // Managed identities removed; self-registered accounts preserved.
    expect(auth.deleted).toContain('auth-child-1');
    expect(auth.disabledLog).toContain('auth-child-1');
    expect(db.store.has('users/child-login')).toBe(false);
    expect(db.store.has('users/child-plain')).toBe(false);
    expect(db.store.has('users/owner-uid')).toBe(true);
    expect(db.store.has('users/parent-uid')).toBe(true);

    // Self-registered profiles keep identity but lose family linkage and every
    // real family-scoped field (R2).
    const owner = db.store.get('users/owner-uid');
    expect(owner.displayName).toBe('Owner');
    expect(owner.email).toBe('o@example.com');
    expect(owner.uid).toBe('owner-uid');
    expect(owner.avatarUrl).toBe('https://avatar/owner');
    expect(owner.avatarId).toBe('starter-cat');
    for (const field of [
      'familyId', 'role', 'rewardPoints', 'lifetimeXP', 'currentStreak', 'longestStreak',
      'lastActiveDate', 'walletBalance', 'joinRequestId', 'lastGoalTxId', 'lastManualTxId',
      'lastTransferTxId', 'lastTransferReqId', 'lastPenaltyTxId', 'lastFundTxId',
      'lastBehaviourEventId', 'lastRedemptionId', 'lastReversalId',
    ]) {
      expect(owner[field], `expected ${field} to be cleared`).toBeUndefined();
    }

    // Claims stripped and refresh tokens revoked for real accounts.
    expect(auth.users.get('owner-uid').customClaims).toEqual({});
    expect(auth.users.get('parent-uid').customClaims).toEqual({});
    expect(auth.revoked).toContain('owner-uid');
    expect(auth.revoked).toContain('parent-uid');

    // Unrelated data untouched.
    expect(db.store.get('users/stranger-uid').familyId).toBe('other-family');
    expect(db.store.has('task_occurrences/occ-other')).toBe(true);
    expect(db.store.has('families/other-family')).toBe(true);
  });

  it('is idempotent: re-processing after completion changes nothing', async () => {
    await processFamilyDeletionImpl(ctx, FAMILY_ID);
    const before = new Map(db.store);
    const again = await processFamilyDeletionImpl(makeCtx(db, auth), FAMILY_ID);
    expect(again.done).toBe(false); // job gone; nothing to do, no resurrection
    expect(db.store).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Lease semantics
// ---------------------------------------------------------------------------

describe('processFamilyDeletionImpl — leases and gating', () => {
  it('exits without touching a job whose lease is held and unexpired', async () => {
    db.store.set(`familyDeletionJobs/${FAMILY_ID}`, makeJob({
      state: 'running', leaseOwner: 'worker-B', leaseExpiresAt: NOW + 60_000,
    }));
    const result = await processFamilyDeletionImpl(ctx, FAMILY_ID);
    expect(result.done).toBe(false);
    const job = db.store.get(`familyDeletionJobs/${FAMILY_ID}`);
    expect(job.leaseOwner).toBe('worker-B');
    expect(db.store.has(`families/${FAMILY_ID}`)).toBe(true);
  });

  it('takes over an expired lease and completes the deletion', async () => {
    db.store.set(`familyDeletionJobs/${FAMILY_ID}`, makeJob({
      state: 'running', leaseOwner: 'worker-dead', leaseExpiresAt: NOW - 1,
    }));
    const result = await processFamilyDeletionImpl(ctx, FAMILY_ID);
    expect(result.done).toBe(true);
    expect(db.store.has(`families/${FAMILY_ID}`)).toBe(false);
  });

  it('respects retry_wait until nextAttemptAt elapses', async () => {
    db.store.set(`familyDeletionJobs/${FAMILY_ID}`, makeJob({
      state: 'retry_wait', nextAttemptAt: NOW + 5_000,
    }));
    const result = await processFamilyDeletionImpl(ctx, FAMILY_ID);
    expect(result.done).toBe(false);
    expect(db.store.get(`familyDeletionJobs/${FAMILY_ID}`).state).toBe('retry_wait');
  });

  it('does not touch a failed job (explicit retry required)', async () => {
    db.store.set(`familyDeletionJobs/${FAMILY_ID}`, makeJob({ state: 'failed', lastErrorCode: 'TRANSIENT' }));
    const result = await processFamilyDeletionImpl(ctx, FAMILY_ID);
    expect(result.done).toBe(false);
    expect(db.store.get(`familyDeletionJobs/${FAMILY_ID}`).state).toBe('failed');
    expect(db.store.has(`families/${FAMILY_ID}`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

describe('processFamilyDeletionImpl — errors', () => {
  it('hard-fails with IDENTITY_LINKAGE_ERROR when managed linkage disagrees', async () => {
    // Provisioned child missing its private login record.
    db.store.delete(`families/${FAMILY_ID}/childLogins/child-login`);
    const result = await processFamilyDeletionImpl(ctx, FAMILY_ID);
    expect(result.done).toBe(false);
    const job = db.store.get(`familyDeletionJobs/${FAMILY_ID}`);
    expect(job.state).toBe('failed');
    expect(job.lastErrorCode).toBe('IDENTITY_LINKAGE_ERROR');
    // Nothing irreversible: family doc and auth user survive.
    expect(db.store.has(`families/${FAMILY_ID}`)).toBe(true);
    expect(auth.users.has('auth-child-1')).toBe(true);
  });

  it('schedules retry_wait with backoff on a transient failure', async () => {
    const original = auth.deleteUser;
    auth.deleteUser = async () => { throw new Error('deadline exceeded'); };
    const result = await processFamilyDeletionImpl(ctx, FAMILY_ID);
    auth.deleteUser = original;
    expect(result.done).toBe(false);
    const job = db.store.get(`familyDeletionJobs/${FAMILY_ID}`);
    expect(job.state).toBe('retry_wait');
    expect(job.lastErrorCode).toBe('TRANSIENT');
    expect(job.nextAttemptAt).toBeGreaterThan(NOW);
    expect(job.leaseOwner).toBeNull();
  });

  it('hard-fails after automatic attempts are exhausted', async () => {
    db.store.set(`familyDeletionJobs/${FAMILY_ID}`, makeJob({ attemptCount: 8 }));
    auth.deleteUser = async () => { throw new Error('deadline exceeded'); };
    await processFamilyDeletionImpl(ctx, FAMILY_ID);
    const job = db.store.get(`familyDeletionJobs/${FAMILY_ID}`);
    expect(job.state).toBe('failed');
    expect(job.nextAttemptAt).toBeNull();
  });

  it('a transient failure then a clean re-run completes without duplicate work', async () => {
    let failOnce = true;
    const original = auth.deleteUser.bind(auth);
    auth.deleteUser = async (uid: string) => {
      if (failOnce) { failOnce = false; throw new Error('unavailable'); }
      return original(uid);
    };
    await processFamilyDeletionImpl(ctx, FAMILY_ID);
    expect(db.store.get(`familyDeletionJobs/${FAMILY_ID}`).state).toBe('retry_wait');

    const laterCtx = makeCtx(db, auth, { now: () => NOW + 60 * 60 * 1000, invocationId: 'worker-B' } as any);
    const result = await processFamilyDeletionImpl(laterCtx, FAMILY_ID);
    expect(result.done).toBe(true);
    expect(auth.deleted.filter((u: string) => u === 'auth-child-1').length).toBe(1);
    expect(db.store.has(`families/${FAMILY_ID}`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// In-phase lease renewal (R5)
// ---------------------------------------------------------------------------

function seedRevokePhase(members: string[]) {
  db.store.clear();
  db.store.set(`families/${FAMILY_ID}`, { name: 'Worker Family', lifecycleState: 'deleting' });
  db.store.set(`familyDeletionJobs/${FAMILY_ID}`, makeJob({ phase: 'revoke_member_access' }));
  for (const uid of members) {
    db.store.set(`users/${uid}`, { familyId: FAMILY_ID, role: 'parent', displayName: uid });
    auth.users.set(uid, { customClaims: { familyId: FAMILY_ID, role: 'parent' } });
  }
}

describe('lease renewal inside long phases', () => {
  it('advances leaseExpiresAt between members, not only at phase boundaries', async () => {
    seedRevokePhase(['m1', 'm2', 'm3']);
    let clock = NOW;
    const clockCtx = makeCtx(db, auth, { now: () => (clock += 1_000) } as any);
    await processFamilyDeletionImpl(clockCtx, FAMILY_ID);

    const inPhase = db.leaseWrites.filter((w: any) => w.phase === 'revoke_member_access');
    // One write per member plus the phase-boundary write.
    expect(inPhase.length).toBeGreaterThanOrEqual(4);
    const values = inPhase.map((w: any) => w.leaseExpiresAt);
    expect([...values].sort((a: number, b: number) => a - b)).toEqual(values);
  });

  it('never resurrects a lease taken over by another worker', async () => {
    seedRevokePhase(['m1', 'm2', 'm3']);
    const takeoverExpiry = NOW + 10 * 60 * 1000;
    let calls = 0;
    const original = auth.revokeRefreshTokens.bind(auth);
    auth.revokeRefreshTokens = async (uid: string) => {
      calls += 1;
      if (calls === 1) {
        // A recovery worker takes the job over mid-phase.
        const job = db.store.get(`familyDeletionJobs/${FAMILY_ID}`);
        db.store.set(`familyDeletionJobs/${FAMILY_ID}`, {
          ...job, leaseOwner: 'worker-B', leaseExpiresAt: takeoverExpiry,
        });
      }
      return original(uid);
    };

    await processFamilyDeletionImpl(ctx, FAMILY_ID);

    const job = db.store.get(`familyDeletionJobs/${FAMILY_ID}`);
    expect(job.leaseOwner).toBe('worker-B');
    expect(job.leaseExpiresAt).toBe(takeoverExpiry);
  });
});

// ---------------------------------------------------------------------------
// Finalize atomicity (R4)
// ---------------------------------------------------------------------------

/** Seed a job that is already positioned at the finalize phase. */
function seedFinalizeOnly() {
  db.store.clear();
  db.store.set(`families/${FAMILY_ID}`, { name: 'Worker Family', lifecycleState: 'deleting' });
  db.store.set(`familyDeletionJobs/${FAMILY_ID}`, makeJob({ phase: 'finalize' }));
}

describe('finalize — transactional completion', () => {
  it('writes the receipt and deletes the family document in a single transaction', async () => {
    seedFinalizeOnly();
    const result = await processFamilyDeletionImpl(ctx, FAMILY_ID);
    expect(result.state).toBe('completed');
    const atomic = db.txLog.find((writes: string[]) =>
      writes.includes(`set familyDeletionReceipts/${FAMILY_ID}`)
      && writes.includes(`delete families/${FAMILY_ID}`));
    expect(atomic, 'receipt and family delete must commit together').toBeDefined();
    // The job document is removed by a separate best-effort write.
    expect(db.store.has(`familyDeletionJobs/${FAMILY_ID}`)).toBe(false);
    expect(atomic).not.toContain(`delete familyDeletionJobs/${FAMILY_ID}`);
  });

  it('treats an existing receipt as success without rewriting it', async () => {
    seedFinalizeOnly();
    db.store.delete(`families/${FAMILY_ID}`);
    db.store.set(`familyDeletionReceipts/${FAMILY_ID}`, {
      schemaVersion: 1, familyId: FAMILY_ID, requestedBy: 'owner-uid',
      startedAt: 'earlier', completedAt: 'earlier', outcome: 'completed',
      expiresAt: { __timestampMs: 1 },
    });
    const result = await processFamilyDeletionImpl(ctx, FAMILY_ID);
    expect(result.state).toBe('completed');
    expect(db.store.get(`familyDeletionReceipts/${FAMILY_ID}`).completedAt).toBe('earlier');
    expect(db.store.has(`familyDeletionJobs/${FAMILY_ID}`)).toBe(false);
  });

  it('hard-fails with INVARIANT_VIOLATION when family and receipt are both missing', async () => {
    seedFinalizeOnly();
    db.store.delete(`families/${FAMILY_ID}`);
    await processFamilyDeletionImpl(ctx, FAMILY_ID);
    const job = db.store.get(`familyDeletionJobs/${FAMILY_ID}`);
    expect(job.state).toBe('failed');
    expect(job.lastErrorCode).toBe('INVARIANT_VIOLATION');
    expect(job.nextAttemptAt).toBeNull();
    expect(db.store.has(`familyDeletionReceipts/${FAMILY_ID}`)).toBe(false);
  });

  it('retains the accountDeletionJobs purge required by the account-deletion contract (D8)', async () => {
    seedFinalizeOnly();
    db.store.set('users/rider-uid', { familyId: FAMILY_ID, role: 'owner' });
    db.store.set('accountDeletionJobs/rider-uid', { familyId: FAMILY_ID });
    auth.users.set('rider-uid', { customClaims: {} });
    await processFamilyDeletionImpl(ctx, FAMILY_ID);
    expect(db.store.has('users/rider-uid')).toBe(false);
    expect(db.store.has('accountDeletionJobs/rider-uid')).toBe(false);
    expect(auth.deleted).toContain('rider-uid');
  });
});

// ---------------------------------------------------------------------------
// Recovery scheduler
// ---------------------------------------------------------------------------

describe('recoverFamilyDeletionJobsImpl', () => {
  it('re-enqueues queued, elapsed retry_wait and expired-lease jobs only', async () => {
    db.store.clear();
    db.store.set('familyDeletionJobs/f-queued', makeJob({ familyId: 'f-queued', state: 'queued' }));
    db.store.set('familyDeletionJobs/f-elapsed', makeJob({ familyId: 'f-elapsed', state: 'retry_wait', nextAttemptAt: NOW - 1 }));
    db.store.set('familyDeletionJobs/f-waiting', makeJob({ familyId: 'f-waiting', state: 'retry_wait', nextAttemptAt: NOW + 60_000 }));
    db.store.set('familyDeletionJobs/f-expired', makeJob({ familyId: 'f-expired', state: 'running', leaseOwner: 'x', leaseExpiresAt: NOW - 1 }));
    db.store.set('familyDeletionJobs/f-leased', makeJob({ familyId: 'f-leased', state: 'running', leaseOwner: 'x', leaseExpiresAt: NOW + 60_000 }));
    db.store.set('familyDeletionJobs/f-failed', makeJob({ familyId: 'f-failed', state: 'failed' }));

    const count = await recoverFamilyDeletionJobsImpl(ctx);
    expect(count).toBe(3);
    expect(ctx.enqueued.sort()).toEqual(['f-elapsed', 'f-expired', 'f-queued']);
  });

  it('returns zero when there are no jobs', async () => {
    db.store.clear();
    expect(await recoverFamilyDeletionJobsImpl(ctx)).toBe(0);
  });
});
