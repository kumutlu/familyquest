import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression test for: "Rewards → Redemption history does not update after a
 * refund/reversal without a manual refresh."
 *
 * This reproduces the production symptom end-to-end through the real store
 * listener path (no React) so we can assert exactly where propagation stops:
 *
 *   write (reverseTransaction) → Firestore `reversals` doc
 *     → onSnapshot listener → store.state.reversals → Rewards render.
 *
 * The Firestore mock mirrors the one in bootstrapSequencing.test.ts: it records
 * every onSnapshot subscription and lets the test deliver snapshots with an
 * explicit `metadata.fromCache` flag — exactly what the real SDK emits.
 *
 * KEY FACT about the real SDK (documented Firestore behaviour): when a document
 * is written locally (the refund's runTransaction) on a query that has ALREADY
 * been synced with the server, the listener fires with
 *   metadata.fromCache === false, hasPendingWrites === true
 * (the query is not "from cache"; it is a local mutation of an already-synced
 * query). The snapshot is therefore authoritative enough to surface immediately.
 *
 * The store's `subscribe()` helper gates non-critical resources with
 *   if (snapshot.metadata?.fromCache && !critical) return;   // useStore.ts:663
 * `reversals` is NON-CRITICAL (criticalBootstrapResources = ['family'] only), so
 * ANY snapshot the SDK marks fromCache:true is silently dropped. A correctly
 * synced live local write is fromCache:false and SHOULD pass — so this test
 * asserts the happy path works. If the gate were the bug, delivering a
 * fromCache:false live snapshot would still update state; the test below proves
 * the listener DOES update state on a fromCache:false live write, isolating the
 * failure to the gate only when fromCache:true is (incorrectly) emitted.
 */

type Deferred = { resolve: (value: any) => void; reject: (error: any) => void };

const harness = vi.hoisted(() => ({
  subscribedPaths: [] as string[],
  serverReads: new Map<string, Deferred[]>(),
  snapshotNext: new Map<string, (snapshot: any) => void>(),
  snapshotError: new Map<string, (error: any) => void>(),
}));

const pathOf = (target: any): string => (target && target.path) || 'unknown';

const deferredFor = (target: any) => {
  const path = pathOf(target);
  return new Promise((resolve, reject) => {
    const existing = harness.serverReads.get(path) ?? [];
    existing.push({ resolve, reject });
    harness.serverReads.set(path, existing);
  });
};

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(() => () => {}),
  getAuth: vi.fn(() => ({})),
  GoogleAuthProvider: class {},
  signOut: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: any, ...segments: string[]) => ({ type: 'doc', path: segments.join('/') })),
  collection: vi.fn((_db: any, ...segments: string[]) => ({
    type: 'collection',
    path: segments.join('/'),
  })),
  query: vi.fn((target: any) => ({ ...target, type: 'query' })),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getFirestore: vi.fn(() => ({})),
  getDocFromServer: vi.fn((target: any) => deferredFor(target)),
  getDocsFromServer: vi.fn((target: any) => deferredFor(target)),
  onSnapshot: vi.fn((target: any, _options: any, next: any, error: any) => {
    harness.subscribedPaths.push(pathOf(target));
    harness.snapshotNext.set(pathOf(target), next);
    harness.snapshotError.set(pathOf(target), error);
    return () => {};
  }),
}));

vi.mock('../lib/firebase', () => ({ app: {}, auth: {}, db: {}, googleProvider: {} }));

import { useStore } from './useStore';

const FAMILY_PATH = 'families/f1';
const REVERSALS_PATH = 'families/f1/reversals';

const querySnapshot = (docs: any[] = [], fromCache = false) => ({
  docs: docs.map(({ id, ...data }) => ({ id, data: () => data })),
  metadata: { fromCache, hasPendingWrites: false },
});

// A local pending write on a query that has NOT yet been server-confirmed is
// delivered with fromCache:true AND hasPendingWrites:true (the query is not
// "from cache" in the stale sense, but it is not yet server-synced).
const liveSnapshot = (docs: any[] = []) => ({
  docs: docs.map(({ id, ...data }) => ({ id, data: () => data })),
  metadata: { fromCache: true, hasPendingWrites: true },
});

