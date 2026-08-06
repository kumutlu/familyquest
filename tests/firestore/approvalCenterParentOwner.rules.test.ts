/**
 * P0 — Approval Center: same-family parent/owner must be able to manage every
 * parent-managed request the UI shows them.
 *
 * These tests mirror the FULL production write set of src/lib/api.ts
 * (approveTransferRequest / rejectTransferRequest), including the fields that
 * the older tests/firestore/transferApproval.rules.test.ts omitted:
 *   - effectSnapshot on the request document and on both ledger legs
 *   - the two notification documents written by
 *     loadNotificationRecipientsInTransaction / applyNotificationWrites
 *
 * The omitted writes are exactly what makes the production commit larger than
 * the previously-tested commit, which is why production denies while the old
 * test passes.
 */
import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, serverTimestamp, runTransaction, collection } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, beforeAll, afterAll, beforeEach, it } from 'vitest';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-approval-center-parent-owner',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => { await testEnv.cleanup(); });

const FAMILY = 'family1';
const REQ = 'req1';

const snapshot = (over: Record<string, unknown>) => {
  const merged: Record<string, unknown> = {
    schemaVersion: 1,
    entityType: 'transfer_request',
    familyId: FAMILY,
    actorId: 'unset',
    childId: 'child1',
    counterpartyChildId: 'child2',
    sourceRequestId: REQ,
    walletDeltaPence: -100,
    counterpartyWalletDeltaPence: 100,
    xpAdjustment: 0,
    ...over,
  };
  // The client SDK rejects undefined field values, exactly like production.
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return merged;
};

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `families/${FAMILY}`), { name: 'Family 1' });
    await setDoc(doc(db, 'families/family2'), { name: 'Family 2' });
    await setDoc(doc(db, 'users/owner1'), { familyId: FAMILY, role: 'owner', displayName: 'Owner' });
    await setDoc(doc(db, 'users/parent1'), { familyId: FAMILY, role: 'parent', displayName: 'Parent' });
    await setDoc(doc(db, 'users/child1'), { familyId: FAMILY, role: 'child', displayName: 'C1' });
    await setDoc(doc(db, 'users/child2'), { familyId: FAMILY, role: 'child', displayName: 'C2' });
    await setDoc(doc(db, 'users/otherParent'), { familyId: 'family2', role: 'parent', displayName: 'OP' });
    await setDoc(doc(db, 'users/otherOwner'), { familyId: 'family2', role: 'owner', displayName: 'OO' });
    // Production wallets are NOT pristine: they carry the operation markers left
    // behind by earlier parent deposits / penalties / goal moves. Those markers
    // are re-sent by every merge:true wallet write, which changes which rule
    // branches are charged against the shared expression budget.
    await setDoc(doc(db, `families/${FAMILY}/wallets/child1`), {
      balance: 500, createdAt: serverTimestamp(), migratedFromLegacy: true,
      lastManualTxId: 'old-manual-1', lastPenaltyTxId: 'old-penalty-1',
      lastGoalTxId: 'old-goal-1', lastFundTxId: 'old-fund-1',
    });
    await setDoc(doc(db, `families/${FAMILY}/wallets/child2`), {
      balance: 200, createdAt: serverTimestamp(), migratedFromLegacy: true,
      lastManualTxId: 'old-manual-2', lastPenaltyTxId: 'old-penalty-2',
      lastGoalTxId: 'old-goal-2', lastFundTxId: 'old-fund-2',
    });
    await setDoc(doc(db, `families/${FAMILY}/transfer_requests/${REQ}`), {
      id: REQ, familyId: FAMILY, fromChildId: 'child1', fromChildName: 'C1',
      toChildId: 'child2', toChildName: 'C2', amountPence: 100, message: 'hi',
      status: 'pending', createdAt: serverTimestamp(),
    });
    // Sibling money request (child1 asks child2) — parent-managed after acceptance.
    await setDoc(doc(db, `families/${FAMILY}/money_requests/mreq-sibling`), {
      familyId: FAMILY, requesterId: 'child1', requestedFromId: 'child2',
      amountPence: 50, message: 'lunch', status: 'pending', createdAt: serverTimestamp(),
    });
    // Money request funded by the parent.
    await setDoc(doc(db, `families/${FAMILY}/money_requests/mreq-parent`), {
      familyId: FAMILY, requesterId: 'child1', requestedFromId: 'parent1',
      amountPence: 50, message: 'lunch', status: 'pending', createdAt: serverTimestamp(),
    });
  });
});

