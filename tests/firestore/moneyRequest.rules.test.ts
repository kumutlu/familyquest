import { initializeTestEnvironment, assertFails, assertSucceeds, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';

/**
 * Money Request canonical authorization contract tests.
 *
 * These encode the single contract from src/lib/moneyRequestContracts.ts:
 *  - child -> parent  : status 'pending' (parent approves directly)
 *  - child -> child   : status 'pending_acceptance' (requested sibling Accepts -> 'pending', or Declines -> 'rejected')
 *  - parent may APPROVE only a 'pending' request (approving 'pending_acceptance' is denied)
 *  - parent may REJECT 'pending' or 'pending_acceptance'
 *  - the requested-from person may Accept 'pending_acceptance' -> 'pending'
 *  - identity fields (familyId, requesterId, requestedFromId, amountPence) are immutable
 *  - approve moves the exact amount atomically; reject moves no money
 */
let testEnv: RulesTestEnvironment;
const familyId = 'fam-mr';
const parentId = 'parent-mr';
const ownerId = 'owner-mr';
const childRequester = 'child-req';
const childRequested = 'child-reqd';
const otherParent = 'other-parent';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-money-request-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    // Rules only grant access to an existing, active family document.
    await setDoc(doc(db, 'families', familyId), { name: 'Family', currencyCode: 'GBP' });
    await setDoc(doc(db, 'users', parentId), { familyId, role: 'parent', displayName: 'Parent' });
    await setDoc(doc(db, 'users', ownerId), { familyId, role: 'owner', displayName: 'Owner' });
    await setDoc(doc(db, 'users', childRequester), { familyId, role: 'child', displayName: 'Requester' });
    await setDoc(doc(db, 'users', childRequested), { familyId, role: 'child', displayName: 'Requested' });
    await setDoc(doc(db, 'users', otherParent), { familyId: 'other-fam', role: 'parent', displayName: 'Other' });
    await setDoc(doc(db, `families/${familyId}/wallets`, childRequester), { balance: 0, createdAt: serverTimestamp(), migratedFromLegacy: true });
    await setDoc(doc(db, `families/${familyId}/wallets`, childRequested), { balance: 1000, createdAt: serverTimestamp(), migratedFromLegacy: true });
  });
});

function seedMoneyRequest(id: string, status: string, requestedFromId: string) {
  return testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(ctx.firestore().doc(`families/${familyId}/money_requests/${id}`), {
      familyId, requesterId: childRequester, requesterName: 'Requester',
      requestedFromId, requestedFromName: 'Requested', amountPence: 556,
      message: 'hi', status, createdAt: serverTimestamp(),
    });
  });
}

