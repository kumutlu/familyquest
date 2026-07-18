import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, runTransaction, collection, addDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-transfer-approval-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'families/family1'), { name: 'Family 1' });
    await setDoc(doc(db, 'users/owner1'), { familyId: 'family1', role: 'owner', displayName: 'Owner' });
    await setDoc(doc(db, 'users/parent1'), { familyId: 'family1', role: 'parent', displayName: 'Parent' });
    await setDoc(doc(db, 'users/child1'), { familyId: 'family1', role: 'child', displayName: 'C1' });
    await setDoc(doc(db, 'users/child2'), { familyId: 'family1', role: 'child', displayName: 'C2' });
    // Wallets exist (created via join/managed member flows)
    await setDoc(doc(db, 'families/family1/wallets/child1'), { balance: 500, createdAt: serverTimestamp(), migratedFromLegacy: true });
    await setDoc(doc(db, 'families/family1/wallets/child2'), { balance: 200, createdAt: serverTimestamp(), migratedFromLegacy: true });
    await setDoc(doc(db, 'families/family1/transfer_requests/req1'), {
      id: 'req1', familyId: 'family1', fromChildId: 'child1', fromChildName: 'C1',
      toChildId: 'child2', toChildName: 'C2', amountPence: 100, message: 'hi',
      status: 'pending', createdAt: serverTimestamp()
    });
  });
});

// Mirror of api.ts approveTransferRequest() writes exactly
async function runApprove(db: any, reviewerUid: string) {
  const familyId = 'family1';
  const requestId = 'req1';
  return runTransaction(db, async (transaction: any) => {
    const reqRef = doc(db, `families/${familyId}/transfer_requests`, requestId);
    const approvalTxId = doc(collection(db, `families/${familyId}/wallet_transactions`)).id;
    const txOutRef = doc(db, `families/${familyId}/wallet_transactions`, `${approvalTxId}_out`);
    const txInRef = doc(db, `families/${familyId}/wallet_transactions`, `${approvalTxId}_in`);
    const currentUserRef = doc(db, 'users', reviewerUid);

    const reqDoc = await transaction.get(reqRef);
    const requestData = reqDoc.data();
    const [userDoc, senderDoc, recipientDoc, fromWalletDoc, toWalletDoc] = await Promise.all([
      transaction.get(currentUserRef),
      transaction.get(doc(db, 'users', requestData.fromChildId)),
      transaction.get(doc(db, 'users', requestData.toChildId)),
      transaction.get(doc(db, `families/${familyId}/wallets`, requestData.fromChildId)),
      transaction.get(doc(db, `families/${familyId}/wallets`, requestData.toChildId)),
    ]);
    const userData = userDoc.data();
    const fromBalance = fromWalletDoc.exists() ? fromWalletDoc.data().balance : 0;
    const toBalance = toWalletDoc.exists() ? toWalletDoc.data().balance : 0;

    transaction.set(doc(db, `families/${familyId}/wallets`, requestData.fromChildId), {
      ...(!fromWalletDoc.exists() ? { createdAt: serverTimestamp(), migratedFromLegacy: true } : {}),
      balance: fromBalance - requestData.amountPence,
      lastTransferTxId: txOutRef.id,
      lastTransferReqId: requestId
    }, { merge: true });

    transaction.set(doc(db, `families/${familyId}/wallets`, requestData.toChildId), {
      ...(!toWalletDoc.exists() ? { createdAt: serverTimestamp(), migratedFromLegacy: true } : {}),
      balance: toBalance + requestData.amountPence,
      lastTransferTxId: txInRef.id,
      lastTransferReqId: requestId
    }, { merge: true });

    transaction.update(reqRef, {
      status: 'approved', approvalTxId, reviewedBy: reviewerUid, reviewedByName: userData.displayName || 'Parent', reviewedAt: serverTimestamp()
    });

    const commonTxData = {
      amountPence: requestData.amountPence,
      transferRequestId: requestId,
      approvalTxId,
      createdAt: serverTimestamp(),
      parentRef: reviewerUid,
      note: requestData.message || '',
      familyId,
      sourceId: requestId,
      status: 'completed',
      actorId: reviewerUid,
    };
    transaction.set(txOutRef, {
      ...commonTxData,
      type: 'transfer_out',
      childId: requestData.fromChildId,
      counterpartyChildId: requestData.toChildId,
      amountPence: -requestData.amountPence,
      description: `Sent to ${requestData.toChildName}`,
    });
    transaction.set(txInRef, {
      ...commonTxData,
      type: 'transfer_in',
      childId: requestData.toChildId,
      counterpartyChildId: requestData.fromChildId,
      amountPence: requestData.amountPence,
      description: `Received from ${requestData.fromChildName}`,
    });

    const feedSenderRef = doc(collection(db, `families/${familyId}/feed`));
    const feedRecipientRef = doc(collection(db, `families/${familyId}/feed`));
    transaction.set(feedSenderRef, {
      actorId: reviewerUid, type: 'custom',
      text: `Your transfer to ${requestData.toChildName} was approved.`,
      visibleTo: [requestData.fromChildId], timestamp: serverTimestamp()
    });
    transaction.set(feedRecipientRef, {
      actorId: reviewerUid, type: 'custom',
      text: `You received £${(requestData.amountPence / 100).toFixed(2)} from ${requestData.fromChildName}.`,
      visibleTo: [requestData.toChildId], timestamp: serverTimestamp()
    });
  });
}

