import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = {
  target: string;
  next: (snapshot: any) => void;
  error: (error: any) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
};

type ServerRead = {
  target: string;
  resolve: (snapshot: any) => void;
  reject: (error: any) => void;
};

const listeners: Listener[] = [];
const serverReads: ServerRead[] = [];
const queryShapes: Array<{ target: string; constraints: any[] }> = [];
let authNext: ((user: any) => Promise<void> | void) | undefined;
let authError: ((error: any) => void) | undefined;
const authUnsubscribe = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, path: string) => path),
  doc: vi.fn((_db: unknown, collectionOrPath: string, id?: string) => id ? `${collectionOrPath}/${id}` : collectionOrPath),
  query: vi.fn((target: string, ...constraints: any[]) => {
    queryShapes.push({ target, constraints });
    return target;
  }),
  orderBy: vi.fn((field: string, direction?: string) => ({ type: 'orderBy', field, direction })),
  where: vi.fn((field: string, operator: string, value: unknown) => ({ type: 'where', field, operator, value })),
  onSnapshot: vi.fn((target: string, optionsOrNext: any, nextOrError: any, maybeError: any) => {
    const hasOptions = typeof optionsOrNext !== 'function';
    const unsubscribe = vi.fn();
    listeners.push({
      target,
      next: hasOptions ? nextOrError : optionsOrNext,
      error: hasOptions ? maybeError : nextOrError,
      unsubscribe,
    });
    return unsubscribe;
  }),
  getDocFromServer: vi.fn((target: string) => new Promise((resolve, reject) => {
    serverReads.push({ target, resolve, reject });
  })),
  getDocsFromServer: vi.fn((target: string) => new Promise((resolve, reject) => {
    serverReads.push({ target, resolve, reject });
  })),
  getFirestore: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn((_auth: unknown, next: typeof authNext, error: typeof authError) => {
    authNext = next;
    authError = error;
    return authUnsubscribe;
  }),
  getAuth: vi.fn(),
}));

vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: {} }));

import { onAuthStateChanged } from 'firebase/auth';
import { useStore } from '../../src/store/useStore';

const familyResources = [
  'families/fam1',
  'families/fam1/tasks',
  'families/fam1/rewards',
  'families/fam1/wallets',
  'users',
  'families/fam1/join_requests',
  'families/fam1/child_join_requests',
  'families/fam1/task_completions',
  'families/fam1/redemptions',
  'families/fam1/feed',
  'families/fam1/wallet_transactions',
  'families/fam1/savings_goals',
  'families/fam1/goal_requests',
  'families/fam1/behaviour_events',
  'families/fam1/challenges',
  'families/fam1/funds',
  'families/fam1/fund_transactions',
  'families/fam1/transfer_requests',
  'families/fam1/money_requests',
  'families/fam1/petbox_requests',
  'families/fam1/profile_update_requests',
  'families/fam1/reversals',
  'families/fam1/users/user1/avatar_unlocks',
  'families/fam1/gamification_summaries',
  'families/fam1/daily_progress',
] as const;

const childFamilyResources = familyResources
  .filter(target =>
    target !== 'families/fam1/join_requests' && target !== 'families/fam1/child_join_requests')
  .map(target => {
    if (target === 'families/fam1/wallets') return 'families/fam1/wallets/user1';
    if (target === 'families/fam1/gamification_summaries') return 'families/fam1/gamification_summaries/user1';
    return target;
  });

function listener(target: string, occurrence = 0) {
  const matches = listeners.filter(item => item.target === target);
  const found = matches[occurrence];
  if (!found) throw new Error(`No listener for ${target} at ${occurrence}`);
  return found;
}

function serverRead(target: string, occurrence = 0) {
  const matches = serverReads.filter(item => item.target === target);
  const found = matches[occurrence];
  if (!found) throw new Error(`No server read for ${target} at ${occurrence}`);
  return found;
}

