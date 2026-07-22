import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => {
  let id = 0;
  const collection = vi.fn((_db: unknown, path: string) => ({ path }));
  const doc = vi.fn((first: any, ...parts: string[]) => {
    if (parts.length) return { id: parts.at(-1), path: parts.join('/') };
    id += 1;
    return { id: `generated-${id}`, path: `${first?.path ?? 'db'}/generated-${id}` };
  });
  return {
    collection,
    doc,
    runTransaction: vi.fn(),
    serverTimestamp: vi.fn(() => ({ server: true })),
    getDocs: vi.fn(),
    setDoc: vi.fn(),
    writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn(async () => {}) })),
    onSnapshot: vi.fn(),
    getDoc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    reset: () => { id = 0; },
  };
});

const authState = vi.hoisted(() => ({ currentUser: { uid: 'owner-1' } as any }));

vi.mock('firebase/firestore', () => ({ ...firestore }));
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('./firebase', () => ({ db: { name: 'db' }, auth: authState, googleProvider: {} }));

import {
  completeTask,
  approveTaskCompletion,
  rejectTaskCompletion,
  redeemReward,
  addBehaviourEvent,
  depositToWallet,
  withdrawFromWallet,
  createTransferRequest,
  approveTransferRequest,
  rejectTransferRequest,
  contributeToFund,
  addFundExpense,
} from './api';

function snapshot(data?: Record<string, any>) {
  return { exists: () => data !== undefined, data: () => data };
}
function transactionWith(docs: Record<string, Record<string, any> | undefined>) {
  const tx = {
    get: vi.fn(async (ref: { path: string }) => snapshot(docs[ref.path])),
    update: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  };
  firestore.runTransaction.mockImplementation(async (_db: unknown, callback: any) => callback(tx));
  return tx;
}
function notifSets(tx: any) {
  return tx.set.mock.calls
    .filter((c: any[]) => c[0]?.path?.includes('/notifications/'))
    .map((c: any[]) => c[1]);
}
function notifByType(sets: any[], type: string) {
  return sets.find(s => s?.type === type);
}

const approvers = {
  docs: [
    { id: 'owner-1', data: () => ({ role: 'owner', familyId: 'fam1' }) },
    { id: 'parent-1', data: () => ({ role: 'parent', familyId: 'fam1' }) },
  ],
};
const children = {
  docs: [
    { id: 'child-1', data: () => ({ role: 'child', familyId: 'fam1' }) },
    { id: 'child-2', data: () => ({ role: 'child', familyId: 'fam1' }) },
  ],
};