const documentSnapshot = (id: string, data: any = {}, fromCache = false) => ({
  id,
  exists: () => true,
  data: () => data,
  metadata: { fromCache, hasPendingWrites: false },
});

const resolveRead = async (path: string, snapshot: any) => {
  const pending = harness.serverReads.get(path) ?? [];
  harness.serverReads.set(path, []);
  pending.forEach(deferred => deferred.resolve(snapshot));
  await Promise.resolve();
  await Promise.resolve();
};

const signedInParent = () => ({
  authStatus: 'authenticated' as const,
  authInitialized: true,
  authLoading: false,
  authUser: { uid: 'u1' } as any,
  currentUser: { id: 'u1', familyId: 'f1', role: 'owner' } as any,
  profileLoading: false,
  familyLoading: true,
  appReady: false,
  loading: true,
  bootstrapError: null,
  featureErrors: {},
  activeFamilyId: null,
});

const REDEMPTION = {
  id: 'rd1',
  rewardId: 'r1',
  userId: 'child-1',
  costPaid: 50,
  redeemedAt: { toDate: () => new Date('2026-07-30T12:31:00Z') },
  createdAt: { toDate: () => new Date('2026-07-30T12:31:00Z') },
  status: 'completed',
  effectSnapshot: {
    schemaVersion: 1,
    entityType: 'reward_redemption',
    familyId: 'f1',
    actorId: 'child-1',
    childId: 'child-1',
    rewardId: 'r1',
    pointsDelta: -50,
    xpAdjustment: 0,
  },
};

const REVERSAL_RECORD = {
  id: 'reward_redemption__rd1',
  familyId: 'f1',
  sourceKind: 'reward_redemption',
  sourceId: 'rd1',
  reversalId: 'reward_redemption__rd1',
  actorId: 'u1',
  actorName: 'Kemal',
  reason: 'Duplicate',
  status: 'completed',
  originalEffectSnapshot: REDEMPTION.effectSnapshot,
  inverseEffectSnapshot: { ...REDEMPTION.effectSnapshot, pointsDelta: 50 },
  xpAdjustment: 0,
  xpReversed: false,
  completedAt: { toDate: () => new Date('2026-07-30T13:00:00Z') },
};

const REVERSAL_RECORD_OLD = {
  id: 'reward_redemption__rd-old',
  familyId: 'f1',
  sourceKind: 'reward_redemption',
  sourceId: 'rd-old',
  reversalId: 'reward_redemption__rd-old',
  actorId: 'u1',
  actorName: 'Kemal',
  reason: 'Wrong item',
  status: 'completed',
  originalEffectSnapshot: REDEMPTION.effectSnapshot,
  inverseEffectSnapshot: { ...REDEMPTION.effectSnapshot, pointsDelta: 50 },
  xpAdjustment: 0,
  xpReversed: false,
  completedAt: { toDate: () => new Date('2026-07-29T10:00:00Z') },
};

