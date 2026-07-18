import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, serverTimestamp } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-transfers-rules-test',
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

  // Setup base documents via admin
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    // Families
    await setDoc(doc(db, 'families/family1'), { name: 'Family 1' });
    await setDoc(doc(db, 'families/family2'), { name: 'Family 2' });

    // Users
    await setDoc(doc(db, 'users/parent1'), { familyId: 'family1', role: 'parent' });
    await setDoc(doc(db, 'users/child1'), { familyId: 'family1', role: 'child' });
    await setDoc(doc(db, 'users/child2'), { familyId: 'family1', role: 'child' });

    await setDoc(doc(db, 'users', 'parent2'), { familyId: 'family2', role: 'parent' });
    await setDoc(doc(db, 'users', 'child3'), { familyId: 'family2', role: 'child' });

    await setDoc(doc(db, 'users', 'child4'), { familyId: 'family1', role: 'child', walletBalance: 25700 });
    await setDoc(doc(db, 'users', 'child5'), { familyId: 'family1', role: 'child', walletBalance: 0 });

    // Wallets
    await setDoc(doc(db, 'families/family1/wallets/child1'), { balance: 500 });
    await setDoc(doc(db, 'families/family1/wallets/child2'), { balance: 200 });

    // An existing pending request
    await setDoc(doc(db, 'families/family1/transfer_requests/req1'), {
      id: 'req1', familyId: 'family1', fromChildId: 'child1', fromChildName: 'C1',
      toChildId: 'child2', toChildName: 'C2', amountPence: 100, message: 'hi',
      status: 'pending', createdAt: serverTimestamp()
    });

    await setDoc(doc(db, 'families/family1/transfer_requests/req2'), {
      id: 'req2', familyId: 'family1', fromChildId: 'child4', fromChildName: 'C4',
      toChildId: 'child5', toChildName: 'C5', amountPence: 100, message: 'hi',
      status: 'pending', createdAt: serverTimestamp()
    });
  });
});