function collectionSnapshot(docs: any[] = [], fromCache = false) {
  return {
    docs: docs.map(({ id, ...data }) => ({ id, data: () => data })),
    metadata: { fromCache },
  };
}

function familySnapshot(exists = true, data: any = { name: 'Family One' }, fromCache = false) {
  return { exists: () => exists, id: 'fam1', data: () => data, metadata: { fromCache } };
}

function documentSnapshot(exists = true, id: string, data: any = {}, fromCache = false) {
  return { exists: () => exists, id, data: () => data, metadata: { fromCache } };
}

function emitAllFamilySnapshots(overrides: Record<string, any[]> = {}) {
  for (const target of familyResources) {
    if (target === 'families/fam1') listener(target).next(familySnapshot());
    else listener(target).next(collectionSnapshot(overrides[target] ?? []));
  }
}

function emitAllChildSnapshots(overrides: Record<string, any[]> = {}) {
  for (const target of childFamilyResources) {
    const matches = listeners.filter(item => item.target === target);
    for (const subscription of matches) {
      if (target === 'families/fam1') subscription.next(familySnapshot());
      else if (target === 'families/fam1/wallets/user1') {
        subscription.next({ exists: () => true, id: 'user1', data: () => ({ balance: 0 }), metadata: { fromCache: false } });
      } else if (target === 'families/fam1/gamification_summaries/user1') {
        subscription.next({ exists: () => true, id: 'user1', data: () => ({ ...overrides.gamificationSummary, childId: 'user1' }), metadata: { fromCache: false } });
      } else subscription.next(collectionSnapshot(overrides[target] ?? []));
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

function authenticatedState(familyId = 'fam1', role = 'parent') {
  useStore.setState({
    authInitialized: true,
    authUser: { uid: 'user1' },
    currentUser: { id: 'user1', familyId, role },
  });
}

describe('bootstrap/auth/listener state machine', () => {
  beforeEach(() => {
    useStore.getState().cleanup();
    listeners.length = 0;
    serverReads.length = 0;
    queryShapes.length = 0;
    authNext = undefined;
    authError = undefined;
    authUnsubscribe.mockClear();
    vi.clearAllMocks();
    useStore.setState({
      authInitialized: false,
      authUser: undefined,
      currentUser: null,
      familyData: null,
      appReady: false,
      loading: true,
      bootstrapError: null,
      activeFamilyId: null,
    });
  });

  it('1. remains unresolved at mount until the auth observer fires', () => {
    useStore.getState().initAuth();
    expect(useStore.getState()).toMatchObject({ authInitialized: false, authUser: undefined, appReady: false, loading: true });
    expect(listeners).toHaveLength(0);
  });

  it('2. starts a persisted authenticated session without exposing family data', async () => {
    useStore.getState().initAuth();
    const token = deferred<string>();
    const user = { uid: 'user1', getIdToken: vi.fn(() => token.promise) };
    const pending = authNext!(user);
    expect(useStore.getState()).toMatchObject({ authInitialized: true, authUser: user, currentUser: null, appReady: false, loading: true });
    token.resolve('token');
    await pending;
  });

  it('3. waits for an auth token before attaching the profile listener', async () => {
    useStore.getState().initAuth();
    const token = deferred<string>();
    const pending = authNext!({ uid: 'user1', getIdToken: () => token.promise });
    expect(listeners).toHaveLength(0);
    token.resolve('token');
    await pending;
    expect(listener('users/user1')).toBeDefined();
  });

  it('4/5. waits for the profile and a non-empty familyId before family listeners', async () => {
    useStore.getState().initAuth();
    await authNext!({ uid: 'user1', getIdToken: vi.fn().mockResolvedValue('token') });
    expect(listeners.map(item => item.target)).toEqual(['users/user1']);
    listener('users/user1').next({ exists: () => true, id: 'user1', data: () => ({ role: 'parent' }) });
    expect(listeners.map(item => item.target)).toEqual(['users/user1']);
    expect(useStore.getState()).toMatchObject({ appReady: true, loading: false, activeFamilyId: null });
  });

  it('6. ignores duplicate profile snapshots for the active family', async () => {
    useStore.getState().initAuth();
    await authNext!({ uid: 'user1', getIdToken: vi.fn().mockResolvedValue('token') });
    const profile = listener('users/user1');
    const snapshot = { exists: () => true, id: 'user1', data: () => ({ familyId: 'fam1', role: 'parent' }) };
    profile.next(snapshot);
    const count = listeners.length;
    profile.next(snapshot);
    expect(listeners).toHaveLength(count);
  });

  it('7. transitions each resource to ready only once across repeated snapshots', () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');
    listener('families/fam1').next(familySnapshot());
    listener('families/fam1').next(familySnapshot(true, { name: 'Updated' }));
    expect(useStore.getState().bootstrapStatus.family).toBe('ready');
    expect(useStore.getState().appReady).toBe(true);
  });

  it('marks optional history resources loading until their authoritative snapshots arrive', () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');

    expect(useStore.getState().bootstrapStatus).toMatchObject({
      walletTransactions: 'loading',
      savingsGoals: 'loading',
      goalLedger: 'loading',
      redemptions: 'loading',
      behaviourEvents: 'loading',
      funds: 'loading',
      transferRequests: 'loading',
      moneyRequests: 'loading',
      petboxRequests: 'loading',
      reversals: 'loading',
    });
  });

  it('resolves goal subcollection resources immediately when there are no savings goals', () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');
    listener('families/fam1').next(familySnapshot());

    listener('families/fam1/savings_goals').next(collectionSnapshot([]));

    expect(useStore.getState().bootstrapStatus).toMatchObject({
      savingsGoals: 'ready',
      goalContributions: 'ready',
      goalLedger: 'ready',
      goalMatchProposals: 'ready',
    });
  });

  it('keeps goal ledger loading until every active goal has an authoritative snapshot', () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');
    listener('families/fam1').next(familySnapshot());
    listener('families/fam1/savings_goals').next(collectionSnapshot([
      { id: 'goal-1' },
      { id: 'goal-2' },
    ]));

    listener('families/fam1/savings_goals/goal-1/goal_ledger').next(collectionSnapshot([]));
    expect(useStore.getState().bootstrapStatus.goalLedger).toBe('loading');

    listener('families/fam1/savings_goals/goal-2/goal_ledger').next(collectionSnapshot([]));
    expect(useStore.getState().bootstrapStatus.goalLedger).toBe('ready');
  });

  it('does not let a slower initial server read overwrite a newer listener snapshot', async () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');
    listener('families/fam1').next(familySnapshot());
    listener('families/fam1/tasks').next(collectionSnapshot([{ id: 'new', title: 'New' }]));
    serverRead('families/fam1/tasks').resolve(collectionSnapshot([{ id: 'old', title: 'Old' }]));
    await Promise.resolve();
    expect(useStore.getState().tasks).toEqual([{ id: 'new', title: 'New' }]);
  });

  it('8. treats authoritative empty collections as resolved', () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');
    emitAllFamilySnapshots();
    expect(Object.values(useStore.getState().bootstrapStatus).every(status => status === 'ready')).toBe(true);
    expect(useStore.getState()).toMatchObject({ appReady: true, loading: false, bootstrapError: null });
  });

  it('does not treat an empty cache snapshot as authoritative readiness', () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');
    listener('families/fam1').next(familySnapshot());
    listener('families/fam1/tasks').next(collectionSnapshot([], true));
    expect(useStore.getState().bootstrapStatus.tasks).toBe('loading');
    expect(useStore.getState().appReady).toBe(true);
  });

  it('does not treat a missing family in cache as an authoritative missing document', () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');
    listener('families/fam1').next(familySnapshot(false, {}, true));
    expect(useStore.getState()).toMatchObject({ bootstrapError: null, activeFamilyId: 'fam1', loading: true });
    expect(useStore.getState().bootstrapStatus.family).toBe('loading');
  });

  it.each(['parent', 'owner'])('uses parent-wide listeners for the %s role', role => {
    authenticatedState('fam1', role);
    useStore.getState().loadFamilyData('user1', 'fam1');
    listener('families/fam1').next(familySnapshot());
    expect(listeners.some(item => item.target === 'families/fam1/join_requests')).toBe(true);
    const transferQuery = queryShapes.find(shape => shape.target === 'families/fam1/transfer_requests');
    expect(transferQuery?.constraints.some(constraint => constraint.type === 'where')).toBe(false);
  });

  it('subscribes to reversals during initial bootstrap for parent/owner', () => {
    authenticatedState('fam1', 'parent');
    useStore.getState().loadFamilyData('user1', 'fam1');
    listener('families/fam1').next(familySnapshot());
    expect(listeners.some(item => item.target === 'families/fam1/reversals')).toBe(true);
  });

  it('does not subscribe to reversals during bootstrap for child', () => {
    authenticatedState('fam1', 'child');
    useStore.getState().loadFamilyData('user1', 'fam1');
    expect(listeners.some(item => item.target === 'families/fam1/reversals')).toBe(false);
  });

  it.each(['parent', 'owner'])('handles reversals permission error during bootstrap for %s', role => {
    authenticatedState('fam1', role);
    useStore.getState().loadFamilyData('user1', 'fam1');
    emitAllFamilySnapshots({
      'families/fam1/tasks': [{ id: 'task-1', title: 'Core task' }],
      'families/fam1/rewards': [{ id: 'reward-1', title: 'Core reward' }],
      'families/fam1/wallets': [{ id: 'child-1', balance: 500 }],
    });
    // Don't emit reversals snapshot - simulate permission error
    const reversalListener = listener('families/fam1/reversals');
    reversalListener.error({ code: 'permission-denied', message: 'Missing or insufficient permissions' });

    expect(useStore.getState()).toMatchObject({
      appReady: true,
      bootstrapError: null,
      featureErrors: { reversals: '[Reversals] permission-denied: Missing or insufficient permissions' },
    });
    expect(useStore.getState().tasks).toEqual([{ id: 'task-1', title: 'Core task' }]);
    expect(useStore.getState().rewards).toEqual([{ id: 'reward-1', title: 'Core reward' }]);
    expect(useStore.getState().childWallets).toEqual([{ id: 'child-1', balance: 500 }]);
    expect(reversalListener.unsubscribe).toHaveBeenCalledTimes(1);
    expect(listener('families/fam1/tasks').unsubscribe).not.toHaveBeenCalled();
  });

  it('does not attach feature-scoped reversals for a child or a different family', () => {
    authenticatedState('fam1', 'child');
    useStore.getState().loadFamilyData('user1', 'fam1');
    useStore.getState().loadReversals();
    expect(listeners.some(item => item.target === 'families/fam1/reversals')).toBe(false);

    useStore.setState({ currentUser: { id: 'user1', familyId: 'fam2', role: 'parent' } });
    useStore.getState().loadReversals();
    expect(listeners.some(item => item.target === 'families/fam1/reversals')).toBe(false);
  });

  it('retries only the failed optional reversals listener without duplicating healthy listeners', () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');
    emitAllFamilySnapshots();
    useStore.getState().loadReversals();
    listener('families/fam1/reversals').error({ code: 'permission-denied', message: 'denied' });

    useStore.getState().retryFeature('reversals');
    expect(listeners.filter(item => item.target === 'families/fam1/reversals')).toHaveLength(2);
    expect(listeners.filter(item => item.target === 'families/fam1/tasks')).toHaveLength(1);
  });

  it('uses least-privilege child queries and excludes parent-only join requests from readiness', () => {
    useStore.setState({
      authInitialized: true,
      authUser: { uid: 'user1' },
      currentUser: { id: 'user1', familyId: 'fam1', role: 'child' },
    });
    useStore.getState().loadFamilyData('user1', 'fam1');
    listener('families/fam1').next(familySnapshot());

    expect(listeners.some(item => item.target === 'families/fam1/join_requests')).toBe(false);
    expect(listeners.some(item => item.target === 'families/fam1/wallets/user1')).toBe(true);
    expect(listeners.some(item => item.target === 'families/fam1/task_completions')).toBe(true);
    expect(useStore.getState().bootstrapStatus.joinRequests).toBe('idle');
    expect(queryShapes).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'families/fam1/redemptions', constraints: expect.arrayContaining([expect.objectContaining({ type: 'where', field: 'userId', value: 'user1' })]) }),
      expect.objectContaining({ target: 'families/fam1/wallet_transactions', constraints: expect.arrayContaining([expect.objectContaining({ type: 'where', field: 'childId', value: 'user1' })]) }),
      expect.objectContaining({ target: 'families/fam1/feed', constraints: expect.not.arrayContaining([expect.objectContaining({ type: 'where' })]) }),
      expect.objectContaining({ target: 'families/fam1/transfer_requests', constraints: expect.arrayContaining([expect.objectContaining({ type: 'where', field: 'fromChildId', value: 'user1' })]) }),
      expect.objectContaining({ target: 'families/fam1/petbox_requests', constraints: expect.arrayContaining([expect.objectContaining({ type: 'where', field: 'childId', value: 'user1' })]) }),
      expect.objectContaining({ target: 'families/fam1/money_requests', constraints: expect.arrayContaining([expect.objectContaining({ type: 'where', field: 'requesterId', value: 'user1' })]) }),
      expect.objectContaining({ target: 'families/fam1/money_requests', constraints: expect.arrayContaining([expect.objectContaining({ type: 'where', field: 'requestedFromId', value: 'user1' })]) }),
    ]));
    expect(listeners.some(item => item.target === 'families/fam1/savings_goals')).toBe(true);
    expect(queryShapes.some(shape => shape.target === 'families/fam1/savings_goals')).toBe(false);
    const walletQuery = queryShapes.find(shape => shape.target === 'families/fam1/wallet_transactions');
    expect(walletQuery?.constraints).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'orderBy' })]));
    const behaviourQuery = queryShapes.find(shape => shape.target === 'families/fam1/behaviour_events');
    expect(behaviourQuery?.constraints).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'orderBy' })]));

    emitAllChildSnapshots();
    expect(useStore.getState()).toMatchObject({ appReady: true, loading: false, bootstrapError: null });
  });

  it('normalizes and sorts mixed legacy and V2 wallet and behaviour histories client-side', () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');
    listener('families/fam1').next(familySnapshot());
    const legacyTime = { toMillis: () => 1_000 };
    const v2Time = { toMillis: () => 2_000 };

    listener('families/fam1/wallet_transactions').next(collectionSnapshot([
      { id: 'legacy-wallet', createdAt: legacyTime },
      { id: 'v2-wallet', timestamp: v2Time },
    ]));
    listener('families/fam1/behaviour_events').next(collectionSnapshot([
      { id: 'legacy-behaviour', createdAt: legacyTime },
      { id: 'v2-behaviour', timestamp: v2Time },
    ]));

    expect(useStore.getState().walletTransactions).toEqual([
      expect.objectContaining({ id: 'v2-wallet', timestamp: v2Time }),
      expect.objectContaining({ id: 'legacy-wallet', createdAt: legacyTime, timestamp: legacyTime }),
    ]);
    expect(useStore.getState().behaviourEvents).toEqual([
      expect.objectContaining({ id: 'v2-behaviour', timestamp: v2Time }),
      expect.objectContaining({ id: 'legacy-behaviour', createdAt: legacyTime, timestamp: legacyTime }),
    ]);
  });

  it('normalizes redemption snapshots newest-first by redeemedAt with createdAt fallback', () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');
    listener('families/fam1').next(familySnapshot());

    listener('families/fam1/redemptions').next(collectionSnapshot([
      { id: 'redemption-a', redeemedAt: { toMillis: () => 2_000 }, label: '2 weeks ago' },
      { id: 'redemption-b', redeemedAt: new Date(3_000), label: 'yesterday' },
      { id: 'redemption-c', redeemedAt: { toDate: () => new Date(1_000) }, label: '3 weeks ago' },
      { id: 'redemption-d', createdAt: { seconds: 4, nanoseconds: 0 }, label: 'today' },
    ]));

    expect(useStore.getState().redemptions.map(redemption => redemption.label)).toEqual([
      'today',
      'yesterday',
      '2 weeks ago',
      '3 weeks ago',
    ]);
  });

  it('orders equal-time redemptions deterministically by id', () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');
    listener('families/fam1').next(familySnapshot());
    const sameTime = { toMillis: () => 1_000 };

    listener('families/fam1/redemptions').next(collectionSnapshot([
      { id: 'redemption-z', redeemedAt: sameTime },
      { id: 'redemption-a', redeemedAt: sameTime },
    ]));

    expect(useStore.getState().redemptions.map(redemption => redemption.id)).toEqual([
      'redemption-a',
      'redemption-z',
    ]);
  });

  it('9. contains an optional bootstrap listener failure without tearing down critical data', () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');
    emitAllFamilySnapshots();
    listener('families/fam1/transfer_requests').error({ code: 'permission-denied', message: 'denied' });
    expect(useStore.getState()).toMatchObject({ appReady: true, loading: false, activeFamilyId: 'fam1' });
    expect(useStore.getState().bootstrapStatus.transferRequests).toBe('error');
    expect(useStore.getState().bootstrapError).toBeNull();
    expect(useStore.getState().featureErrors.transferRequests).toContain('permission-denied');
    expect(listener('families/fam1/tasks').unsubscribe).not.toHaveBeenCalled();
  });

  it('ignores queued reversal callbacks after the active family changes', async () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');
    useStore.getState().loadReversals();
    const oldReversals = listener('families/fam1/reversals');

    useStore.setState({ currentUser: { id: 'user1', familyId: 'fam2', role: 'parent' } });
    useStore.getState().loadFamilyData('user1', 'fam2');
    oldReversals.next(collectionSnapshot([{ id: 'stale-reversal' }]));
    oldReversals.error({ code: 'permission-denied', message: 'stale denial' });

    expect(useStore.getState().reversals).toEqual([]);
    expect(useStore.getState().featureErrors.reversals).toBeUndefined();
  });

  it('10. retry creates a fresh subscription generation', () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');
    listener('families/fam1').next(familySnapshot());
    const oldTask = listener('families/fam1/tasks');
    listener('families/fam1').error({ code: 'unavailable', message: 'offline' });
    useStore.getState().retryBootstrap();
    listener('families/fam1', 1).next(familySnapshot());
    expect(listener('families/fam1/tasks', 1)).toBeDefined();
    oldTask.next(collectionSnapshot([{ id: 'stale', title: 'Stale' }]));
    expect(useStore.getState().tasks).toEqual([]);
  });

  it('restarts auth/profile bootstrap when retrying before a profile resolved', async () => {
    useStore.getState().initAuth();
    await authNext!({ uid: 'user1', getIdToken: vi.fn().mockResolvedValue('token') });
    listener('users/user1').error({ code: 'permission-denied', message: 'denied' });
    useStore.getState().retryBootstrap();
    expect(onAuthStateChanged).toHaveBeenCalledTimes(2);
    expect(useStore.getState()).toMatchObject({ authInitialized: false, authUser: undefined, bootstrapError: null, loading: true });
  });

  it('11. logout unsubscribes profile and family listeners and clears scoped state', async () => {
    useStore.getState().initAuth();
    await authNext!({ uid: 'user1', getIdToken: vi.fn().mockResolvedValue('token') });
    const profile = listener('users/user1');
    profile.next({ exists: () => true, id: 'user1', data: () => ({ familyId: 'fam1', role: 'parent' }) });
    const familyUnsubscribes = listeners.slice(1).map(item => item.unsubscribe);
    await authNext!(null);
    expect(profile.unsubscribe).toHaveBeenCalledOnce();
    expect(familyUnsubscribes.every(unsubscribe => unsubscribe.mock.calls.length === 1)).toBe(true);
    expect(useStore.getState()).toMatchObject({ authUser: null, currentUser: null, familyData: null, activeFamilyId: null, appReady: true, loading: false });
  });

  it('12. family change unsubscribes the old generation and ignores its queued callbacks', async () => {
    useStore.getState().initAuth();
    await authNext!({ uid: 'user1', getIdToken: vi.fn().mockResolvedValue('token') });
    const profile = listener('users/user1');
    profile.next({ exists: () => true, id: 'user1', data: () => ({ familyId: 'fam1', role: 'parent' }) });
    listener('families/fam1').next(familySnapshot());
    const oldTask = listener('families/fam1/tasks');
    const oldUnsubscribes = listeners.slice(1).map(item => item.unsubscribe);
    profile.next({ exists: () => true, id: 'user1', data: () => ({ familyId: 'fam2', role: 'parent' }) });
    expect(oldUnsubscribes.every(unsubscribe => unsubscribe.mock.calls.length === 1)).toBe(true);
    listener('families/fam2').next({ ...familySnapshot(), id: 'fam2' });
    expect(listeners.some(item => item.target === 'families/fam2/tasks')).toBe(true);
    oldTask.next(collectionSnapshot([{ id: 'stale' }]));
    expect(useStore.getState().tasks).toEqual([]);
  });

  it('13. duplicate StrictMode-style initAuth calls attach one observer', () => {
    useStore.getState().initAuth();
    useStore.getState().initAuth();
    expect(onAuthStateChanged).toHaveBeenCalledTimes(1);
  });

  it('invalidates a pending token continuation after logout', async () => {
    useStore.getState().initAuth();
    const token = deferred<string>();
    const oldAuth = authNext!({ uid: 'user1', getIdToken: () => token.promise });
    await authNext!(null);
    token.resolve('token');
    await oldAuth;
    expect(listeners).toHaveLength(0);
    expect(useStore.getState().authUser).toBeNull();
  });

  it('recovers automatically when signup auth resolves before the profile is created', async () => {
    useStore.getState().initAuth();
    await authNext!({ uid: 'user1', getIdToken: vi.fn().mockResolvedValue('token') });
    const profile = listener('users/user1');
    profile.next({ exists: () => false, metadata: { fromCache: false } });
    expect(useStore.getState().bootstrapError).toContain('not-found');
    profile.next({
      exists: () => true,
      id: 'user1',
      data: () => ({ familyId: 'fam1', role: 'parent' }),
      metadata: { fromCache: false },
    });
    expect(useStore.getState().bootstrapError).toBeNull();
    expect(useStore.getState().activeFamilyId).toBe('fam1');
  });

  it('does not let a slower missing-profile server read undo a resolved profile listener', async () => {
    useStore.getState().initAuth();
    await authNext!({ uid: 'user1', getIdToken: vi.fn().mockResolvedValue('token') });
    listener('users/user1').next({
      exists: () => true,
      id: 'user1',
      data: () => ({ familyId: 'fam1', role: 'parent' }),
      metadata: { fromCache: false },
    });
    serverRead('users/user1').resolve({ exists: () => false });
    await Promise.resolve();
    expect(useStore.getState().bootstrapError).toBeNull();
    expect(useStore.getState().currentUser?.familyId).toBe('fam1');
  });

  it.each([['   '], [42], [{}]])('rejects malformed familyId %j without attaching family listeners', async familyId => {
    useStore.getState().initAuth();
    await authNext!({ uid: 'user1', getIdToken: vi.fn().mockResolvedValue('token') });
    listener('users/user1').next({
      exists: () => true,
      id: 'user1',
      data: () => ({ familyId, role: 'parent' }),
      metadata: { fromCache: false },
    });
    expect(listeners).toHaveLength(1);
    expect(useStore.getState().bootstrapError).toContain('familyId');
  });

  it('surfaces an auth observer error as recoverable', () => {
    useStore.getState().initAuth();
    authError!({ code: 'auth/network-request-failed', message: 'offline' });
    expect(useStore.getState()).toMatchObject({ appReady: false, loading: false });
    expect(useStore.getState().bootstrapError).toContain('network-request-failed');
    useStore.getState().retryBootstrap();
    expect(onAuthStateChanged).toHaveBeenCalledTimes(2);
    expect(useStore.getState()).toMatchObject({ bootstrapError: null, loading: true });
  });

  it('handles a missing family document as a recoverable bootstrap error', () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');
    listener('families/fam1').next(familySnapshot(false));
    expect(useStore.getState()).toMatchObject({ appReady: false, loading: false, familyData: null, activeFamilyId: null });
    expect(useStore.getState().bootstrapError).toContain('Family');
  });

  it('treats a family permission error as a critical whole-app bootstrap failure', () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');
    listener('families/fam1').error({ code: 'permission-denied', message: 'Missing or insufficient permissions' });

    expect(useStore.getState()).toMatchObject({
      appReady: false,
      loading: false,
      activeFamilyId: null,
      bootstrapError: '[Family] permission-denied: Missing or insufficient permissions',
    });
  });

  it('routes a resolved profile without familyId to onboarding-ready state and clears old data', async () => {
    useStore.setState({ familyData: { id: 'old' }, tasks: [{ id: 'old' }] });
    useStore.getState().initAuth();
    await authNext!({ uid: 'user1', getIdToken: vi.fn().mockResolvedValue('token') });
    listener('users/user1').next({ exists: () => true, id: 'user1', data: () => ({ role: 'parent' }) });
    expect(useStore.getState()).toMatchObject({ appReady: true, loading: false, activeFamilyId: null, familyData: null, tasks: [] });
  });

  it('subscribes to gamification summaries collection for parent role', () => {
    authenticatedState('fam1', 'parent');
    useStore.getState().loadFamilyData('user1', 'fam1');
    listener('families/fam1').next(familySnapshot());
    expect(listeners.some(item => item.target === 'families/fam1/gamification_summaries')).toBe(true);
    expect(listeners.some(item => item.target === 'families/fam1/daily_progress')).toBe(true);
  });

  it('subscribes to own gamification summary document for child role', () => {
    authenticatedState('fam1', 'child');
    useStore.getState().loadFamilyData('user1', 'fam1');
    listener('families/fam1').next(familySnapshot());
    expect(listeners.some(item => item.target === 'families/fam1/gamification_summaries/user1')).toBe(true);
    expect(listeners.some(item => item.target === 'families/fam1/daily_progress')).toBe(true);
  });

  it('clears gamification state on logout', () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');
    emitAllFamilySnapshots();
    expect(useStore.getState().gamificationSummaries).toEqual([]);
    expect(useStore.getState().dailyProgress).toEqual([]);

    // Simulate logout
    useStore.getState().cleanup();
    expect(useStore.getState().gamificationSummaries).toEqual([]);
    expect(useStore.getState().dailyProgress).toEqual([]);
    expect(useStore.getState().myGamificationSummary).toBeNull();
    expect(useStore.getState().myDailyProgress).toBeNull();
  });
});