describe('Money Request authorization contract', () => {
  it('authorized parent can approve a pending request (child->parent)', async () => {
    await seedMoneyRequest('mr1', 'pending', parentId);
    const db = testEnv.authenticatedContext(parentId).firestore();
    const txId = 'app1';
    const batch = writeBatch(db);
    batch.set(doc(db, `families/${familyId}/wallets`, childRequester), {
      balance: 556, lastTransferTxId: `${txId}_in`, lastTransferReqId: 'mr1',
    }, { merge: true });
    batch.set(doc(db, `families/${familyId}/wallet_transactions/${txId}_in`), {
      type: 'request_payment', childId: childRequester, amount: 556, amountPence: 556,
      moneyRequestId: 'mr1', approvalTxId: txId, note: '', parentRef: parentId, familyId,
      sourceId: 'mr1', actorId: parentId, status: 'completed',
      createdAt: serverTimestamp(), timestamp: serverTimestamp(),
    });
    batch.update(doc(db, `families/${familyId}/money_requests/mr1`), {
      status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: parentId, reviewedByName: 'Parent',
      paymentTransferId: txId,
    });
    await assertSucceeds(batch.commit());
  });

  it('owner can approve a pending request', async () => {
    await seedMoneyRequest('mr-owner', 'pending', ownerId);
    const db = testEnv.authenticatedContext(ownerId).firestore();
    const txId = 'app-owner';
    const batch = writeBatch(db);
    batch.set(doc(db, `families/${familyId}/wallets`, childRequester), {
      balance: 556, lastTransferTxId: `${txId}_in`, lastTransferReqId: 'mr-owner',
    }, { merge: true });
    batch.set(doc(db, `families/${familyId}/wallet_transactions/${txId}_in`), {
      type: 'request_payment', childId: childRequester, amount: 556, amountPence: 556,
      moneyRequestId: 'mr-owner', approvalTxId: txId, note: '', parentRef: ownerId, familyId,
      sourceId: 'mr-owner', actorId: ownerId, status: 'completed',
      createdAt: serverTimestamp(), timestamp: serverTimestamp(),
    });
    batch.update(doc(db, `families/${familyId}/money_requests/mr-owner`), {
      status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: ownerId, reviewedByName: 'Owner',
      paymentTransferId: txId,
    });
    await assertSucceeds(batch.commit());
  });

  it('authorized parent can reject a pending request', async () => {
    await seedMoneyRequest('mr-rej', 'pending', parentId);
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertSucceeds(updateDoc(doc(db, `families/${familyId}/money_requests/mr-rej`), {
      status: 'rejected', reviewedAt: serverTimestamp(), reviewedBy: parentId, reviewedByName: 'Parent',
      rejectionReason: 'Not now',
    }));
  });

  it('parent can reject a pending_acceptance request', async () => {
    await seedMoneyRequest('mr-rej-acc', 'pending_acceptance', childRequested);
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertSucceeds(updateDoc(doc(db, `families/${familyId}/money_requests/mr-rej-acc`), {
      status: 'rejected', reviewedAt: serverTimestamp(), reviewedBy: parentId, reviewedByName: 'Parent',
      rejectionReason: 'Not now',
    }));
  });

  it('parent CANNOT approve a pending_acceptance request (denied by isValidMoneyRequestApproval)', async () => {
    await seedMoneyRequest('mr-acc', 'pending_acceptance', childRequested);
    const db = testEnv.authenticatedContext(parentId).firestore();
    const txId = 'app-acc';
    const batch = writeBatch(db);
    batch.set(doc(db, `families/${familyId}/wallets`, childRequester), {
      balance: 556, lastTransferTxId: `${txId}_in`, lastTransferReqId: 'mr-acc',
    }, { merge: true });
    batch.set(doc(db, `families/${familyId}/wallets`, childRequested), {
      balance: 444, lastTransferTxId: `${txId}_out`, lastTransferReqId: 'mr-acc',
    }, { merge: true });
    batch.set(doc(db, `families/${familyId}/wallet_transactions/${txId}_out`), {
      type: 'transfer_out', childId: childRequested, counterpartyChildId: childRequester, amountPence: -556,
      moneyRequestId: 'mr-acc', approvalTxId: txId, note: '', parentRef: parentId, familyId,
      sourceId: 'mr-acc', actorId: parentId, status: 'completed',
      createdAt: serverTimestamp(), timestamp: serverTimestamp(),
    });
    batch.set(doc(db, `families/${familyId}/wallet_transactions/${txId}_in`), {
      type: 'transfer_in', childId: childRequester, counterpartyChildId: childRequested, amountPence: 556,
      moneyRequestId: 'mr-acc', approvalTxId: txId, note: '', parentRef: parentId, familyId,
      sourceId: 'mr-acc', actorId: parentId, status: 'completed',
      createdAt: serverTimestamp(), timestamp: serverTimestamp(),
    });
    batch.update(doc(db, `families/${familyId}/money_requests/mr-acc`), {
      status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: parentId, reviewedByName: 'Parent',
      paymentTransferId: txId,
    });
    await assertFails(batch.commit());
  });

  it('requested-from child can Accept pending_acceptance -> pending', async () => {
    await seedMoneyRequest('mr-accept', 'pending_acceptance', childRequested);
    const db = testEnv.authenticatedContext(childRequested).firestore();
    await assertSucceeds(updateDoc(doc(db, `families/${familyId}/money_requests/mr-accept`), {
      status: 'pending',
    }));
  });

  it('unrelated parent cannot accept a pending_acceptance request not addressed to them', async () => {
    await seedMoneyRequest('mr-accept2', 'pending_acceptance', childRequested);
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertFails(updateDoc(doc(db, `families/${familyId}/money_requests/mr-accept2`), {
      status: 'pending',
    }));
  });

  it('child cannot approve or reject', async () => {
    await seedMoneyRequest('mr-child', 'pending', parentId);
    const db = testEnv.authenticatedContext(childRequester).firestore();
    await assertFails(updateDoc(doc(db, `families/${familyId}/money_requests/mr-child`), {
      status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: childRequester, reviewedByName: 'Requester',
      paymentTransferId: 'x',
    }));
    await assertFails(updateDoc(doc(db, `families/${familyId}/money_requests/mr-child`), {
      status: 'rejected', reviewedAt: serverTimestamp(), reviewedBy: childRequester, reviewedByName: 'Requester',
      rejectionReason: 'no',
    }));
  });

  it('wrong-family parent is denied', async () => {
    await seedMoneyRequest('mr-wf', 'pending', parentId);
    const db = testEnv.authenticatedContext(otherParent).firestore();
    await assertFails(updateDoc(doc(db, `families/${familyId}/money_requests/mr-wf`), {
      status: 'rejected', reviewedAt: serverTimestamp(), reviewedBy: otherParent, reviewedByName: 'Other',
      rejectionReason: 'no',
    }));
  });

  it('non-pending request cannot be approved', async () => {
    await seedMoneyRequest('mr-done', 'approved', parentId);
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertFails(updateDoc(doc(db, `families/${familyId}/money_requests/mr-done`), {
      status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: parentId, reviewedByName: 'Parent',
      paymentTransferId: 'x',
    }));
  });

  it('modified amount is denied on approve', async () => {
    await seedMoneyRequest('mr-amt', 'pending', parentId);
    const db = testEnv.authenticatedContext(parentId).firestore();
    const txId = 'app-amt';
    const batch = writeBatch(db);
    batch.set(doc(db, `families/${familyId}/wallets`, childRequester), {
      balance: 999, lastTransferTxId: `${txId}_in`, lastTransferReqId: 'mr-amt',
    }, { merge: true });
    batch.set(doc(db, `families/${familyId}/wallet_transactions/${txId}_in`), {
      type: 'request_payment', childId: childRequester, amount: 999, amountPence: 999,
      moneyRequestId: 'mr-amt', approvalTxId: txId, note: '', parentRef: parentId, familyId,
      sourceId: 'mr-amt', actorId: parentId, status: 'completed',
      createdAt: serverTimestamp(), timestamp: serverTimestamp(),
    });
    batch.update(doc(db, `families/${familyId}/money_requests/mr-amt`), {
      status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: parentId, reviewedByName: 'Parent',
      paymentTransferId: txId,
    });
    await assertFails(batch.commit());
  });

  it('modified requester/requestedFrom is denied on accept', async () => {
    await seedMoneyRequest('mr-forge', 'pending_acceptance', childRequested);
    const db = testEnv.authenticatedContext(childRequested).firestore();
    await assertFails(updateDoc(doc(db, `families/${familyId}/money_requests/mr-forge`), {
      status: 'pending', requesterId: parentId,
    }));
  });

  it('legacy pending_acceptance child->parent request: the requestedFrom parent may Accept it to pending', async () => {
    // A parent who is the requestedFrom person is permitted to Accept their own
    // legacy pending_acceptance request (moving it to 'pending'), after which the
    // first test confirms they can Approve it. This is the safe, in-contract path
    // for legacy child->parent requests and does not weaken authorization.
    await seedMoneyRequest('mr-legacy', 'pending_acceptance', parentId);
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertSucceeds(updateDoc(doc(db, `families/${familyId}/money_requests/mr-legacy`), {
      status: 'pending',
    }));
  });
});