describe('notification creation on business events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestore.reset();
    firestore.getDoc.mockResolvedValue(snapshot({ title: 'Clean bedroom', pointsReward: 20 }));
  });

  it('child task submission notifies parent/owner approvers', async () => {
    authState.currentUser = { uid: 'child-1' };
    firestore.getDocs.mockResolvedValue(approvers);
    const tx = transactionWith({
      'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0, lastActiveDate: null },
      'families/fam1/tasks/task-1': { title: 'Clean bedroom', pointsReward: 20 },
    });
    await completeTask('fam1', 'task-1', 'child-1', true);
    const n = notifByType(notifSets(tx), 'task_submitted');
    expect(n).toBeTruthy();
    expect(n.recipientIds).toEqual(['owner-1', 'parent-1']);
    expect(n.title).toBe('Muhammed completed a task');
    expect(n.body).toBe('Review “Clean bedroom”');
    expect(n.actionUrl).toBe('/');
    expect(n.dedupeKey).toMatch(/^task_submit_/);
  });

  it('task approval notifies the child', async () => {
    authState.currentUser = { uid: 'owner-1' };
    const tx = transactionWith({
      'families/fam1/task_completions/c1': { status: 'pending_approval', taskId: 'task-1', assigneeId: 'child-1' },
      'families/fam1/tasks/task-1': { title: 'Clean bedroom', pointsReward: 20 },
      'users/child-1': { familyId: 'fam1', role: 'child', rewardPoints: 5, lifetimeXP: 0 },
      'users/owner-1': { familyId: 'fam1', role: 'owner', displayName: 'Kemal' },
    });
    await approveTaskCompletion('fam1', 'c1', 'Great');
    const n = notifByType(notifSets(tx), 'task_approved');
    expect(n).toBeTruthy();
    expect(n.recipientIds).toEqual(['child-1']);
    expect(n.title).toBe('Task approved');
    expect(n.body).toContain('Clean bedroom');
    expect(n.body).toContain('+20 points');
    expect(n.dedupeKey).toBe('task_approve_c1');
  });

  it('task rejection notifies the child with the comment', async () => {
    authState.currentUser = { uid: 'owner-1' };
    const tx = transactionWith({
      'families/fam1/task_completions/c1': { status: 'pending_approval', taskId: 'task-1', assigneeId: 'child-1' },
      'families/fam1/tasks/task-1': { title: 'Clean bedroom' },
      'users/owner-1': { familyId: 'fam1', role: 'owner', displayName: 'Kemal' },
    });
    await rejectTaskCompletion('fam1', 'c1', 'Please redo');
    const n = notifByType(notifSets(tx), 'task_rejected');
    expect(n).toBeTruthy();
    expect(n.recipientIds).toEqual(['child-1']);
    expect(n.title).toBe('Task needs attention');
    expect(n.body).toContain('Please redo');
    expect(n.dedupeKey).toBe('task_reject_c1');
  });

  it('reward redemption notifies parent/owner approvers', async () => {
    authState.currentUser = { uid: 'child-1' };
    firestore.getDocs.mockResolvedValue(approvers);
    const tx = transactionWith({
      'families/fam1/rewards/r1': { title: '30 minutes gaming', cost: 50 },
      'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 100 },
    });
    await redeemReward('fam1', 'child-1', 'r1');
    const n = notifByType(notifSets(tx), 'reward_requested');
    expect(n).toBeTruthy();
    expect(n.recipientIds).toEqual(['owner-1', 'parent-1']);
    expect(n.title).toBe('Reward approval needed');
    expect(n.body).toContain('30 minutes gaming');
    expect(n.dedupeKey).toMatch(/^reward_request_/);
  });

  it('positive behaviour notifies the child', async () => {
    authState.currentUser = { uid: 'owner-1' };
    const tx = transactionWith({
      'families/fam1': { name: 'F', debtLimitPence: -5000 },
      'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'C1', rewardPoints: 0, lifetimeXP: 0 },
      'users/owner-1': { familyId: 'fam1', role: 'owner', displayName: 'Kemal' },
      'families/fam1/wallets/child-1': { balance: 0 },
    });
    await addBehaviourEvent('fam1', 'child-1', 'owner-1', { type: 'positive', reason: 'Helped out', pointsDelta: 1, walletDelta: 0 });
    const n = notifByType(notifSets(tx), 'behaviour_positive');
    expect(n).toBeTruthy();
    expect(n.recipientIds).toEqual(['child-1']);
    expect(n.title).toBe('Positive behaviour');
    expect(n.body).toBe('Helped out');
    expect(n.actionUrl).toBe('/family/child-1');
  });

  it('negative behaviour notifies the child', async () => {
    authState.currentUser = { uid: 'owner-1' };
    const tx = transactionWith({
      'families/fam1': { name: 'F', debtLimitPence: -5000 },
      'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'C1', rewardPoints: 0, lifetimeXP: 0 },
      'users/owner-1': { familyId: 'fam1', role: 'owner', displayName: 'Kemal' },
      'families/fam1/wallets/child-1': { balance: 0 },
    });
    await addBehaviourEvent('fam1', 'child-1', 'owner-1', { type: 'negative', reason: 'Hit sibling', pointsDelta: -1, walletDelta: 0 });
    const n = notifByType(notifSets(tx), 'behaviour_negative');
    expect(n).toBeTruthy();
    expect(n.recipientIds).toEqual(['child-1']);
    expect(n.title).toBe('Behaviour needs attention');
  });

  it('wallet deposit notifies the child', async () => {
    authState.currentUser = { uid: 'owner-1' };
    const tx = transactionWith({
      'users/child-1': { familyId: 'fam1', role: 'child' },
      'families/fam1/wallets/child-1': { balance: 0 },
    });
    await depositToWallet('fam1', 'child-1', 'owner-1', 500, 'Allowance');
    const n = notifByType(notifSets(tx), 'wallet_deposit');
    expect(n).toBeTruthy();
    expect(n.recipientIds).toEqual(['child-1']);
    expect(n.body).toContain('£5.00');
    expect(n.actionUrl).toBe('/wallet');
  });

  it('wallet withdrawal notifies the child', async () => {
    authState.currentUser = { uid: 'owner-1' };
    const tx = transactionWith({
      'users/child-1': { familyId: 'fam1', role: 'child' },
      'families/fam1/wallets/child-1': { balance: 1000 },
    });
    await withdrawFromWallet('fam1', 'child-1', 'owner-1', 200, 'Treat');
    const n = notifByType(notifSets(tx), 'wallet_withdrawal');
    expect(n).toBeTruthy();
    expect(n.recipientIds).toEqual(['child-1']);
    expect(n.body).toContain('£2.00');
  });

  it('transfer request notifies parent/owner approvers', async () => {
    authState.currentUser = { uid: 'child-1' };
    firestore.getDocs.mockResolvedValue(approvers);
    const tx = transactionWith({
      'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed' },
      'users/child-2': { familyId: 'fam1', role: 'child', displayName: 'Osman' },
      'families/fam1/wallets/child-1': { balance: 500 },
    });
    await createTransferRequest('fam1', 'child-2', 500, 'Thanks');
    const n = notifByType(notifSets(tx), 'transfer_requested');
    expect(n).toBeTruthy();
    expect(n.recipientIds).toEqual(['owner-1', 'parent-1']);
    expect(n.title).toBe('Transfer approval needed');
    expect(n.body).toContain('Osman');
    expect(n.dedupeKey).toMatch(/^transfer_request_/);
  });

  it('transfer approval notifies sender and recipient distinctly', async () => {
    authState.currentUser = { uid: 'owner-1' };
    const tx = transactionWith({
      'families/fam1/transfer_requests/req1': {
        status: 'pending', fromChildId: 'child-1', toChildId: 'child-2',
        fromChildName: 'Muhammed', toChildName: 'Osman', amountPence: 500, message: 'hi',
      },
      'users/owner-1': { familyId: 'fam1', role: 'owner', displayName: 'Kemal' },
      'users/child-1': { familyId: 'fam1', role: 'child' },
      'users/child-2': { familyId: 'fam1', role: 'child' },
      'families/fam1/wallets/child-1': { balance: 500 },
      'families/fam1/wallets/child-2': { balance: 0 },
    });
    await approveTransferRequest('fam1', 'req1');
    const sets = notifSets(tx);
    const sender = sets.find((s: any) => s.recipientIds[0] === 'child-1');
    const recipient = sets.find((s: any) => s.recipientIds[0] === 'child-2');
    expect(sender).toBeTruthy();
    expect(sender.title).toBe('Transfer approved');
    expect(sender.body).toContain('Osman');
    expect(sender.dedupeKey).toBe('transfer_approve_sender_req1');
    expect(recipient).toBeTruthy();
    expect(recipient.title).toBe('Transfer received');
    expect(recipient.body).toContain('£5.00');
    expect(recipient.body).toContain('Muhammed');
    expect(recipient.dedupeKey).toBe('transfer_approve_recipient_req1');
  });

  it('transfer rejection notifies the sender', async () => {
    authState.currentUser = { uid: 'owner-1' };
    const tx = transactionWith({
      'families/fam1/transfer_requests/req1': { status: 'pending', fromChildId: 'child-1', toChildName: 'Osman' },
      'users/owner-1': { familyId: 'fam1', role: 'owner', displayName: 'Kemal' },
    });
    await rejectTransferRequest('fam1', 'req1', 'Not now');
    const n = notifByType(notifSets(tx), 'transfer_rejected');
    expect(n).toBeTruthy();
    expect(n.recipientIds).toEqual(['child-1']);
    expect(n.body).toContain('Not now');
    expect(n.dedupeKey).toBe('transfer_reject_req1');
  });

  it('pet box contribution notifies parent/owner approvers', async () => {
    authState.currentUser = { uid: 'child-1' };
    firestore.getDocs.mockResolvedValue(approvers);
    const tx = transactionWith({});
    await contributeToFund('fam1', 'fund1', 'child-1', 300, 'Buddy', 'Muhammed');
    const n = notifByType(notifSets(tx), 'petbox_contribution');
    expect(n).toBeTruthy();
    expect(n.recipientIds).toEqual(['owner-1', 'parent-1']);
    expect(n.title).toBe('Pet Box contribution');
    expect(n.body).toContain('£3.00');
    expect(n.body).toContain('Buddy');
  });

  it('pet box expense notifies children', async () => {
    authState.currentUser = { uid: 'owner-1' };
    firestore.getDocs.mockResolvedValue(children);
    const tx = transactionWith({
      'families/fam1/funds/fund1': { balance: 0 },
    });
    await addFundExpense('fam1', 'fund1', { amount: 200, category: 'food', description: 'Food', fundName: 'Buddy' });
    const n = notifByType(notifSets(tx), 'petbox_expense');
    expect(n).toBeTruthy();
    expect(n.recipientIds).toEqual(['child-1', 'child-2']);
    expect(n.title).toBe('Pet Box update');
    expect(n.body).toContain('£2.00');
  });

  it('reusing a dedupeKey does not create a duplicate notification', async () => {
    authState.currentUser = { uid: 'owner-1' };
    // First approval creates the notification doc.
    const tx1 = transactionWith({
      'families/fam1/transfer_requests/req1': {
        status: 'pending', fromChildId: 'child-1', toChildId: 'child-2',
        fromChildName: 'Muhammed', toChildName: 'Osman', amountPence: 500, message: 'hi',
      },
      'users/owner-1': { familyId: 'fam1', role: 'owner', displayName: 'Kemal' },
      'users/child-1': { familyId: 'fam1', role: 'child' },
      'users/child-2': { familyId: 'fam1', role: 'child' },
      'families/fam1/wallets/child-1': { balance: 500 },
      'families/fam1/wallets/child-2': { balance: 0 },
    });
    await approveTransferRequest('fam1', 'req1');
    expect(notifSets(tx1).filter((s: any) => s.type === 'transfer_approved')).toHaveLength(2);

    // Second approval: the notification docs already exist, so no new writes.
    const existing = {
      'families/fam1/transfer_requests/req1': {
        status: 'pending', fromChildId: 'child-1', toChildId: 'child-2',
        fromChildName: 'Muhammed', toChildName: 'Osman', amountPence: 500, message: 'hi',
      },
      'users/owner-1': { familyId: 'fam1', role: 'owner', displayName: 'Kemal' },
      'users/child-1': { familyId: 'fam1', role: 'child' },
      'users/child-2': { familyId: 'fam1', role: 'child' },
      'families/fam1/wallets/child-1': { balance: 500 },
      'families/fam1/wallets/child-2': { balance: 0 },
      'families/fam1/notifications/transfer_approve_sender_req1': { recipientIds: ['child-1'] },
      'families/fam1/notifications/transfer_approve_recipient_req1': { recipientIds: ['child-2'] },
    };
    const tx2 = transactionWith(existing);
    await approveTransferRequest('fam1', 'req1');
    // The two notification sets are skipped because the docs already exist.
    expect(notifSets(tx2).filter((s: any) => s?.type === 'transfer_approved')).toHaveLength(0);
  });
});

