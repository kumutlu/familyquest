import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
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
      childId: childId,
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

  it('owner can reject a pending task completion', async () => {
    const db = testEnv.authenticatedContext('owner123').firestore();
    await assertSucceeds(setDoc(doc(db, `families/${familyId}/task_completions`, 'comp1'), {
      taskId: 'task1', childId, status: 'rejected', parentComment: 'Retry',
      rejectedAt: serverTimestamp(), reviewedAt: serverTimestamp(), reviewedBy: 'owner123', reviewedByName: 'Owner',
    }));
  });

  it('child, wrong-family reviewer, forged reviewer and extra fields are denied', async () => {
    const childDb = testEnv.authenticatedContext(childId).firestore();
    await assertFails(setDoc(doc(childDb, `families/${familyId}/task_completions`, 'comp1'), {
      taskId: 'task1', childId, status: 'rejected', parentComment: 'forged', rejectedAt: serverTimestamp(),
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
      uid: 'joiner1', familyId, role: 'child', displayName: 'New Child', avatarUrl: 'avatar',
      rewardPoints: 0, lifetimeXP: 0, currentStreak: 0, longestStreak: 0, lastActiveDate: serverTimestamp(),
    }, { merge: true });
    batch.set(doc(db, `families/${familyId}/wallets`, 'joiner1'), {
      balance: 0, createdAt: serverTimestamp(), migratedFromLegacy: true,
    });
    batch.update(doc(db, `families/${familyId}/join_requests`, 'joiner1'), {
      status: 'approved', assignedRole: 'child', reviewedBy: 'owner123', reviewedByName: 'Owner', reviewedAt: serverTimestamp(),
    });
    batch.set(doc(db, `families/${familyId}/feed`, 'join-feed'), {
      actorId: 'owner123', type: 'custom', text: 'New Child has joined the family as a child!', timestamp: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });

  it('1. approveTaskCompletion', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    const batch = writeBatch(db);

    batch.update(doc(db, `families/${familyId}/task_completions`, 'comp1'), {
      status: 'approved',
      parentComment: null,
      approvedAt: serverTimestamp(),
      awardedPoints: 50,
      reviewedBy: parentId,
      reviewedByName: 'Kemal',
      reviewedAt: serverTimestamp()
    });

    batch.update(doc(db, 'users', childId), {
      rewardPoints: 150,
      lifetimeXP: 150
    });

    batch.set(doc(db, `families/${familyId}/feed`, 'feed_approve_task'), {
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
      reviewedByName: 'Kemal'
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
      reviewedByName: 'Kemal'
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

  it('7. approvePetBoxDonation', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    const batch = writeBatch(db);
    const txOutId = 'tx_petbox_app';
    const txFundId = 'tx_fund_app';

    batch.update(doc(db, `families/${familyId}/wallets`, childId), {
      balance: 400,
      lastTransferTxId: txOutId
    });

    batch.update(doc(db, 'users', childId), {
      lastFundTxId: txFundId
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
      createdAt: serverTimestamp()
    });

    batch.set(doc(db, `families/${familyId}/wallet_transactions`, txOutId), {
      type: 'petbox_donation',
      childId: childId,
      amountPence: -100,
      amount: -100,
      note: `Donated to Cat Shelter`,
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
      reviewedBy: parentId
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
