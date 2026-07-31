// ---------------------------------------------------------------------------
// LEAVE FAMILY — callable tests (commit 5 scope)
// ---------------------------------------------------------------------------
// Exercises leaveFamilyImpl: non-owner self-registered departure, owner and
// managed-child refusals, deleting-family freeze, idempotent retry, claim
// stripping and refresh-token revocation.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({}),
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    delete: () => ({ __delete: true }),
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

import { leaveFamilyImpl, type FamilyDeletionContext } from './familyDeletion';

const DELETE_SENTINEL = JSON.stringify({ __delete: true });
const isDeleteSentinel = (v: unknown) =>
  !!v && typeof v === 'object' && JSON.stringify(v) === DELETE_SENTINEL;

function applyUpdate(existing: Record<string, any>, updates: Record<string, unknown>) {
  const next = { ...existing };
  for (const [key, value] of Object.entries(updates)) {
    if (isDeleteSentinel(value)) delete next[key];
    else next[key] = value;
  }
  return next;
}

function makeFakeDb() {
  const store = new Map<string, Record<string, any>>();
  const makeRef = (path: string): any => ({
    path,
    id: path.split('/').pop() as string,
    get: async () => ({
      exists: store.has(path),
      data: () => store.get(path),
      id: path.split('/').pop(),
    }),
    set: (data: Record<string, unknown>) => { store.set(path, { ...data }); },
    update: (data: Record<string, unknown>) => { store.set(path, applyUpdate(store.get(path) ?? {}, data)); },
    delete: () => { store.delete(path); },
  });
  const db: any = {
    store,
    doc: makeRef,
    runTransaction: async (cb: (tx: any) => Promise<any>) => {
      const writes: Array<['set' | 'update' | 'delete', any, Record<string, unknown>]> = [];
      const tx = {
        get: async (ref: any) => ({ exists: store.has(ref.path), data: () => store.get(ref.path) }),
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
  const revoked: string[] = [];
  const notFound = () => Object.assign(new Error('nf'), { code: 'auth/user-not-found' });
  return {
    users,
    revoked,
    getUser: async (uid: string) => {
      const u = users.get(uid);
      if (!u) throw notFound();
      return { uid, customClaims: u.customClaims ?? {} };
    },
    setCustomUserClaims: async (uid: string, claims: Record<string, unknown>) => {
      const u = users.get(uid);
      if (!u) throw notFound();
      users.set(uid, { ...u, customClaims: { ...claims } });
    },
    revokeRefreshTokens: async (uid: string) => { revoked.push(uid); },
  } as any;
}

const FAMILY_ID = 'fam-leave-1';

function makeCtx(db: any, auth: any): FamilyDeletionContext {
  return {
    db,
    auth,
    enqueue: async () => undefined,
    now: () => 1_000,
    invocationId: 'leave-test',
  };
}

let db: any;
let auth: any;
let ctx: FamilyDeletionContext;

beforeEach(() => {
  db = makeFakeDb();
  auth = makeFakeAuth();
  ctx = makeCtx(db, auth);
  db.store.set(`families/${FAMILY_ID}`, { name: 'Leave Family' });
  db.store.set('users/owner-uid', { familyId: FAMILY_ID, role: 'owner' });
  db.store.set('users/parent-uid', {
    uid: 'parent-uid', familyId: FAMILY_ID, role: 'parent', displayName: 'Parent',
    email: 'p@example.com', avatarUrl: 'https://avatar/parent', avatarId: 'starter-cat',
    rewardPoints: 30, lifetimeXP: 900, currentStreak: 2, longestStreak: 7,
    lastActiveDate: 'ts', walletBalance: 250, joinRequestId: 'jr-9',
    lastGoalTxId: 'tx-goal', lastManualTxId: 'tx-manual', lastTransferTxId: 'tx-transfer',
    lastTransferReqId: 'req-transfer', lastPenaltyTxId: 'tx-penalty',
    lastFundTxId: 'tx-fund', lastBehaviourEventId: 'ev-1', lastRedemptionId: 'red-1',
    lastReversalId: 'rev-1',
  });
  db.store.set('users/adult-child-uid', { familyId: FAMILY_ID, role: 'child', displayName: 'Teen' });
  db.store.set('users/managed-uid', { familyId: FAMILY_ID, role: 'child', isManaged: true });
  db.store.set(`families/${FAMILY_ID}/users/parent-uid`, { role: 'parent' });
  auth.users.set('parent-uid', { customClaims: { familyId: FAMILY_ID, role: 'parent', extra: 'keep' } });
});

describe('leaveFamilyImpl', () => {
  it('lets a self-registered parent leave: clears profile, projection, claims, tokens', async () => {
    const result = await leaveFamilyImpl(ctx, 'parent-uid', { familyId: FAMILY_ID });
    expect(result.left).toBe(true);

    const profile = db.store.get('users/parent-uid');
    expect(profile.displayName).toBe('Parent');
    expect(profile.familyId).toBeUndefined();
    expect(profile.role).toBeUndefined();
    // R2: every real family-scoped field is erased.
    for (const field of [
      'rewardPoints', 'lifetimeXP', 'currentStreak', 'longestStreak', 'lastActiveDate',
      'walletBalance', 'joinRequestId', 'lastGoalTxId', 'lastManualTxId', 'lastTransferTxId',
      'lastTransferReqId', 'lastPenaltyTxId', 'lastFundTxId', 'lastBehaviourEventId',
      'lastRedemptionId', 'lastReversalId',
    ]) {
      expect(profile[field], `expected ${field} to be cleared`).toBeUndefined();
    }
    // Account-level identity fields survive.
    expect(profile.uid).toBe('parent-uid');
    expect(profile.email).toBe('p@example.com');
    expect(profile.avatarUrl).toBe('https://avatar/parent');
    expect(profile.avatarId).toBe('starter-cat');
    expect(db.store.has(`families/${FAMILY_ID}/users/parent-uid`)).toBe(false);
    // Family and remaining members untouched.
    expect(db.store.has(`families/${FAMILY_ID}`)).toBe(true);
    expect(db.store.get('users/owner-uid').familyId).toBe(FAMILY_ID);
    // Non-family claims preserved; family claims stripped; tokens revoked.
    expect(auth.users.get('parent-uid').customClaims).toEqual({ extra: 'keep' });
    expect(auth.revoked).toContain('parent-uid');
  });

  it('lets a self-registered child leave', async () => {
    const result = await leaveFamilyImpl(ctx, 'adult-child-uid', { familyId: FAMILY_ID });
    expect(result.left).toBe(true);
    expect(db.store.get('users/adult-child-uid').familyId).toBeUndefined();
  });

  it('refuses the owner with OWNER_CANNOT_LEAVE', async () => {
    await expect(leaveFamilyImpl(ctx, 'owner-uid', { familyId: FAMILY_ID }))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'OWNER_CANNOT_LEAVE' });
    expect(db.store.get('users/owner-uid').familyId).toBe(FAMILY_ID);
  });

  it('refuses a managed child with MANAGED_CHILD_CANNOT_LEAVE', async () => {
    await expect(leaveFamilyImpl(ctx, 'managed-uid', { familyId: FAMILY_ID }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(db.store.get('users/managed-uid').familyId).toBe(FAMILY_ID);
  });

  it('refuses departures while the family is deleting', async () => {
    db.store.get(`families/${FAMILY_ID}`).lifecycleState = 'deleting';
    await expect(leaveFamilyImpl(ctx, 'parent-uid', { familyId: FAMILY_ID }))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'FAMILY_DELETING' });
    expect(db.store.get('users/parent-uid').familyId).toBe(FAMILY_ID);
  });

  it('is idempotent: an already-departed member succeeds without changes', async () => {
    await leaveFamilyImpl(ctx, 'parent-uid', { familyId: FAMILY_ID });
    const result = await leaveFamilyImpl(ctx, 'parent-uid', { familyId: FAMILY_ID });
    expect(result.left).toBe(true);
    expect(db.store.get('users/parent-uid').displayName).toBe('Parent');
  });

  it('does not trust the client familyId: a member of another family is a no-op', async () => {
    db.store.set('users/other-uid', { familyId: 'different-family', role: 'parent' });
    const result = await leaveFamilyImpl(ctx, 'other-uid', { familyId: FAMILY_ID });
    expect(result.left).toBe(true); // treated as already departed from FAMILY_ID
    expect(db.store.get('users/other-uid').familyId).toBe('different-family');
  });

  it('rejects a missing familyId', async () => {
    await expect(leaveFamilyImpl(ctx, 'parent-uid', {}))
      .rejects.toMatchObject({ code: 'invalid-argument' });
  });
});
