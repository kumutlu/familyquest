import { initializeTestEnvironment, assertFails, assertSucceeds, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';

let testEnv: RulesTestEnvironment;
const familyId = 'fam1';
const parentId = 'kemal';
const child1 = 'mnalium';   // requester
const child2 = 'sibling';   // requestedFrom (sibling)

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'repro-money-request',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', parentId), { familyId, role: 'owner', displayName: 'Kemal' });
    await setDoc(doc(db, 'users', child1), { familyId, role: 'child', displayName: 'Mnalium' });
    await setDoc(doc(db, 'users', child2), { familyId, role: 'child', displayName: 'Sibling' });
    await setDoc(doc(db, `families/${familyId}/wallets`, child1), { balance: 0, createdAt: serverTimestamp(), migratedFromLegacy: true });
    await setDoc(doc(db, `families/${familyId}/wallets`, child2), { balance: 1000, createdAt: serverTimestamp(), migratedFromLegacy: true });
    // SIBLING request in pending_acceptance (requestedFrom is a child who must accept)
    await setDoc(doc(db, `families/${familyId}/money_requests/sib`), {
      familyId, requesterId: child1, requesterName: 'Mnalium',
      requestedFromId: child2, requestedFromName: 'Sibling',
      amountPence: 556, message: 'hi', status: 'pending_acceptance', createdAt: serverTimestamp(),
    });
  });
});

describe('repro: parent approves sibling pending_acceptance (should FAIL)', () => {
  it('parent approve of pending_acceptance sibling request is denied', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    const approvalTxId = 'tx_app';
    const batch = writeBatch(db);
    batch.set(doc(db, `families/${familyId}/wallets`, child1), {
      balance: 556, lastTransferTxId: `${approvalTxId}_in`, lastTransferReqId: 'sib',
    }, { merge: true });
    batch.set(doc(db, `families/${familyId}/wallets`, child2), {
      balance: 444, lastTransferTxId: `${approvalTxId}_out`, lastTransferReqId: 'sib',
    }, { merge: true });
    batch.set(doc(db, `families/${familyId}/wallet_transactions/${approvalTxId}_out`), {
      type: 'transfer_out', childId: child2, counterpartyChildId: child1, amountPence: -556,
      moneyRequestId: 'sib', approvalTxId, note: '', parentRef: parentId, familyId, sourceId: 'sib',
      actorId: parentId, status: 'completed', createdAt: serverTimestamp(), timestamp: serverTimestamp(),
    });
    batch.set(doc(db, `families/${familyId}/wallet_transactions/${approvalTxId}_in`), {
      type: 'transfer_in', childId: child1, counterpartyChildId: child2, amountPence: 556,
      moneyRequestId: 'sib', approvalTxId, note: '', parentRef: parentId, familyId, sourceId: 'sib',
      actorId: parentId, status: 'completed', createdAt: serverTimestamp(), timestamp: serverTimestamp(),
    });
    batch.update(doc(db, `families/${familyId}/money_requests/sib`), {
      status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: parentId, reviewedByName: 'Kemal',
      paymentTransferId: approvalTxId,
    });
    await assertFails(batch.commit());
  });
});
