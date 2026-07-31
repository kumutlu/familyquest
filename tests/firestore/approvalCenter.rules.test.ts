import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

let testEnv: any;
const projectId = 'familyquest-beta-approval';
const familyId = 'family123';
const parentId = 'parent456';
const childId = 'child789';
const siblingId = 'sibling012';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (context: any) => {
    const db = context.firestore();
    // The family document must exist: rules only grant access to an existing,
    // active family (see familyIsActive in firestore.rules).
    await setDoc(doc(db, 'families', familyId), { name: 'Family', currencyCode: 'GBP' });

    // Parent
    await setDoc(doc(db, 'users', parentId), {
      familyId,
      role: 'parent',
      displayName: 'Kemal'
    });
    await setDoc(doc(db, 'users', 'owner123'), { familyId, role: 'owner', displayName: 'Owner' });
    await setDoc(doc(db, 'users', 'otherParent'), { familyId: 'other-family', role: 'parent', displayName: 'Other' });
    await setDoc(doc(db, 'users', 'joiner1'), { uid: 'joiner1', role: 'parent', displayName: 'New Child' });
    await setDoc(doc(db, `families/${familyId}/join_requests`, 'joiner1'), {
      uid: 'joiner1', displayName: 'New Child', status: 'pending', createdAt: serverTimestamp(),
    });

    // Child 1
    await setDoc(doc(db, 'users', childId), {
      familyId,
      role: 'child',
      displayName: 'Alin Asya',
      rewardPoints: 100,
      lifetimeXP: 100
    });

    // Child 2
    await setDoc(doc(db, 'users', siblingId), {
      familyId,
      role: 'child',
      displayName: 'Muhammed Osman',
      rewardPoints: 50,
      lifetimeXP: 50
    });

    // Wallets
    await setDoc(doc(db, `families/${familyId}/wallets`, childId), {
      balance: 500,
      createdAt: serverTimestamp(),
      migratedFromLegacy: true
    });
    await setDoc(doc(db, `families/${familyId}/wallets`, siblingId), {
      balance: 100,
      createdAt: serverTimestamp(),
      migratedFromLegacy: true
    });

    // Setup initial data for various requests

    // 1. Task Completion
    await setDoc(doc(db, `families/${familyId}/tasks`, 'task1'), {
      title: 'Clean Room',
      pointsReward: 50
    });
    await setDoc(doc(db, `families/${familyId}/task_completions`, 'comp1'), {
      taskId: 'task1',
      assigneeId: childId,
      status: 'pending_approval'
    });

    // 2. Transfer Request
    await setDoc(doc(db, `families/${familyId}/transfer_requests`, 'trans1'), {
      fromChildId: childId,
      toChildId: siblingId,
      amountPence: 100,
      status: 'pending'
    });

    // 3. Money Request
    await setDoc(doc(db, `families/${familyId}/money_requests`, 'money1'), {
      requesterId: siblingId,
      requestedFromId: childId,
      amountPence: 100,
      status: 'pending' // parent approval phase
    });

    // 4. Pet Box Request
    await setDoc(doc(db, `families/${familyId}/funds`, 'fund1'), {
      name: 'Cat Shelter',
      balance: 1000
    });
    await setDoc(doc(db, `families/${familyId}/petbox_requests`, 'pet1'), {
      childId: childId,
      fundId: 'fund1',
      amountPence: 100,
      status: 'pending'
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Approval Center Actions', () => {

  it('denies direct client-created join requests, including requester-supplied roles', async () => {
    const db = testEnv.authenticatedContext('joiner1').firestore();
    await assertFails(setDoc(doc(db, `families/${familyId}/join_requests/forged`), {
      uid: 'joiner1',
      displayName: 'New Child',
      status: 'pending',
      requestedRole: 'parent',
      createdAt: serverTimestamp(),
    }));
  });

  it('lets a pending requester read only their request, not private family data', async () => {
    const db = testEnv.authenticatedContext('joiner1').firestore();
    await assertSucceeds(getDoc(doc(db, `families/${familyId}/join_requests/joiner1`)));
    await assertFails(getDoc(doc(db, `families/${familyId}`)));
    await assertFails(getDoc(doc(db, `families/${familyId}/wallets/${childId}`)));
  });

  it('originator can cancel a pending transfer without moving balances', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertSucceeds(updateDoc(doc(db, `families/${familyId}/transfer_requests`, 'trans1'), {
      status: 'cancelled', cancelledBy: childId, cancelledAt: serverTimestamp(),
    }));

    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      const adminDb = context.firestore();
      const [sender, recipient] = await Promise.all([
        getDoc(doc(adminDb, `families/${familyId}/wallets`, childId)),
        getDoc(doc(adminDb, `families/${familyId}/wallets`, siblingId)),
      ]);
      if (sender.data()?.balance !== 500 || recipient.data()?.balance !== 100) throw new Error('Cancellation moved a balance');
    });
  });

  it('parent can cancel a child-created pending transfer without moving balances', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertSucceeds(updateDoc(doc(db, `families/${familyId}/transfer_requests`, 'trans1'), {
      status: 'cancelled', cancelledBy: parentId, cancelledAt: serverTimestamp(),
    }));
  });

  it('sibling cannot cancel another child’s pending transfer', async () => {
    const db = testEnv.authenticatedContext(siblingId).firestore();
    await assertFails(updateDoc(doc(db, `families/${familyId}/transfer_requests`, 'trans1'), {
      status: 'cancelled', cancelledBy: siblingId, cancelledAt: serverTimestamp(),
    }));
  });

  it('denies arbitrary parent child-profile counters and free reward history', async () => {
    const parentDb = testEnv.authenticatedContext(parentId).firestore();
    await assertFails(updateDoc(doc(parentDb, 'users', childId), { rewardPoints: 999, lifetimeXP: 999 }));

    const childDb = testEnv.authenticatedContext(childId).firestore();
    await assertFails(setDoc(doc(childDb, `families/${familyId}/redemptions/free-reward`), {
      rewardId: 'missing-reward', userId: childId, costPaid: 1, redeemedAt: serverTimestamp(), createdAt: serverTimestamp(), status: 'completed',
      familyId, sourceId: 'free-reward', actorId: childId,
      effectSnapshot: { schemaVersion: 1, entityType: 'reward_redemption', familyId, actorId: childId, childId, rewardId: 'missing-reward', pointsDelta: -1, xpAdjustment: 0 },
    }));
  });

  it('denies arbitrary standalone migrated wallet balances', async () => {
    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      await setDoc(doc(context.firestore(), 'users', 'new-child'), { familyId, role: 'child', walletBalance: 25 });
    });
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertFails(setDoc(doc(db, `families/${familyId}/wallets/new-child`), {
      balance: 999, createdAt: serverTimestamp(), migratedFromLegacy: true,
    }));
  });

  it('denies replaying an unrelated approved request to create an arbitrary wallet', async () => {
    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', 'new-child'), { familyId, role: 'child', walletBalance: 25 });
      await setDoc(doc(db, `families/${familyId}/money_requests/old-approved`), {
        requesterId: siblingId, requestedFromId: parentId, amountPence: 100, status: 'approved', paymentTransferId: 'old-payment',
      });
    });
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertFails(setDoc(doc(db, `families/${familyId}/wallets/new-child`), {
      balance: 999, createdAt: serverTimestamp(), migratedFromLegacy: true,
      lastTransferTxId: 'old-payment_in', lastTransferReqId: 'old-approved',
    }));
  });

  it('denies a standalone Pet Box wallet ledger', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertFails(setDoc(doc(db, `families/${familyId}/wallet_transactions/fake-pet`), {
      type: 'petbox_donation', childId, amountPence: -100, amount: -100, note: 'forged', sourceId: 'pet1',
      createdAt: serverTimestamp(), timestamp: serverTimestamp(),
    }));
  });

  it('denies standalone fabricated fund ledger history', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(setDoc(doc(db, `families/${familyId}/fund_transactions/fake`), {
      fundId: 'fund1', type: 'contribution', amount: 100, fromUserId: childId, createdAt: serverTimestamp(),
    }));
  });

  it('denies terminal join transition without its profile, wallet, and feed', async () => {
    const db = testEnv.authenticatedContext('owner123').firestore();
    await assertFails(updateDoc(doc(db, `families/${familyId}/join_requests/joiner1`), {
      status: 'approved', assignedRole: 'child', reviewedBy: 'owner123', reviewedByName: 'Owner', reviewedAt: serverTimestamp(),
    }));
  });

  it('denies standalone partial transfer and Pet Box financial effects', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    const transferBatch = writeBatch(db);
    transferBatch.update(doc(db, `families/${familyId}/wallets`, childId), {
      balance: 400, lastTransferTxId: 'partial_out', lastTransferReqId: 'trans1',
    });
    transferBatch.set(doc(db, `families/${familyId}/wallet_transactions/partial_out`), {
      type: 'transfer_out', childId, counterpartyChildId: siblingId, amountPence: -100,
      transferRequestId: 'trans1', approvalTxId: 'partial', createdAt: serverTimestamp(), parentRef: parentId, note: '',
    });
    await assertFails(transferBatch.commit());

    const petBatch = writeBatch(db);
    petBatch.update(doc(db, `families/${familyId}/wallets`, childId), {
      balance: 400, lastTransferTxId: 'partial_pet', lastTransferReqId: 'pet1',
    });
    petBatch.set(doc(db, `families/${familyId}/wallet_transactions/partial_pet`), {
      type: 'petbox_donation', childId, amountPence: -100, amount: -100, note: 'partial', sourceId: 'pet1',
      createdAt: serverTimestamp(), timestamp: serverTimestamp(),
    });
    await assertFails(petBatch.commit());
  });

  it('approves a parent-funded money request into an existing wallet', async () => {
    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      await setDoc(doc(context.firestore(), `families/${familyId}/money_requests/money-parent`), {
        requesterId: siblingId, requestedFromId: parentId, amountPence: 100, status: 'pending',
      });
    });
    const db = testEnv.authenticatedContext(parentId).firestore();
    const batch = writeBatch(db);
    batch.update(doc(db, `families/${familyId}/wallets`, siblingId), {
      balance: 200, lastTransferTxId: 'parent_pay_in', lastTransferReqId: 'money-parent',
    });
    batch.set(doc(db, `families/${familyId}/wallet_transactions/parent_pay_in`), {
      type: 'request_payment', childId: siblingId, amount: 100, amountPence: 100,
      moneyRequestId: 'money-parent', approvalTxId: 'parent_pay', note: 'Money Requested', parentRef: parentId,
      createdAt: serverTimestamp(), timestamp: serverTimestamp(),
    });
    batch.update(doc(db, `families/${familyId}/money_requests/money-parent`), {
      status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: parentId, reviewedByName: 'Kemal', paymentTransferId: 'parent_pay',
    });
    await assertSucceeds(batch.commit());
  });

  it.each([['zero-new', 0], ['integer-legacy', 35]])('approves parent-funded money into a %s wallet', async (suffix, legacyBalance) => {
    const target = `money-child-${suffix}`;
    const requestId = `money-${suffix}`;
    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      await setDoc(doc(context.firestore(), 'users', target), { familyId, role: 'child', rewardPoints: 0, lifetimeXP: 0, ...(legacyBalance ? { walletBalance: legacyBalance } : {}) });
      await setDoc(doc(context.firestore(), `families/${familyId}/money_requests/${requestId}`), {
        requesterId: target, requestedFromId: parentId, amountPence: 100, status: 'pending',
      });
    });
    const db = testEnv.authenticatedContext(parentId).firestore();
    const batch = writeBatch(db);
    const approvalId = `pay-${suffix}`;
    batch.set(doc(db, `families/${familyId}/wallets/${target}`), {
      balance: legacyBalance + 100, createdAt: serverTimestamp(), migratedFromLegacy: true,
      lastTransferTxId: `${approvalId}_in`, lastTransferReqId: requestId,
    });
    batch.set(doc(db, `families/${familyId}/wallet_transactions/${approvalId}_in`), {
      type: 'request_payment', childId: target, amount: 100, amountPence: 100, moneyRequestId: requestId,
      approvalTxId: approvalId, note: 'Money Requested', parentRef: parentId, createdAt: serverTimestamp(), timestamp: serverTimestamp(),
    });
    batch.update(doc(db, `families/${familyId}/money_requests/${requestId}`), {
      status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: parentId, reviewedByName: 'Kemal', paymentTransferId: approvalId,
    });
    await assertSucceeds(batch.commit());
  });

  it('approves a transfer with both wallets missing using exact typed creates', async () => {
    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', 'sender-new'), { familyId, role: 'child', walletBalance: 250 });
      await setDoc(doc(db, 'users', 'recipient-new'), { familyId, role: 'child' });
      await setDoc(doc(db, `families/${familyId}/transfer_requests/new-transfer`), {
        fromChildId: 'sender-new', toChildId: 'recipient-new', amountPence: 100, status: 'pending',
      });
    });
    const db = testEnv.authenticatedContext(parentId).firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, `families/${familyId}/wallets/sender-new`), {
      balance: 150, createdAt: serverTimestamp(), migratedFromLegacy: true,
      lastTransferTxId: 'new-transfer-tx_out', lastTransferReqId: 'new-transfer',
    });
    batch.set(doc(db, `families/${familyId}/wallets/recipient-new`), {
      balance: 100, createdAt: serverTimestamp(), migratedFromLegacy: true,
      lastTransferTxId: 'new-transfer-tx_in', lastTransferReqId: 'new-transfer',
    });
    batch.set(doc(db, `families/${familyId}/wallet_transactions/new-transfer-tx_out`), {
      type: 'transfer_out', childId: 'sender-new', counterpartyChildId: 'recipient-new', amountPence: -100,
      transferRequestId: 'new-transfer', approvalTxId: 'new-transfer-tx', createdAt: serverTimestamp(), parentRef: parentId, note: '',
    });
    batch.set(doc(db, `families/${familyId}/wallet_transactions/new-transfer-tx_in`), {
      type: 'transfer_in', childId: 'recipient-new', counterpartyChildId: 'sender-new', amountPence: 100,
      transferRequestId: 'new-transfer', approvalTxId: 'new-transfer-tx', createdAt: serverTimestamp(), parentRef: parentId, note: '',
    });
    batch.update(doc(db, `families/${familyId}/transfer_requests/new-transfer`), {
      status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: parentId, reviewedByName: 'Kemal', approvalTxId: 'new-transfer-tx',
    });
    await assertSucceeds(batch.commit());
  });

  it('atomically redeems the stored reward cost and makes terminal history immutable', async () => {
    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      await setDoc(doc(context.firestore(), `families/${familyId}/rewards/reward-1`), { title: 'Movie', cost: 25 });
    });
    const db = testEnv.authenticatedContext(childId).firestore();
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', childId), { rewardPoints: 75, lastRedemptionId: 'redemption-1' });
    batch.set(doc(db, `families/${familyId}/redemptions/redemption-1`), {
      rewardId: 'reward-1', userId: childId, costPaid: 25, redeemedAt: serverTimestamp(), createdAt: serverTimestamp(), status: 'completed',
      familyId, sourceId: 'redemption-1', actorId: childId,
      effectSnapshot: { schemaVersion: 1, entityType: 'reward_redemption', familyId, actorId: childId, childId, rewardId: 'reward-1', pointsDelta: -25, xpAdjustment: 0 },
    });
    await assertSucceeds(batch.commit());
    await assertFails(updateDoc(doc(db, `families/${familyId}/redemptions/redemption-1`), { status: 'changed' }));
  });

  it('owner can reject a pending task completion', async () => {
    const db = testEnv.authenticatedContext('owner123').firestore();
    await assertSucceeds(setDoc(doc(db, `families/${familyId}/task_completions`, 'comp1'), {
      taskId: 'task1', assigneeId: childId, status: 'rejected', parentComment: 'Retry',
      rejectedAt: serverTimestamp(), reviewedAt: serverTimestamp(), reviewedBy: 'owner123', reviewedByName: 'Owner',
    }));
  });

  it('child, wrong-family reviewer, forged reviewer and extra fields are denied', async () => {
    const childDb = testEnv.authenticatedContext(childId).firestore();
    await assertFails(setDoc(doc(childDb, `families/${familyId}/task_completions`, 'comp1'), {
      taskId: 'task1', assigneeId: childId, status: 'rejected', parentComment: 'forged', rejectedAt: serverTimestamp(),
      reviewedAt: serverTimestamp(), reviewedBy: childId, reviewedByName: 'Child',
    }));

    const otherDb = testEnv.authenticatedContext('otherParent').firestore();
    await assertFails(setDoc(doc(otherDb, `families/${familyId}/money_requests`, 'money1'), {
      requesterId: siblingId, requestedFromId: childId, amountPence: 100, status: 'rejected',
      reviewedAt: serverTimestamp(), reviewedBy: 'otherParent', reviewedByName: 'Other',
    }));

    const parentDb = testEnv.authenticatedContext(parentId).firestore();
    await assertFails(setDoc(doc(parentDb, `families/${familyId}/petbox_requests`, 'pet1'), {
      childId, fundId: 'fund1', amountPence: 100, status: 'rejected', reviewedAt: serverTimestamp(),
      reviewedBy: childId,
    }));
    await assertFails(setDoc(doc(parentDb, `families/${familyId}/petbox_requests`, 'pet1'), {
      childId, fundId: 'fund1', amountPence: 100, status: 'rejected', reviewedAt: serverTimestamp(),
      reviewedBy: parentId, unexpected: true,
    }));
  });

  it('owner atomically approves a join request with profile, wallet and feed', async () => {
    const db = testEnv.authenticatedContext('owner123').firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', 'joiner1'), {
      uid: 'joiner1', joinRequestId: 'joiner1', familyId, role: 'child', displayName: 'New Child', avatarUrl: 'avatar',
      rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0, lastActiveDate: serverTimestamp(),
    }, { merge: true });
    batch.set(doc(db, `families/${familyId}/wallets`, 'joiner1'), {
      balance: 0, createdAt: serverTimestamp(), migratedFromLegacy: true,
    });
    batch.update(doc(db, `families/${familyId}/join_requests`, 'joiner1'), {
      status: 'approved', assignedRole: 'child', reviewedBy: 'owner123', reviewedByName: 'Owner', reviewedAt: serverTimestamp(),
    });
    batch.set(doc(db, `families/${familyId}/feed`, 'join_joiner1'), {
      actorId: 'owner123', type: 'custom', text: 'New Child has joined the family as a child!', timestamp: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });

  it('1. approveTaskCompletion', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    const batch = writeBatch(db);

    // Client writes only status fields; awardedPoints and effectSnapshot are server-only
    batch.update(doc(db, `families/${familyId}/task_completions`, 'comp1'), {
      status: 'approved',
      parentComment: null,
      approvedAt: serverTimestamp(),
      reviewedBy: parentId,
      reviewedByName: 'Kemal',
      reviewedAt: serverTimestamp()
    });

    // XP/rewards handled by gamification processor (server-side)
    // Client no longer writes lastTaskCompletionId - server handles it
    batch.set(doc(db, `families/${familyId}/feed`, 'task_approval_comp1'), {
      actorId: parentId,
      actorName: 'Kemal',
      type: 'custom',
      text: 'Task approved: Clean Room (+50 pts)',
      timestamp: serverTimestamp()
    });

    await assertSucceeds(batch.commit());
  });

  it('2. rejectTaskCompletion', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    const batch = writeBatch(db);

    batch.update(doc(db, `families/${familyId}/task_completions`, 'comp1'), {
      status: 'rejected',
      parentComment: 'Not clean enough',
      rejectedAt: serverTimestamp(),
      reviewedBy: parentId,
      reviewedByName: 'Kemal',
      reviewedAt: serverTimestamp()
    });

    batch.set(doc(db, `families/${familyId}/feed`, 'feed_reject_task'), {
      actorId: parentId,
      actorName: 'Kemal',
      type: 'custom',
      text: 'Task rejected: Clean Room - "Not clean enough"',
      timestamp: serverTimestamp()
    });

    await assertSucceeds(batch.commit());
  });

  it('3. approveTransferRequest', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    const batch = writeBatch(db);
    const approvalTxId = 'tx_app_trans';

    batch.update(doc(db, `families/${familyId}/wallets`, childId), {
      balance: 400,
      lastTransferTxId: approvalTxId + '_out', lastTransferReqId: 'trans1'
    });

    batch.update(doc(db, `families/${familyId}/wallets`, siblingId), {
      balance: 200,
      lastTransferTxId: approvalTxId + '_in', lastTransferReqId: 'trans1'
    });

    batch.set(doc(db, `families/${familyId}/wallet_transactions`, approvalTxId + '_out'), {
      type: 'transfer_out',
      childId: childId,
      counterpartyChildId: siblingId,
      amountPence: -100,
      transferRequestId: 'trans1',
      approvalTxId: approvalTxId,
      createdAt: serverTimestamp(),
      parentRef: parentId,
      note: ''
    });

    batch.set(doc(db, `families/${familyId}/wallet_transactions`, approvalTxId + '_in'), {
      type: 'transfer_in',
      childId: siblingId,
      counterpartyChildId: childId,
      amountPence: 100,
      transferRequestId: 'trans1',
      approvalTxId: approvalTxId,
      createdAt: serverTimestamp(),
      parentRef: parentId,
      note: ''
    });

    batch.update(doc(db, `families/${familyId}/transfer_requests`, 'trans1'), {
      status: 'approved',
      reviewedAt: serverTimestamp(),
      reviewedBy: parentId,
      reviewedByName: 'Kemal',
      approvalTxId: approvalTxId
    });


    await assertSucceeds(batch.commit());
  });

  it('4. rejectTransferRequest', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    const batch = writeBatch(db);

    batch.update(doc(db, `families/${familyId}/transfer_requests`, 'trans1'), {
      status: 'rejected',
      reviewedAt: serverTimestamp(),
      reviewedBy: parentId,
      reviewedByName: 'Kemal',
      rejectionReason: 'Not allowed'
    });

    batch.set(doc(db, `families/${familyId}/feed`, 'feed_rej_trans'), {
      actorId: parentId,
      actorName: 'Kemal',
      type: 'custom',
      text: 'Transfer request was rejected.',
      visibleTo: [childId, siblingId],
      timestamp: serverTimestamp()
    });

    await assertSucceeds(batch.commit());
  });

  it('5. approveMoneyRequest', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    const batch = writeBatch(db);
    const approvalTxId = 'tx_app_money';

    batch.update(doc(db, `families/${familyId}/wallets`, childId), {
      balance: 400,
      lastTransferTxId: approvalTxId + '_out', lastTransferReqId: 'money1'
    });

    batch.update(doc(db, `families/${familyId}/wallets`, siblingId), {
      balance: 200,
      lastTransferTxId: approvalTxId + '_in', lastTransferReqId: 'money1'
    });

    batch.set(doc(db, `families/${familyId}/wallet_transactions`, approvalTxId + '_out'), {
      type: 'transfer_out',
      childId: childId,
      counterpartyChildId: siblingId,
      amountPence: -100,
      moneyRequestId: 'money1',
      approvalTxId: approvalTxId,
      createdAt: serverTimestamp(),
      timestamp: serverTimestamp(),
      parentRef: parentId,
      note: ''
    });

    batch.set(doc(db, `families/${familyId}/wallet_transactions`, approvalTxId + '_in'), {
      type: 'transfer_in',
      childId: siblingId,
      counterpartyChildId: childId,
      amountPence: 100,
      moneyRequestId: 'money1',
      approvalTxId: approvalTxId,
      createdAt: serverTimestamp(),
      timestamp: serverTimestamp(),
      parentRef: parentId,
      note: ''
    });

    batch.update(doc(db, `families/${familyId}/money_requests`, 'money1'), {
      status: 'approved',
      reviewedAt: serverTimestamp(),
      reviewedBy: parentId,
      reviewedByName: 'Kemal',
      paymentTransferId: approvalTxId
    });

    batch.set(doc(db, `families/${familyId}/feed`, 'feed_app_money'), {
      actorId: parentId,
      actorName: 'Kemal',
      type: 'custom',
      text: 'Money request approved.',
      visibleTo: [childId, siblingId],
      timestamp: serverTimestamp()
    });

    await assertSucceeds(batch.commit());
  });

  it('6. rejectMoneyRequest', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    const batch = writeBatch(db);

    batch.update(doc(db, `families/${familyId}/money_requests`, 'money1'), {
      status: 'rejected',
      reviewedAt: serverTimestamp(),
      reviewedBy: parentId,
      reviewedByName: 'Kemal',
      rejectionReason: 'Not allowed'
    });

    batch.set(doc(db, `families/${familyId}/feed`, 'feed_rej_money'), {
      actorId: parentId,
      actorName: 'Kemal',
      type: 'custom',
      text: 'Money request rejected.',
      visibleTo: [childId, siblingId],
      timestamp: serverTimestamp()
    });

    await assertSucceeds(batch.commit());
  });

  it('6b. owner can reject a pending_acceptance money request (regression for production bug)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      await setDoc(doc(context.firestore(), `families/${familyId}/money_requests`, 'money_pending_acceptance'), {
        requesterId: siblingId,
        requestedFromId: childId,
        amountPence: 100,
        status: 'pending_acceptance'
      });
    });

    const db = testEnv.authenticatedContext('owner123').firestore();
    const batch = writeBatch(db);

    batch.update(doc(db, `families/${familyId}/money_requests`, 'money_pending_acceptance'), {
      status: 'rejected',
      reviewedAt: serverTimestamp(),
      reviewedBy: 'owner123',
      reviewedByName: 'Owner',
      rejectionReason: 'Not allowed'
    });

    batch.set(doc(db, `families/${familyId}/feed`, 'feed_rej_money_pa'), {
      actorId: 'owner123',
      actorName: 'Owner',
      type: 'custom',
      text: 'Money request rejected.',
      visibleTo: [childId, siblingId],
      timestamp: serverTimestamp()
    });

    await assertSucceeds(batch.commit());
  });

  it('6c. child cannot reject their own pending_acceptance money request', async () => {
    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      await setDoc(doc(context.firestore(), `families/${familyId}/money_requests`, 'money_child_reject'), {
        requesterId: siblingId,
        requestedFromId: childId,
        amountPence: 100,
        status: 'pending_acceptance'
      });
    });

    const db = testEnv.authenticatedContext(siblingId).firestore();
    await assertFails(updateDoc(doc(db, `families/${familyId}/money_requests`, 'money_child_reject'), {
      status: 'rejected',
      reviewedAt: serverTimestamp(),
      reviewedBy: siblingId,
      reviewedByName: 'Muhammed Osman',
      rejectionReason: 'Not allowed'
    }));
  });

  it('6d. unrelated-family parent cannot reject a pending_acceptance money request', async () => {
    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      await setDoc(doc(context.firestore(), `families/${familyId}/money_requests`, 'money_other_family'), {
        requesterId: siblingId,
        requestedFromId: childId,
        amountPence: 100,
        status: 'pending_acceptance'
      });
    });

    const db = testEnv.authenticatedContext('otherParent').firestore();
    await assertFails(updateDoc(doc(db, `families/${familyId}/money_requests`, 'money_other_family'), {
      status: 'rejected',
      reviewedAt: serverTimestamp(),
      reviewedBy: 'otherParent',
      reviewedByName: 'Other',
      rejectionReason: 'Not allowed'
    }));
  });

  it('6e. approved money request cannot be rejected', async () => {
    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      await setDoc(doc(context.firestore(), `families/${familyId}/money_requests`, 'money_approved'), {
        requesterId: siblingId,
        requestedFromId: childId,
        amountPence: 100,
        status: 'approved',
        paymentTransferId: 'pay1'
      });
    });

    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertFails(updateDoc(doc(db, `families/${familyId}/money_requests`, 'money_approved'), {
      status: 'rejected',
      reviewedAt: serverTimestamp(),
      reviewedBy: parentId,
      reviewedByName: 'Kemal',
      rejectionReason: 'Not allowed'
    }));
  });

  it('6f. already-rejected money request cannot be rejected again', async () => {
    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      await setDoc(doc(context.firestore(), `families/${familyId}/money_requests`, 'money_rejected'), {
        requesterId: siblingId,
        requestedFromId: childId,
        amountPence: 100,
        status: 'rejected',
        reviewedAt: serverTimestamp(),
        reviewedBy: parentId,
        reviewedByName: 'Kemal',
        rejectionReason: 'Not allowed'
      });
    });

    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertFails(updateDoc(doc(db, `families/${familyId}/money_requests`, 'money_rejected'), {
      status: 'rejected',
      reviewedAt: serverTimestamp(),
      reviewedBy: parentId,
      reviewedByName: 'Kemal',
      rejectionReason: 'Still not allowed'
    }));
  });

  it('6g. oversized rejection comment is denied', async () => {
    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      await setDoc(doc(context.firestore(), `families/${familyId}/money_requests`, 'money_oversize'), {
        requesterId: siblingId,
        requestedFromId: childId,
        amountPence: 100,
        status: 'pending_acceptance'
      });
    });

    const db = testEnv.authenticatedContext(parentId).firestore();
    const oversize = 'x'.repeat(2001);
    await assertFails(updateDoc(doc(db, `families/${familyId}/money_requests`, 'money_oversize'), {
      status: 'rejected',
      reviewedAt: serverTimestamp(),
      reviewedBy: parentId,
      reviewedByName: 'Kemal',
      rejectionReason: oversize
    }));
  });

  it('7. approvePetBoxDonation', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    const batch = writeBatch(db);
    const txOutId = 'tx_petbox_app';
    const txFundId = 'tx_fund_app';

    batch.update(doc(db, `families/${familyId}/wallets`, childId), {
      balance: 400,
      lastTransferTxId: txOutId,
      lastTransferReqId: 'pet1'
    });

    batch.update(doc(db, `families/${familyId}/funds`, 'fund1'), {
      balance: 1100,
      lastFundTxId: txFundId
    });

    batch.set(doc(db, `families/${familyId}/fund_transactions`, txFundId), {
      fundId: 'fund1',
      type: "contribution",
      amount: 100,
      fromUserId: childId,
      sourceId: 'pet1',
      createdAt: serverTimestamp()
    });

    batch.set(doc(db, `families/${familyId}/wallet_transactions`, txOutId), {
      type: 'petbox_donation',
      childId: childId,
      amountPence: -100,
      amount: -100,
      note: `Donated to Cat Shelter`,
      sourceId: 'pet1',
      familyId,
      actorId: parentId,
      status: 'completed',
      effectSnapshot: { schemaVersion: 1, entityType: 'petbox_donation', familyId, actorId: parentId, childId, fundId: 'fund1', sourceRequestId: 'pet1', fundDeltaPence: 100, walletDeltaPence: -100, pointsDelta: 0, xpAdjustment: 0 },
      createdAt: serverTimestamp(),
      timestamp: serverTimestamp()
    });

    batch.update(doc(db, `families/${familyId}/petbox_requests`, 'pet1'), {
      status: 'approved',
      reviewedAt: serverTimestamp(),
      reviewedBy: parentId,
      approvalTxId: txOutId,
      fundTransactionId: txFundId
    });

    batch.set(doc(db, `families/${familyId}/feed`, 'feed_app_petbox'), {
      actorId: parentId,
      actorName: 'Kemal',
      type: 'custom',
      text: 'Pet Box donation approved.',
      visibleTo: [childId, parentId],
      timestamp: serverTimestamp()
    });

    await assertSucceeds(batch.commit());
  });

  it('8. rejectPetBoxDonation', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    const batch = writeBatch(db);

    batch.update(doc(db, `families/${familyId}/petbox_requests`, 'pet1'), {
      status: 'rejected',
      reviewedAt: serverTimestamp(),
      reviewedBy: parentId,
      rejectionReason: 'Not allowed'
    });

    batch.set(doc(db, `families/${familyId}/feed`, 'feed_rej_petbox'), {
      actorId: parentId,
      actorName: 'Kemal',
      type: 'custom',
      text: 'Pet Box donation rejected.',
      visibleTo: [childId, parentId],
      timestamp: serverTimestamp()
    });

    await assertSucceeds(batch.commit());
  });

});