/** Mirror of api.ts approveMoneyRequest(), full write set. */
async function runApproveMoneyRequest(db: any, reviewerUid: string, requestId: string) {
  return runTransaction(db, async (transaction: any) => {
    const reqRef = doc(db, `families/${FAMILY}/money_requests`, requestId);
    const approvalTxId = doc(collection(db, `families/${FAMILY}/wallet_transactions`)).id;
    const txOutRef = doc(db, `families/${FAMILY}/wallet_transactions`, `${approvalTxId}_out`);
    const txInRef = doc(db, `families/${FAMILY}/wallet_transactions`, `${approvalTxId}_in`);

    const [reqDoc, userDoc] = await Promise.all([
      transaction.get(reqRef), transaction.get(doc(db, 'users', reviewerUid)),
    ]);
    const reqData: any = reqDoc.data();
    const userData: any = userDoc.data();
    const requesterWalletRef = doc(db, `families/${FAMILY}/wallets`, reqData.requesterId);
    const requestedFromWalletRef = doc(db, `families/${FAMILY}/wallets`, reqData.requestedFromId);
    const [requestedFromDoc, , requesterWalletDoc, requestedFromWalletDoc] = await Promise.all([
      transaction.get(doc(db, 'users', reqData.requestedFromId)),
      transaction.get(doc(db, 'users', reqData.requesterId)),
      transaction.get(requesterWalletRef),
      transaction.get(requestedFromWalletRef),
    ]);
    const isFromParent = ['parent', 'owner'].includes(requestedFromDoc.data()?.role);
    const effect = snapshot({
      entityType: 'money_request', actorId: reviewerUid,
      childId: isFromParent ? reqData.requesterId : reqData.requestedFromId,
      counterpartyChildId: isFromParent ? undefined : reqData.requesterId,
      sourceRequestId: requestId,
      walletDeltaPence: isFromParent ? reqData.amountPence : -reqData.amountPence,
      counterpartyWalletDeltaPence: isFromParent ? undefined : reqData.amountPence,
    });
    const reqBalance = requesterWalletDoc.data().balance;

    if (isFromParent) {
      transaction.set(requesterWalletRef, {
        balance: reqBalance + reqData.amountPence,
        lastTransferTxId: txInRef.id, lastTransferReqId: requestId,
      }, { merge: true });
      transaction.set(txInRef, {
        type: 'request_payment', childId: reqData.requesterId,
        amount: reqData.amountPence, amountPence: reqData.amountPence,
        moneyRequestId: requestId, approvalTxId, note: reqData.message,
        parentRef: reviewerUid, familyId: FAMILY, sourceId: requestId,
        actorId: reviewerUid, status: 'completed', effectSnapshot: effect,
        timestamp: serverTimestamp(), createdAt: serverTimestamp(),
      });
    } else {
      const fromBalance = requestedFromWalletDoc.data().balance;
      transaction.set(requestedFromWalletRef, {
        balance: fromBalance - reqData.amountPence,
        lastTransferTxId: txOutRef.id, lastTransferReqId: requestId,
      }, { merge: true });
      transaction.set(requesterWalletRef, {
        balance: reqBalance + reqData.amountPence,
        lastTransferTxId: txInRef.id, lastTransferReqId: requestId,
      }, { merge: true });
      const commonTxData = {
        amountPence: reqData.amountPence, moneyRequestId: requestId, approvalTxId,
        createdAt: serverTimestamp(), timestamp: serverTimestamp(), parentRef: reviewerUid,
        note: reqData.message || '', familyId: FAMILY, sourceId: requestId,
        actorId: reviewerUid, status: 'completed',
      };
      transaction.set(txOutRef, {
        ...commonTxData, type: 'transfer_out', childId: reqData.requestedFromId,
        counterpartyChildId: reqData.requesterId, amountPence: -reqData.amountPence,
        effectSnapshot: effect,
      });
      transaction.set(txInRef, {
        ...commonTxData, type: 'transfer_in', childId: reqData.requesterId,
        counterpartyChildId: reqData.requestedFromId, amountPence: reqData.amountPence,
        effectSnapshot: effect,
      });
    }

    transaction.update(reqRef, {
      status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: reviewerUid,
      reviewedByName: userData?.displayName || 'Parent', paymentTransferId: approvalTxId,
      effectSnapshot: effect,
    });
    transaction.set(doc(collection(db, `families/${FAMILY}/feed`)), {
      actorId: reviewerUid, type: 'custom', text: 'Money request approved.',
      entityType: 'money_request', entityId: requestId,
      visibleTo: [reqData.requesterId, reqData.requestedFromId], timestamp: serverTimestamp(),
    });
  });
}