describe('Child-to-Child Transfer Rules', () => {

  it('legacy walletBalance privacy: child can read sibling users doc but fields are removed', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    const siblingDoc = await getDoc(doc(db, 'users/child2'));
    expect(siblingDoc.exists()).toBe(true);
    expect(siblingDoc.data()?.walletBalance).toBeUndefined();
  });

  it('child reading sibling wallet: denied', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(getDoc(doc(db, 'families/family1/wallets/child2')));
  });

  it('child querying all wallets: denied', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(getDocs(collection(db, 'families/family1/wallets')));
  });

  it('child reading sibling transfer request: denied', async () => {
    const db = testEnv.authenticatedContext('child3').firestore();
    await assertFails(getDoc(doc(db, 'families/family1/transfer_requests/req1')));
  });

  it('child reading own transfer request: allowed', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertSucceeds(getDoc(doc(db, 'families/family1/transfer_requests/req1')));
  });

  it('parent direct wallet change without ledger: denied', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(updateDoc(doc(db, 'families/family1/wallets/child1'), { balance: 1000 }));
  });

  it('direct sender wallet change: denied', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(updateDoc(doc(db, 'families/family1/wallets/child1'), { balance: 400 }));
  });

  it('direct recipient wallet change: denied', async () => {
    const db = testEnv.authenticatedContext('child2').firestore();
    await assertFails(updateDoc(doc(db, 'families/family1/wallets/child2'), { balance: 300 }));
  });

  it('unrelated wallet field change: denied', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(updateDoc(doc(db, 'families/family1/wallets/child1'), { someOtherField: true }));
  });

  it('self-transfer: denied', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(setDoc(doc(db, 'families/family1/transfer_requests/req2'), {
      familyId: 'family1', fromChildId: 'child1', toChildId: 'child1', amountPence: 100, status: 'pending', createdAt: serverTimestamp()
    }));
  });

  it('zero, negative and fractional amount: denied', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(setDoc(doc(db, 'families/family1/transfer_requests/req2'), {
      familyId: 'family1', fromChildId: 'child1', toChildId: 'child2', amountPence: 0, status: 'pending', createdAt: serverTimestamp()
    }));
    await assertFails(setDoc(doc(db, 'families/family1/transfer_requests/req2'), {
      familyId: 'family1', fromChildId: 'child1', toChildId: 'child2', amountPence: -50, status: 'pending', createdAt: serverTimestamp()
    }));
    await assertFails(setDoc(doc(db, 'families/family1/transfer_requests/req2'), {
      familyId: 'family1', fromChildId: 'child1', toChildId: 'child2', amountPence: 10.5, status: 'pending', createdAt: serverTimestamp()
    }));
  });

  it('wrong-family sender: denied', async () => {
    const db = testEnv.authenticatedContext('child3').firestore();
    await assertFails(setDoc(doc(db, 'families/family1/transfer_requests/req2'), {
      familyId: 'family1', fromChildId: 'child3', toChildId: 'child2', amountPence: 100, status: 'pending', createdAt: serverTimestamp()
    }));
  });

  it('wrong-family recipient: denied', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(setDoc(doc(db, 'families/family1/transfer_requests/req2'), {
      familyId: 'family1', fromChildId: 'child1', toChildId: 'child3', amountPence: 100, status: 'pending', createdAt: serverTimestamp()
    }));
  });

  it('non-child sender: denied', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(setDoc(doc(db, 'families/family1/transfer_requests/req2'), {
      familyId: 'family1', fromChildId: 'parent1', toChildId: 'child2', amountPence: 100, status: 'pending', createdAt: serverTimestamp()
    }));
  });

  it('approval without sender ledger: denied', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    const batch = db.batch();
    batch.update(doc(db, 'families/family1/transfer_requests/req1'), { status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: 'parent1', approvalTxId: 'tx1' });
    batch.update(doc(db, 'families/family1/wallets/child1'), { balance: 400, lastTransferTxId: 'tx1_out', lastTransferReqId: 'req1' });
    batch.update(doc(db, 'families/family1/wallets/child2'), { balance: 300, lastTransferTxId: 'tx1_in', lastTransferReqId: 'req1' });
    batch.set(doc(db, 'families/family1/wallet_transactions/tx1_in'), {
      type: 'transfer_in', childId: 'child2', counterpartyChildId: 'child1', amountPence: 100, transferRequestId: 'req1', approvalTxId: 'tx1', createdAt: serverTimestamp(), parentRef: 'parent1', note: '' });
    await assertFails(batch.commit());
  });

  it('approval without recipient ledger: denied', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    const batch = db.batch();
    batch.update(doc(db, 'families/family1/transfer_requests/req1'), { status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: 'parent1', approvalTxId: 'tx1' });
    batch.update(doc(db, 'families/family1/wallets/child1'), { balance: 400, lastTransferTxId: 'tx1_out', lastTransferReqId: 'req1' });
    batch.update(doc(db, 'families/family1/wallets/child2'), { balance: 300, lastTransferTxId: 'tx1_in', lastTransferReqId: 'req1' });
    batch.set(doc(db, 'families/family1/wallet_transactions/tx1_out'), {
      type: 'transfer_out', childId: 'child1', counterpartyChildId: 'child2', amountPence: -100, transferRequestId: 'req1', approvalTxId: 'tx1', createdAt: serverTimestamp(), parentRef: 'parent1', note: '' });
    await assertFails(batch.commit());
  });

  it('approval with exact atomic linkage: allowed', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    const batch = db.batch();
    batch.update(doc(db, 'families/family1/transfer_requests/req1'), { status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: 'parent1', approvalTxId: 'tx1', reviewedByName: 'P1' });
    batch.update(doc(db, 'families/family1/wallets/child1'), { balance: 400, lastTransferTxId: 'tx1_out', lastTransferReqId: 'req1' });
    batch.update(doc(db, 'families/family1/wallets/child2'), { balance: 300, lastTransferTxId: 'tx1_in', lastTransferReqId: 'req1' });
    batch.set(doc(db, 'families/family1/wallet_transactions/tx1_out'), {
      type: 'transfer_out', childId: 'child1', counterpartyChildId: 'child2', amountPence: -100, transferRequestId: 'req1', approvalTxId: 'tx1', createdAt: serverTimestamp(), parentRef: 'parent1', note: '' });
    batch.set(doc(db, 'families/family1/wallet_transactions/tx1_in'), {
      type: 'transfer_in', childId: 'child2', counterpartyChildId: 'child1', amountPence: 100, transferRequestId: 'req1', approvalTxId: 'tx1', createdAt: serverTimestamp(), parentRef: 'parent1', note: '' });
    await assertSucceeds(batch.commit());
  });

  it('real flow test: complete approval and reject double approval', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    const batch = db.batch();
    batch.update(doc(db, 'families/family1/transfer_requests/req1'), { status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: 'parent1', approvalTxId: 'txFlow', reviewedByName: 'P1' });
    batch.update(doc(db, 'families/family1/wallets/child1'), { balance: 400, lastTransferTxId: 'txFlow_out', lastTransferReqId: 'req1' });
    batch.update(doc(db, 'families/family1/wallets/child2'), { balance: 300, lastTransferTxId: 'txFlow_in', lastTransferReqId: 'req1' });
    batch.set(doc(db, 'families/family1/wallet_transactions/txFlow_out'), {
      type: 'transfer_out', childId: 'child1', counterpartyChildId: 'child2', amountPence: -100, transferRequestId: 'req1', approvalTxId: 'txFlow', createdAt: serverTimestamp(), parentRef: 'parent1', note: 'hi' });
    batch.set(doc(db, 'families/family1/wallet_transactions/txFlow_in'), {
      type: 'transfer_in', childId: 'child2', counterpartyChildId: 'child1', amountPence: 100, transferRequestId: 'req1', approvalTxId: 'txFlow', createdAt: serverTimestamp(), parentRef: 'parent1', note: 'hi' });

    await assertSucceeds(batch.commit());

    // Attempt second approval
    const db2 = testEnv.authenticatedContext('parent1').firestore();
    const batch2 = db2.batch();
    batch2.update(doc(db2, 'families/family1/transfer_requests/req1'), { status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: 'parent1', approvalTxId: 'txFlow2', reviewedByName: 'P1' });
    batch2.update(doc(db2, 'families/family1/wallets/child1'), { balance: 300, lastTransferTxId: 'txFlow2_out', lastTransferReqId: 'req1' });
    batch2.update(doc(db2, 'families/family1/wallets/child2'), { balance: 400, lastTransferTxId: 'txFlow2_in', lastTransferReqId: 'req1' });
    batch2.set(doc(db2, 'families/family1/wallet_transactions/txFlow2_out'), {
      type: 'transfer_out', childId: 'child1', counterpartyChildId: 'child2', amountPence: -100, transferRequestId: 'req1', approvalTxId: 'txFlow2', createdAt: serverTimestamp(), parentRef: 'parent1', note: 'hi' });
    batch2.set(doc(db2, 'families/family1/wallet_transactions/txFlow2_in'), {
      type: 'transfer_in', childId: 'child2', counterpartyChildId: 'child1', amountPence: 100, transferRequestId: 'req1', approvalTxId: 'txFlow2', createdAt: serverTimestamp(), parentRef: 'parent1', note: 'hi' });

    await assertFails(batch2.commit());
  });


  it('mismatched approvalTxId: denied', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    const batch = db.batch();
    batch.update(doc(db, 'families/family1/transfer_requests/req1'), { status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: 'parent1', approvalTxId: 'tx1', reviewedByName: 'P1' });
    batch.update(doc(db, 'families/family1/wallets/child1'), { balance: 400, lastTransferTxId: 'tx2_out', lastTransferReqId: 'req1' });
    batch.update(doc(db, 'families/family1/wallets/child2'), { balance: 300, lastTransferTxId: 'tx1_in', lastTransferReqId: 'req1' });
    batch.set(doc(db, 'families/family1/wallet_transactions/tx2_out'), {
      type: 'transfer_out', childId: 'child1', counterpartyChildId: 'child2', amountPence: -100, transferRequestId: 'req1', approvalTxId: 'tx2', createdAt: serverTimestamp(), parentRef: 'parent1', note: '' });
    batch.set(doc(db, 'families/family1/wallet_transactions/tx1_in'), {
      type: 'transfer_in', childId: 'child2', counterpartyChildId: 'child1', amountPence: 100, transferRequestId: 'req1', approvalTxId: 'tx1', createdAt: serverTimestamp(), parentRef: 'parent1', note: '' });
    await assertFails(batch.commit());
  });

  it('mismatched transferRequestId: denied', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    const batch = db.batch();
    batch.update(doc(db, 'families/family1/transfer_requests/req1'), { status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: 'parent1', approvalTxId: 'tx1', reviewedByName: 'P1' });
    batch.update(doc(db, 'families/family1/wallets/child1'), { balance: 400, lastTransferTxId: 'tx1_out', lastTransferReqId: 'req2' });
    batch.update(doc(db, 'families/family1/wallets/child2'), { balance: 300, lastTransferTxId: 'tx1_in', lastTransferReqId: 'req1' });
    batch.set(doc(db, 'families/family1/wallet_transactions/tx1_out'), {
      type: 'transfer_out', childId: 'child1', counterpartyChildId: 'child2', amountPence: -100, transferRequestId: 'req2', approvalTxId: 'tx1', createdAt: serverTimestamp(), parentRef: 'parent1', note: '' });
    batch.set(doc(db, 'families/family1/wallet_transactions/tx1_in'), {
      type: 'transfer_in', childId: 'child2', counterpartyChildId: 'child1', amountPence: 100, transferRequestId: 'req1', approvalTxId: 'tx1', createdAt: serverTimestamp(), parentRef: 'parent1', note: '' });
    await assertFails(batch.commit());
  });

  it('mismatched sender amount: denied', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    const batch = db.batch();
    batch.update(doc(db, 'families/family1/transfer_requests/req1'), { status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: 'parent1', approvalTxId: 'tx1', reviewedByName: 'P1' });
    batch.update(doc(db, 'families/family1/wallets/child1'), { balance: 450, lastTransferTxId: 'tx1_out', lastTransferReqId: 'req1' });
    batch.update(doc(db, 'families/family1/wallets/child2'), { balance: 300, lastTransferTxId: 'tx1_in', lastTransferReqId: 'req1' });
    batch.set(doc(db, 'families/family1/wallet_transactions/tx1_out'), {
      type: 'transfer_out', childId: 'child1', counterpartyChildId: 'child2', amountPence: -50, transferRequestId: 'req1', approvalTxId: 'tx1', createdAt: serverTimestamp(), parentRef: 'parent1', note: '' });
    batch.set(doc(db, 'families/family1/wallet_transactions/tx1_in'), {
      type: 'transfer_in', childId: 'child2', counterpartyChildId: 'child1', amountPence: 100, transferRequestId: 'req1', approvalTxId: 'tx1', createdAt: serverTimestamp(), parentRef: 'parent1', note: '' });
    await assertFails(batch.commit());
  });

  it('forged reviewer: denied', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    const batch = db.batch();
    batch.update(doc(db, 'families/family1/transfer_requests/req1'), { status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: 'parent1', approvalTxId: 'tx1', reviewedByName: 'P1' });
    batch.update(doc(db, 'families/family1/wallets/child1'), { balance: 400, lastTransferTxId: 'tx1_out', lastTransferReqId: 'req1' });
    batch.update(doc(db, 'families/family1/wallets/child2'), { balance: 300, lastTransferTxId: 'tx1_in', lastTransferReqId: 'req1' });
    batch.set(doc(db, 'families/family1/wallet_transactions/tx1_out'), {
      type: 'transfer_out', childId: 'child1', counterpartyChildId: 'child2', amountPence: -100, transferRequestId: 'req1', approvalTxId: 'tx1', createdAt: serverTimestamp(), parentRef: 'parent1', note: '' });
    batch.set(doc(db, 'families/family1/wallet_transactions/tx1_in'), {
      type: 'transfer_in', childId: 'child2', counterpartyChildId: 'child1', amountPence: 100, transferRequestId: 'req1', approvalTxId: 'tx1', createdAt: serverTimestamp(), parentRef: 'parent1', note: '' });
    await assertFails(batch.commit());
  });

  it('wrong-family reviewer: denied', async () => {
    const db = testEnv.authenticatedContext('parent2').firestore();
    const batch = db.batch();
    batch.update(doc(db, 'families/family1/transfer_requests/req1'), { status: 'approved', reviewedAt: serverTimestamp(), reviewedBy: 'parent2', approvalTxId: 'tx1', reviewedByName: 'P1' });
    batch.update(doc(db, 'families/family1/wallets/child1'), { balance: 400, lastTransferTxId: 'tx1_out', lastTransferReqId: 'req1' });
    batch.update(doc(db, 'families/family1/wallets/child2'), { balance: 300, lastTransferTxId: 'tx1_in', lastTransferReqId: 'req1' });
    batch.set(doc(db, 'families/family1/wallet_transactions/tx1_out'), {
      type: 'transfer_out', childId: 'child1', counterpartyChildId: 'child2', amountPence: -100, transferRequestId: 'req1', approvalTxId: 'tx1', createdAt: serverTimestamp(), parentRef: 'parent1', note: '' });
    batch.set(doc(db, 'families/family1/wallet_transactions/tx1_in'), {
      type: 'transfer_in', childId: 'child2', counterpartyChildId: 'child1', amountPence: 100, transferRequestId: 'req1', approvalTxId: 'tx1', createdAt: serverTimestamp(), parentRef: 'parent1', note: '' });
    await assertFails(batch.commit());
  });

  it('unrelated request field change: denied', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(updateDoc(doc(db, 'families/family1/transfer_requests/req1'), { someOtherField: true }));
  });

  it('approves transfer with missing wallets, creating them from legacy balances', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    const batch = db.batch();
    const reqRef = doc(db, 'families/family1/transfer_requests/reqLive');
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'families/family1/transfer_requests/reqLive'), {
        id: 'reqLive', familyId: 'family1', fromChildId: 'child4', fromChildName: 'C4',
        toChildId: 'child5', toChildName: 'C5', amountPence: 100, message: 'hi',
        status: 'pending', createdAt: serverTimestamp()
      });
      await setDoc(doc(context.firestore(), 'users/child4'), { familyId: 'family1', role: 'child', walletBalance: 25700 });
      await setDoc(doc(context.firestore(), 'users/child5'), { familyId: 'family1', role: 'child', walletBalance: 0 });
    });

    batch.update(reqRef, {
      status: 'approved',
      reviewedAt: serverTimestamp(),
      reviewedBy: 'parent1',
      approvalTxId: 'txLive',
      reviewedByName: 'P1'
    });

    batch.set(doc(db, 'families/family1/wallets/child4'), {
      balance: 25600,
      createdAt: serverTimestamp(),
      migratedFromLegacy: true,
      lastTransferTxId: 'txLive_out',
      lastTransferReqId: 'reqLive'
    });

    batch.set(doc(db, 'families/family1/wallets/child5'), {
      balance: 100,
      createdAt: serverTimestamp(),
      migratedFromLegacy: true,
      lastTransferTxId: 'txLive_in',
      lastTransferReqId: 'reqLive'
    });

    batch.set(doc(db, 'families/family1/wallet_transactions/txLive_out'), {
      type: 'transfer_out', childId: 'child4', counterpartyChildId: 'child5', amountPence: -100, transferRequestId: 'reqLive', approvalTxId: 'txLive', createdAt: serverTimestamp(), parentRef: 'parent1', note: 'hi' });

    batch.set(doc(db, 'families/family1/wallet_transactions/txLive_in'), {
      type: 'transfer_in', childId: 'child5', counterpartyChildId: 'child4', amountPence: 100, transferRequestId: 'reqLive', approvalTxId: 'txLive', createdAt: serverTimestamp(), parentRef: 'parent1', note: 'hi' });

    await assertSucceeds(batch.commit());
  });
});