// Mirror of api.ts rejectTransferRequest() writes exactly
async function runReject(db: any, reviewerUid: string) {
  const familyId = 'family1';
  const requestId = 'req1';
  return runTransaction(db, async (transaction: any) => {
    const reqRef = doc(db, `families/${familyId}/transfer_requests`, requestId);
    const feedRef = doc(collection(db, `families/${familyId}/feed`));
    const currentUserRef = doc(db, 'users', reviewerUid);
    const [reqDoc, userDoc] = await Promise.all([transaction.get(reqRef), transaction.get(currentUserRef)]);
    const userData = userDoc.data();
    transaction.update(reqRef, {
      status: 'rejected', reviewedAt: serverTimestamp(), reviewedBy: reviewerUid,
      reviewedByName: userData.displayName, rejectionReason: 'Rejected'
    });
    transaction.set(feedRef, {
      actorId: reviewerUid, actorName: userData.displayName, type: 'custom',
      text: `Your transfer to ${reqDoc.data().toChildName} was rejected.`,
      visibleTo: [reqDoc.data().fromChildId], timestamp: serverTimestamp()
    });
  });
}

describe('Transfer approval (runTransaction) - regression for feed visibleTo bug', () => {
  it('REJECT as parent: full production path now succeeds', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertSucceeds(runReject(db, 'parent1'));
  });

  it('REJECT as owner: full production path now succeeds', async () => {
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertSucceeds(runReject(db, 'owner1'));
  });

  it('APPROVE as parent: full production path now succeeds', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertSucceeds(runApprove(db, 'parent1'));
  });

  it('APPROVE as owner: full production path now succeeds', async () => {
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertSucceeds(runApprove(db, 'owner1'));
  });

  it('feed create with a SINGLE-element visibleTo succeeds (the exact denied write)', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertSucceeds(runTransaction(db, async (t: any) => {
      const feedRef = doc(collection(db, 'families/family1/feed'));
      t.set(feedRef, {
        actorId: 'parent1', actorName: 'Parent', type: 'custom',
        text: 'single recipient', visibleTo: ['child1'], timestamp: serverTimestamp()
      });
    }));
  });

  it('feed create with a TWO-element visibleTo still succeeds (money request style)', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertSucceeds(runTransaction(db, async (t: any) => {
      const feedRef = doc(collection(db, 'families/family1/feed'));
      t.set(feedRef, {
        actorId: 'parent1', actorName: 'Parent', type: 'custom',
        text: 'two recipients', visibleTo: ['child1', 'child2'], timestamp: serverTimestamp()
      });
    }));
  });

  it('feed create with EMPTY visibleTo still succeeds', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertSucceeds(runTransaction(db, async (t: any) => {
      const feedRef = doc(collection(db, 'families/family1/feed'));
      t.set(feedRef, {
        actorId: 'parent1', actorName: 'Parent', type: 'custom',
        text: 'no recipients', visibleTo: [], timestamp: serverTimestamp()
      });
    }));
  });
});
