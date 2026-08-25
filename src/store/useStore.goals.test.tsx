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
let authNext: ((user: any) => Promise<void> | void) | undefined;
let authError: ((error: any) => void) | undefined;
const authUnsubscribe = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, path: string) => path),
  doc: vi.fn((_db: unknown, collectionOrPath: string, id?: string) => (id ? `${collectionOrPath}/${id}` : collectionOrPath)),
  query: vi.fn((target: string, ..._constraints: any[]) => target),
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

import { useStore, goalContributionBreakdown } from '../../src/store/useStore';

function listener(target: string, occurrence = 0) {
  const matches = listeners.filter(item => item.target === target);
  const found = matches[occurrence];
  if (!found) throw new Error(`No listener for ${target} at ${occurrence}`);
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

function authenticatedState(familyId = 'fam1', role = 'parent') {
  useStore.setState({
    authInitialized: true,
    authUser: { uid: 'user1' },
    currentUser: { id: 'user1', familyId, role },
  });
}

const GOAL_ID = 'goal-1';

// Bootstrap is two-stage: non-critical resources (savings_goals and its nested
// subcollections) only subscribe once every critical resource has resolved.
function completeCriticalBootstrap() {
  listener('families/fam1').next(familySnapshot());
  listener('families/fam1/tasks').next(collectionSnapshot());
  listener('families/fam1/rewards').next(collectionSnapshot());
  listener('families/fam1/wallets').next(collectionSnapshot());
  listener('users').next(collectionSnapshot());
}

describe('goals store + bootstrap wiring', () => {
  beforeEach(() => {
    useStore.getState().cleanup();
    listeners.length = 0;
    serverReads.length = 0;
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

  it('exposes goals + contributions + requests + match proposals after bootstrap', () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');

    // Family doc + savings_goals (legacy collection reused as goals).
    completeCriticalBootstrap();
    listener('families/fam1/savings_goals').next(
      collectionSnapshot([{ id: GOAL_ID, title: 'Bike', targetAmountPence: 10000, currentAmountPence: 0, status: 'active' }]),
    );

    // The store must now subscribe to the goal's nested subcollections.
    const contribListener = listener(`families/fam1/savings_goals/${GOAL_ID}/contributions`);
    const ledgerListener = listener(`families/fam1/savings_goals/${GOAL_ID}/goal_ledger`);
    const proposalListener = listener(`families/fam1/savings_goals/${GOAL_ID}/match_proposals`);
    expect(contribListener).toBeDefined();
    expect(ledgerListener).toBeDefined();
    expect(proposalListener).toBeDefined();

    // Emit subcollection data.
    contribListener.next(collectionSnapshot([
      { id: 'c1', type: 'child_contribution', ownerId: 'user1', ownerType: 'child', amountPence: 500 },
      { id: 'c2', type: 'parent_contribution', ownerId: 'user1', ownerType: 'parent', amountPence: 2000 },
    ]));
    ledgerListener.next(collectionSnapshot([
      { id: 'l1', type: 'child_contribution', ownerId: 'user1', amountPence: 500 },
    ]));
    proposalListener.next(collectionSnapshot([
      { id: 'p1', type: 'match_proposal', proposedMatchAmountPence: 250, status: 'proposed' },
    ]));

    const state = useStore.getState();
    expect(state.savingsGoals).toHaveLength(1);
    expect(state.savingsGoals[0].id).toBe(GOAL_ID);
    expect(state.goalContributions).toHaveLength(2);
    expect(state.goalLedger).toHaveLength(1);
    expect(state.goalMatchProposals).toHaveLength(1);
    expect(state.bootstrapStatus.goalContributions).toBe('ready');
    expect(state.bootstrapStatus.goalLedger).toBe('ready');
    expect(state.bootstrapStatus.goalMatchProposals).toBe('ready');
  });

  it('legacy savingsGoals data still loads alongside goal subcollections', () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');

    completeCriticalBootstrap();
    listener('families/fam1/savings_goals').next(
      collectionSnapshot([
        { id: 'legacy-1', title: 'Old goal', targetAmount: 50 },
        { id: GOAL_ID, title: 'New goal', targetAmountPence: 10000, currentAmountPence: 0, status: 'active' },
      ]),
    );

    expect(useStore.getState().savingsGoals).toHaveLength(2);
    // Subcollection listeners created for both goals.
    expect(listener(`families/fam1/savings_goals/legacy-1/contributions`)).toBeDefined();
    expect(listener(`families/fam1/savings_goals/${GOAL_ID}/contributions`)).toBeDefined();
  });

  it('keeps only family and own goals in a child store and never plans sibling goal subcollections', () => {
    authenticatedState('fam1', 'child');
    useStore.getState().loadFamilyData('user1', 'fam1');

    listener('families/fam1').next(familySnapshot());
    listener('families/fam1/savings_goals').next(collectionSnapshot([
      { id: 'family-goal', kind: 'family', title: 'Family holiday' },
      { id: 'own-goal', kind: 'child', childId: 'user1', title: 'My bike' },
      { id: 'sibling-goal', kind: 'child', childId: 'user2', title: 'Sibling console' },
    ]));

    expect(useStore.getState().savingsGoals.map(goal => goal.id)).toEqual([
      'family-goal',
      'own-goal',
    ]);
    expect(listener('families/fam1/savings_goals/family-goal/contributions')).toBeDefined();
    expect(listener('families/fam1/savings_goals/own-goal/contributions')).toBeDefined();
    expect(listeners.some(item => item.target.includes('/sibling-goal/'))).toBe(false);

    listener('families/fam1/savings_goals/family-goal/contributions').next(
      collectionSnapshot([{ id: 'family-contribution', goalId: 'family-goal' }]),
    );
    listener('families/fam1/savings_goals/own-goal/goal_ledger').next(
      collectionSnapshot([{ id: 'own-ledger', goalId: 'own-goal' }]),
    );
    listener('families/fam1/savings_goals/family-goal/match_proposals').next(
      collectionSnapshot([{ id: 'family-proposal', goalId: 'family-goal' }]),
    );

    expect(useStore.getState().goalContributions.map(item => item.id)).toEqual(['family-contribution']);
    expect(useStore.getState().goalLedger.map(item => item.id)).toEqual(['own-ledger']);
    expect(useStore.getState().goalMatchProposals.map(item => item.id)).toEqual(['family-proposal']);
  });

  it('normalizes a missing-kind legacy family goal before child filtering and sublistener planning', () => {
    authenticatedState('fam1', 'child');
    useStore.getState().loadFamilyData('user1', 'fam1');

    listener('families/fam1').next(familySnapshot());
    listener('families/fam1/savings_goals').next(collectionSnapshot([
      { id: 'legacy-family', title: 'Legacy family holiday', targetAmount: 75, currentAmount: 12.5 },
      { id: 'own-goal', kind: 'child', childId: 'user1', title: 'My bike' },
      { id: 'sibling-goal', kind: 'child', childId: 'user2', title: 'Sibling console' },
    ]));

    expect(useStore.getState().savingsGoals).toEqual([
      expect.objectContaining({
        id: 'legacy-family',
        goalId: 'legacy-family',
        kind: 'family',
        targetAmountPence: 7500,
        currentAmountPence: 1250,
      }),
      expect.objectContaining({ id: 'own-goal', kind: 'child', childId: 'user1' }),
    ]);
    expect(listener('families/fam1/savings_goals/legacy-family/contributions')).toBeDefined();
    expect(listeners.some(item => item.target.includes('/sibling-goal/'))).toBe(false);
  });

  it('keeps every family child goal and its subcollection plan for a parent', () => {
    authenticatedState('fam1', 'parent');
    useStore.getState().loadFamilyData('user1', 'fam1');

    listener('families/fam1').next(familySnapshot());
    listener('families/fam1/savings_goals').next(collectionSnapshot([
      { id: 'family-goal', kind: 'family', title: 'Family holiday' },
      { id: 'child-one-goal', kind: 'child', childId: 'child1', title: 'First bike' },
      { id: 'child-two-goal', kind: 'child', childId: 'child2', title: 'Second console' },
    ]));

    expect(useStore.getState().savingsGoals.map(goal => goal.id)).toEqual([
      'family-goal',
      'child-one-goal',
      'child-two-goal',
    ]);
    expect(listener('families/fam1/savings_goals/child-one-goal/goal_ledger')).toBeDefined();
    expect(listener('families/fam1/savings_goals/child-two-goal/goal_ledger')).toBeDefined();
  });

  it('goalContributionBreakdown groups by type/ownerId from the goal ledger', () => {
    const contributions = [
      { id: 'c1', type: 'child_contribution', ownerId: 'user1', ownerType: 'child', amountPence: 500 },
      { id: 'c2', type: 'child_contribution', ownerId: 'user1', ownerType: 'child', amountPence: 300 },
      { id: 'c3', type: 'parent_contribution', ownerId: 'user1', ownerType: 'parent', amountPence: 2000 },
      { id: 'c4', type: 'auto_match', ownerId: 'user1', ownerType: 'parent', amountPence: 150 },
      { id: 'c5', type: 'child_withdrawal', ownerId: 'user1', ownerType: 'child', amountPence: -200 },
    ];
    const breakdown = goalContributionBreakdown(contributions);
    const byKey = Object.fromEntries(
      breakdown.map(group => [`${group.type}::${group.ownerId}`, group]),
    );
    expect(byKey['child_contribution::user1'].totalPence).toBe(800);
    expect(byKey['child_contribution::user1'].count).toBe(2);
    expect(byKey['parent_contribution::user1'].totalPence).toBe(2000);
    expect(byKey['auto_match::user1'].totalPence).toBe(150);
    expect(byKey['child_withdrawal::user1'].totalPence).toBe(-200);
    // Parent/match funds are kept distinct from child contributions.
    expect(byKey['parent_contribution::user1']).not.toBe(byKey['child_contribution::user1']);
  });

  it('does not surface goal subcollection listener errors as bootstrap failures', () => {
    authenticatedState();
    useStore.getState().loadFamilyData('user1', 'fam1');
    completeCriticalBootstrap();
    listener('families/fam1/savings_goals').next(collectionSnapshot([{ id: GOAL_ID, title: 'Bike' }]));

    const contribListener = listener(`families/fam1/savings_goals/${GOAL_ID}/contributions`);
    contribListener.error(new Error('permission-denied'));

    const state = useStore.getState();
    // The optional listener error is recorded as a feature error and marks the
    // resource status 'error', but it must NOT tear down the whole bootstrap
    // (no fatal bootstrapError, family stays active, app still ready).
    expect(state.featureErrors['goalContributions:goal-1']).toBeTruthy();
    expect(state.bootstrapStatus.goalContributions).toBe('error');
    expect(state.bootstrapError).toBeNull();
    expect(state.activeFamilyId).toBe('fam1');
  });
});