describe('Rewards redemption history — live reversal propagation', () => {
  beforeEach(() => {
    harness.subscribedPaths = [];
    harness.serverReads = new Map();
    harness.snapshotNext = new Map();
    harness.snapshotError = new Map();
    useStore.getState().cleanup();
    useStore.setState(signedInParent() as any);
  });

  it('attaches a live onSnapshot listener on the reversals collection', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    await resolveRead(FAMILY_PATH, documentSnapshot('f1', { name: 'Family' }));
    expect(harness.subscribedPaths).toContain(REVERSALS_PATH);
  });

  it('reflects a reversal written AFTER bootstrap in store.state.reversals without a refresh', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');

    // 1. Family (critical) resolves → stage 2 starts, reversals listener attaches.
    await resolveRead(FAMILY_PATH, documentSnapshot('f1', { name: 'Family' }));

    // 2. The reversals server read resolves (fromCache:false) — initial empty set.
    await resolveRead(REVERSALS_PATH, querySnapshot([]));

    // Sanity: store is ready and reversals is empty.
    expect(useStore.getState().appReady).toBe(true);
    expect(useStore.getState().reversals).toEqual([]);

    // 3. PRODUCTION SCENARIO: a refund writes a new reversals document. The
    //    onSnapshot listener fires. A live local write on an already-synced query
    //    is delivered with fromCache:false (hasPendingWrites:true).
    const next = harness.snapshotNext.get(REVERSALS_PATH);
    expect(next).toBeTypeOf('function');
    next!(querySnapshot([REVERSAL_RECORD], false));

    // 4. ASSERTION: the store must now contain the reversal — no manual refresh.
    const reversals = useStore.getState().reversals;
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({ sourceKind: 'reward_redemption', sourceId: 'rd1' });
  });

  it('PROVES the fromCache gate drops a live reversal when the SDK marks it fromCache:true', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    await resolveRead(FAMILY_PATH, documentSnapshot('f1', { name: 'Family' }));
    await resolveRead(REVERSALS_PATH, querySnapshot([]));

    // Simulate the (buggy) case where the live local-write snapshot is delivered
    // with fromCache:true. Because `reversals` is non-critical, the gate at
    // useStore.ts:663 silently drops it and state.reversals stays empty.
    const next = harness.snapshotNext.get(REVERSALS_PATH);
    next!(querySnapshot([REVERSAL_RECORD], true));

    expect(useStore.getState().reversals).toEqual([]);
  });

  it('REGRESSION: surfaces a reversal written before the reversals listener is server-synced', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    await resolveRead(FAMILY_PATH, documentSnapshot('f1', { name: 'Family' }));

    const next = harness.snapshotNext.get(REVERSALS_PATH);
    expect(next).toBeTypeOf('function');

    // The listener has attached but is NOT yet server-synced: the initial cached
    // snapshot is fromCache:true (dropped by the gate at useStore.ts:663) and the
    // getDocsFromServer server read is still pending. A local refund write on an
    // unsynced query is delivered as fromCache:true (hasPendingWrites:true) and
    // the gate currently drops it too — so state.reversals never receives the
    // reversal and the UI keeps showing "Refund" instead of "REVERSED".
    next!(querySnapshot([REVERSAL_RECORD_OLD], true)); // cached existing reversal, dropped
    next!(liveSnapshot([REVERSAL_RECORD])); // live refund write, dropped by current code

    // DESIRED: the just-refunded reversal appears in state.reversals without a
    // manual refresh (the previously-cached one may still wait for server).
    const reversals = useStore.getState().reversals;
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({ sourceKind: 'reward_redemption', sourceId: 'rd1' });
  });
});

describe('cache gate coverage matrix (fromCache / hasPendingWrites / critical)', () => {
  // Attaches the non-critical `reversals` listener (stage 2) and returns its
  // onSnapshot `next` callback so individual cases can deliver snapshots with
  // explicit metadata flags.
  const attachReversals = async () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    await resolveRead(FAMILY_PATH, documentSnapshot('f1', { name: 'Family' }));
    await resolveRead(REVERSALS_PATH, querySnapshot([]));
    return harness.snapshotNext.get(REVERSALS_PATH)!;
  };

  it('CASE 1: non-critical fromCache:true, hasPendingWrites:false → still dropped', async () => {
    const next = await attachReversals();
    next(querySnapshot([REVERSAL_RECORD], true)); // fromCache:true, hasPendingWrites:false
    expect(useStore.getState().reversals).toEqual([]);
  });

  it('CASE 2: non-critical fromCache:true, hasPendingWrites:true → accepted', async () => {
    const next = await attachReversals();
    next(liveSnapshot([REVERSAL_RECORD])); // fromCache:true, hasPendingWrites:true
    const reversals = useStore.getState().reversals;
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({ sourceId: 'rd1' });
  });

  it('CASE 3: fromCache:false → accepted', async () => {
    const next = await attachReversals();
    next(querySnapshot([REVERSAL_RECORD], false)); // fromCache:false
    const reversals = useStore.getState().reversals;
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({ sourceId: 'rd1' });
  });

  it('CASE 4: critical resource (family) fromCache:true → still accepted (unchanged)', async () => {
    useStore.getState().loadFamilyData('u1', 'f1');
    const familyNext = harness.snapshotNext.get(FAMILY_PATH);
    expect(familyNext).toBeTypeOf('function');
    // Critical resources must never be dropped by the cache gate, even when the
    // SDK marks the snapshot fromCache:true with no pending writes. The fix must
    // preserve this pre-existing behaviour exactly.
    familyNext!(documentSnapshot('f1', { name: 'Family' }, true));
    expect(useStore.getState().familyData).toMatchObject({ name: 'Family' });
  });
});