/** Byte-for-byte mirror of api.ts approveTransferRequest(), full write set. */
async function runApprove(db: any, reviewerUid: string) {
  return runTransaction(db, async (transaction: any) => {
    const reqRef = doc(db, `families/${FAMILY}/transfer_requests`, REQ);
    const approvalTxId = doc(collection(db, `families/${FAMILY}/wallet_transactions`)).id;
    const txOutRef = doc(db, `families/${FAMILY}/wallet_transactions`, `${approvalTxId}_out`);
    const txInRef = doc(db, `families/${FAMILY}/wallet_transactions`, `${approvalTxId}_in`);

    const reqDoc = await transaction.get(reqRef);
    const requestData: any = reqDoc.data();
    const [userDoc, , , fromWalletDoc, toWalletDoc] = await Promise.all([
      transaction.get(doc(db, 'users', reviewerUid)),
      transaction.get(doc(db, 'users', requestData.fromChildId)),
      transaction.get(doc(db, 'users', requestData.toChildId)),
      transaction.get(doc(db, `families/${FAMILY}/wallets`, requestData.fromChildId)),
      transaction.get(doc(db, `families/${FAMILY}/wallets`, requestData.toChildId)),
    ]);
    const userData: any = userDoc.data();

    // Notification dedupe pre-reads (production behaviour).
    const senderNotifRef = doc(db, `families/${FAMILY}/notifications`, `transfer_approved_sender_${REQ}`);
    const recipientNotifRef = doc(db, `families/${FAMILY}/notifications`, `transfer_approved_recipient_${REQ}`);
    const senderNotifExisting = await transaction.get(senderNotifRef);
    const recipientNotifExisting = await transaction.get(recipientNotifRef);

    const fromBalance = fromWalletDoc.data().balance;
    const toBalance = toWalletDoc.data().balance;
    const effect = snapshot({ actorId: reviewerUid });

    transaction.set(doc(db, `families/${FAMILY}/wallets`, requestData.fromChildId), {
      balance: fromBalance - requestData.amountPence,
      lastTransferTxId: txOutRef.id,
      lastTransferReqId: REQ,
    }, { merge: true });
    transaction.set(doc(db, `families/${FAMILY}/wallets`, requestData.toChildId), {
      balance: toBalance + requestData.amountPence,
      lastTransferTxId: txInRef.id,
      lastTransferReqId: REQ,
    }, { merge: true });

    transaction.update(reqRef, {
      status: 'approved', approvalTxId, reviewedBy: reviewerUid,
      reviewedByName: userData.displayName || 'Parent', reviewedAt: serverTimestamp(),
      effectSnapshot: effect,
    });

    const commonTxData = {
      amountPence: requestData.amountPence,
      transferRequestId: REQ,
      approvalTxId,
      createdAt: serverTimestamp(),
      parentRef: reviewerUid,
      note: requestData.message || '',
      familyId: FAMILY,
      sourceId: REQ,
      status: 'completed',
      actorId: reviewerUid,
    };
    transaction.set(txOutRef, {
      ...commonTxData, type: 'transfer_out',
      childId: requestData.fromChildId, counterpartyChildId: requestData.toChildId,
      amountPence: -requestData.amountPence,
      description: `Sent to ${requestData.toChildName}`,
      effectSnapshot: effect,
    });
    transaction.set(txInRef, {
      ...commonTxData, type: 'transfer_in',
      childId: requestData.toChildId, counterpartyChildId: requestData.fromChildId,
      amountPence: requestData.amountPence,
      description: `Received from ${requestData.fromChildName}`,
      effectSnapshot: effect,
    });

    transaction.set(doc(collection(db, `families/${FAMILY}/feed`)), {
      actorId: reviewerUid, type: 'custom',
      text: `Your transfer to ${requestData.toChildName} was approved.`,
      visibleTo: [requestData.fromChildId], timestamp: serverTimestamp(),
    });
    transaction.set(doc(collection(db, `families/${FAMILY}/feed`)), {
      actorId: reviewerUid, type: 'custom',
      text: `You received money from ${requestData.fromChildName}.`,
      visibleTo: [requestData.toChildId], timestamp: serverTimestamp(),
    });

    if (!senderNotifExisting.exists()) {
      transaction.set(senderNotifRef, {
        familyId: FAMILY, type: 'transfer_approved', actorId: reviewerUid,
        recipientIds: [requestData.fromChildId], title: 'Transfer approved',
        body: `Your transfer to ${requestData.toChildName} was approved.`,
        metadata: {}, createdAt: serverTimestamp(),
        entityType: 'transfer_request', entityId: REQ, actionUrl: '/wallet',
        dedupeKey: `transfer_approved_sender_${REQ}`,
      });
    }
    if (!recipientNotifExisting.exists()) {
      transaction.set(recipientNotifRef, {
        familyId: FAMILY, type: 'transfer_approved', actorId: reviewerUid,
        recipientIds: [requestData.toChildId], title: 'Transfer received',
        body: `You received money from ${requestData.fromChildName}.`,
        metadata: {}, createdAt: serverTimestamp(),
        entityType: 'transfer_request', entityId: REQ, actionUrl: '/wallet',
        dedupeKey: `transfer_approved_recipient_${REQ}`,
      });
    }
  });
}