describe('recipient failure behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestore.reset();
    firestore.getDoc.mockResolvedValue(snapshot({ title: 'Clean bedroom', pointsReward: 20 }));
  });

  it('completeTask still creates the completion when approvers cannot be resolved', async () => {
    authState.currentUser = { uid: 'child-1' };
    firestore.getDocs.mockResolvedValue({ docs: [] }); // resolution fails -> no approvers
    const tx = transactionWith({
      'users/child-1': { familyId: 'fam1', role: 'child', displayName: 'Muhammed', rewardPoints: 0, lifetimeXP: 0, lastActiveDate: null },
      'families/fam1/tasks/task-1': { title: 'Clean bedroom', pointsReward: 20 },
    });
    await completeTask('fam1', 'task-1', 'child-1', true);
    // No task_submitted notification was queued (non-fatal).
    expect(notifByType(notifSets(tx), 'task_submitted')).toBeUndefined();
    // But the completion document was still written (business action succeeded).
    const completionSets = tx.set.mock.calls.filter((c: any[]) => c[0]?.path?.includes('/task_completions/'));
    expect(completionSets.length).toBeGreaterThan(0);
  });

  it('excludes the actor from notification recipients (task approval)', async () => {
    authState.currentUser = { uid: 'owner-1' };
    const tx = transactionWith({
      'families/fam1/task_completions/c1': { status: 'pending_approval', taskId: 'task-1', assigneeId: 'child-1' },
      'families/fam1/tasks/task-1': { title: 'Clean bedroom', pointsReward: 20 },
      'users/child-1': { familyId: 'fam1', role: 'child', rewardPoints: 5, lifetimeXP: 0 },
      'users/owner-1': { familyId: 'fam1', role: 'owner', displayName: 'Kemal' },
    });
    await approveTaskCompletion('fam1', 'c1', 'Great');
    const n = notifByType(notifSets(tx), 'task_approved');
    expect(n).toBeTruthy();
    expect(n.recipientIds).toEqual(['child-1']);
    expect(n.recipientIds).not.toContain('owner-1');
  });

  it('excludes the actor from transfer approval recipients', async () => {
    authState.currentUser = { uid: 'owner-1' };
    const tx = transactionWith({
      'families/fam1/transfer_requests/req1': { status: 'pending', fromChildId: 'child-1', toChildId: 'child-2', fromChildName: 'Muhammed', toChildName: 'Osman', amountPence: 500, message: 'hi' },
      'users/owner-1': { familyId: 'fam1', role: 'owner', displayName: 'Kemal' },
      'users/child-1': { familyId: 'fam1', role: 'child' },
      'users/child-2': { familyId: 'fam1', role: 'child' },
      'families/fam1/wallets/child-1': { balance: 500 },
      'families/fam1/wallets/child-2': { balance: 0 },
    });
    await approveTransferRequest('fam1', 'req1');
    const sets = notifSets(tx);
    const sender = sets.find((s: any) => s.recipientIds[0] === 'child-1');
    const recipient = sets.find((s: any) => s.recipientIds[0] === 'child-2');
    expect(sender.recipientIds).not.toContain('owner-1');
    expect(recipient.recipientIds).not.toContain('owner-1');
  });
});
