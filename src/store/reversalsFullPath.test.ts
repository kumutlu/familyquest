import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Full-path regression test for "Rewards → Redemption history does not update
 * after a refund/reversal without a manual refresh."
 *
 * This drives the REAL store (the `redemptions`, `reversals` AND `members`
 * listeners) and then calls `normalizeHistoryAction` EXACTLY as
 * HistoryActionControl / ReversalHistoryPanel do, so we assert the end-to-end
 * derived UI state:
 *
 *   refund write → reversals onSnapshot → store.reversals
 *     → normalizeHistoryAction(redemption) → action.reversal (REVERSED badge)
 *
 * If this passes, the store→UI derivation is correct and the bug (if any) lies
 * elsewhere (e.g. the reversals listener never attaching in production). If it
 * fails, we have isolated the exact propagation break.
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
import { normalizeHistoryAction, historyActionContext } from '../lib/reversalHistory';

const FAMILY_PATH = 'families/f1';
const MEMBERS_PATH = 'users';
const REDEMPTIONS_PATH = 'families/f1/redemptions';
const REVERSALS_PATH = 'families/f1/reversals';

const querySnapshot = (docs: any[] = [], fromCache = false) => ({
  docs: docs.map(({ id, ...data }) => ({ id, data: () => data })),
  metadata: { fromCache, hasPendingWrites: false },
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

const CHILD_MEMBER = { id: 'child-1', displayName: 'Alisya', role: 'child', rewardPoints: 100 };

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

const deriveAction = () => {
  const state = useStore.getState();
  return normalizeHistoryAction({
    sourceKind: 'reward_redemption',
    source: REDEMPTION,
    ...historyActionContext(state),
  });
};

const bootstrap = async () => {
  useStore.getState().loadFamilyData('u1', 'f1');
  await resolveRead(FAMILY_PATH, documentSnapshot('f1', { name: 'Family' }));
  await resolveRead(MEMBERS_PATH, querySnapshot([CHILD_MEMBER]));
  await resolveRead(REDEMPTIONS_PATH, querySnapshot([REDEMPTION]));
  await resolveRead(REVERSALS_PATH, querySnapshot([]));
};

describe('Rewards redemption history — full store→UI derivation', () => {
  beforeEach(() => {
    harness.subscribedPaths = [];
    harness.serverReads = new Map();
    harness.snapshotNext = new Map();
    harness.snapshotError = new Map();
    useStore.getState().cleanup();
    useStore.setState(signedInParent() as any);
  });

  it('attaches live listeners on redemptions, reversals and members collections', async () => {
    await bootstrap();
    expect(harness.subscribedPaths).toContain(REDEMPTIONS_PATH);
    expect(harness.subscribedPaths).toContain(REVERSALS_PATH);
    expect(harness.subscribedPaths).toContain(MEMBERS_PATH);
  });

  it('shows a Refund action BEFORE any reversal is recorded', async () => {
    await bootstrap();
    const action = deriveAction();
    expect(action.reversal).toBeUndefined();
    expect(action.action).toBe('reverse');
  });

  it('flips to a REVERSED badge when a live reversal write lands in the store', async () => {
    await bootstrap();

    // Sanity: before the refund, the action is a refund.
    expect(deriveAction().action).toBe('reverse');

    // PRODUCTION SCENARIO: a refund writes a new reversals document. The
    // onSnapshot listener fires with a fromCache:false (hasPendingWrites:true)
    // snapshot — exactly what the real SDK emits for a local write on an
    // already-synced query.
    const next = harness.snapshotNext.get(REVERSALS_PATH);
    expect(next).toBeTypeOf('function');
    next!(querySnapshot([REVERSAL_RECORD], false));

    const action = deriveAction();
    expect(action.reversal).toBeDefined();
    expect(action.reversal.sourceId).toBe('rd1');
    expect(action.action).toBeUndefined();
  });
});