/** Byte-for-byte mirror of api.ts rejectTransferRequest(), full write set. */
async function runReject(db: any, reviewerUid: string) {
  return runTransaction(db, async (transaction: any) => {
    const reqRef = doc(db, `families/${FAMILY}/transfer_requests`, REQ);
    const notifRef = doc(db, `families/${FAMILY}/notifications`, `transfer_rejected_${REQ}`);
    const [reqDoc, userDoc] = await Promise.all([
      transaction.get(reqRef),
      transaction.get(doc(db, 'users', reviewerUid)),
    ]);
    const notifExisting = await transaction.get(notifRef);
    const userData: any = userDoc.data();
    const requestData: any = reqDoc.data();

    transaction.update(reqRef, {
      status: 'rejected', reviewedAt: serverTimestamp(), reviewedBy: reviewerUid,
      reviewedByName: userData.displayName, rejectionReason: 'Not allowed',
    });
    transaction.set(doc(collection(db, `families/${FAMILY}/feed`)), {
      actorId: reviewerUid, actorName: userData.displayName, type: 'custom',
      text: `Your transfer to ${requestData.toChildName} was rejected.`,
      visibleTo: [requestData.fromChildId], timestamp: serverTimestamp(),
    });
    if (!notifExisting.exists()) {
      transaction.set(notifRef, {
        familyId: FAMILY, type: 'transfer_rejected', actorId: reviewerUid,
        recipientIds: [requestData.fromChildId], title: 'Transfer rejected',
        body: 'Your transfer was rejected.', metadata: {}, createdAt: serverTimestamp(),
        entityType: 'transfer_request', entityId: REQ, actionUrl: '/wallet',
        dedupeKey: `transfer_rejected_${REQ}`,
      });
    }
  });
}

describe('Approval Center — parent/owner parity on the FULL production write set', () => {
  it('same-family PARENT approves a pending transfer request', async () => {
    await assertSucceeds(runApprove(testEnv.authenticatedContext('parent1').firestore(), 'parent1'));
  });

  it('same-family OWNER approves a pending transfer request', async () => {
    await assertSucceeds(runApprove(testEnv.authenticatedContext('owner1').firestore(), 'owner1'));
  });

  it('same-family PARENT rejects a pending transfer request', async () => {
    await assertSucceeds(runReject(testEnv.authenticatedContext('parent1').firestore(), 'parent1'));
  });

  it('same-family OWNER rejects a pending transfer request', async () => {
    await assertSucceeds(runReject(testEnv.authenticatedContext('owner1').firestore(), 'owner1'));
  });

  it('CHILD cannot approve', async () => {
    await assertFails(runApprove(testEnv.authenticatedContext('child1').firestore(), 'child1'));
  });

  it('CHILD cannot reject', async () => {
    await assertFails(runReject(testEnv.authenticatedContext('child1').firestore(), 'child1'));
  });

  it('parent from ANOTHER family cannot approve', async () => {
    await assertFails(runApprove(testEnv.authenticatedContext('otherParent').firestore(), 'otherParent'));
  });

  it('owner from ANOTHER family cannot approve', async () => {
    await assertFails(runApprove(testEnv.authenticatedContext('otherOwner').firestore(), 'otherOwner'));
  });

  it('an already-approved request cannot be approved again (no double spend)', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertSucceeds(runApprove(db, 'parent1'));
    await assertFails(runApprove(db, 'parent1'));
  });

  it('an already-rejected request cannot be rejected again', async () => {
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertSucceeds(runReject(db, 'owner1'));
    await assertFails(runReject(db, 'owner1'));
  });

  it('same-family PARENT approves a sibling money request', async () => {
    await assertSucceeds(runApproveMoneyRequest(testEnv.authenticatedContext('parent1').firestore(), 'parent1', 'mreq-sibling'));
  });

  it('same-family OWNER approves a sibling money request', async () => {
    await assertSucceeds(runApproveMoneyRequest(testEnv.authenticatedContext('owner1').firestore(), 'owner1', 'mreq-sibling'));
  });

  it('same-family PARENT approves a parent-funded money request', async () => {
    await assertSucceeds(runApproveMoneyRequest(testEnv.authenticatedContext('parent1').firestore(), 'parent1', 'mreq-parent'));
  });

  it('same-family OWNER approves a parent-funded money request', async () => {
    await assertSucceeds(runApproveMoneyRequest(testEnv.authenticatedContext('owner1').firestore(), 'owner1', 'mreq-parent'));
  });

  it('CHILD cannot approve a money request', async () => {
    await assertFails(runApproveMoneyRequest(testEnv.authenticatedContext('child1').firestore(), 'child1', 'mreq-sibling'));
  });

  it('parent from ANOTHER family cannot approve a money request', async () => {
    await assertFails(runApproveMoneyRequest(testEnv.authenticatedContext('otherParent').firestore(), 'otherParent', 'mreq-sibling'));
  });

  it('an already-approved money request cannot be approved again', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertSucceeds(runApproveMoneyRequest(db, 'parent1', 'mreq-sibling'));
    await assertFails(runApproveMoneyRequest(db, 'parent1', 'mreq-sibling'));
  });
});
