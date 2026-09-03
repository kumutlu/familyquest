// ---------------------------------------------------------------------------
// FIRESTORE RULES — CHILD QR ONBOARDING (mandatory parent approval)
// ---------------------------------------------------------------------------
// The child_qr_join_requests collection is readable by parents/owners of the
// target family only, and is never client-writable. All credential-adjacent
// material (child_qr_sessions, childQrJoinSecrets, childQrTokenLookup,
// childQrRequestLookup, qrIdempotency) is fully server-owned and denied to
// every client, including the family's own owner.
// ---------------------------------------------------------------------------

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

let testEnv: any;
const projectId = 'familyquest-childqr-rules';
const familyId = 'familyQR';
const otherFamilyId = 'familyOTHER';
const ownerId = 'owner1';
const parentId = 'parent1';
const childId = 'child1';
const childAuthUid = 'auth-child1';
const otherParentId = 'otherParent1';
const strangerId = 'stranger1';
const requestId = 'qrreq-abc123';
const sessionId = 'qrsess-xyz456';
const tokenHash = 'hash-789';

const requestPath = `families/${familyId}/child_qr_join_requests/${requestId}`;
const sessionPath = `families/${familyId}/child_qr_sessions/${sessionId}`;
const secretPath = `families/${familyId}/childQrJoinSecrets/${requestId}`;
const tokenLookupPath = `childQrTokenLookup/${tokenHash}`;
const requestLookupPath = `childQrRequestLookup/${requestId}`;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context: any) => {
    const db = context.firestore();
    await setDoc(doc(db, 'families', familyId), { name: 'Family', currencyCode: 'GBP' });
    await setDoc(doc(db, 'families', otherFamilyId), { name: 'Other', currencyCode: 'GBP' });
    await setDoc(doc(db, 'users', ownerId), { familyId, role: 'owner', displayName: 'Owner' });
    await setDoc(doc(db, 'users', parentId), { familyId, role: 'parent', displayName: 'Parent' });
    await setDoc(doc(db, 'users', childId), {
      familyId, role: 'child', isManaged: true, authUid: childAuthUid, displayName: 'Alex',
    });
    await setDoc(doc(db, 'users', otherParentId), {
      familyId: otherFamilyId, role: 'parent', displayName: 'Other Parent',
    });
    await setDoc(doc(db, 'users', strangerId), { familyId: null, role: 'parent', displayName: 'Stranger' });

    // Server-written records
    await setDoc(doc(db, requestPath), {
      requestId,
      qrSessionId: sessionId,
      familyId,
      status: 'pending',
      createdAtMs: 1_700_000_000_000,
    });
    await setDoc(doc(db, sessionPath), { status: 'active', familyId });
    await setDoc(doc(db, secretPath), { requestSecretHash: 'deadbeef' });
    await setDoc(doc(db, tokenLookupPath), { familyId, status: 'active' });
    await setDoc(doc(db, requestLookupPath), { familyId });
  });
});

describe('Task 5: Firestore Security Rules — child_qr_join_requests visibility', () => {
  it('lets the owner of the target family read a request', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    await assertSucceeds(getDoc(doc(db, requestPath)));
  });

  it('lets a parent of the target family list requests', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertSucceeds(getDocs(collection(db, `families/${familyId}/child_qr_join_requests`)));
  });

  it('denies a parent of a different family', async () => {
    const db = testEnv.authenticatedContext(otherParentId).firestore();
    await assertFails(getDoc(doc(db, requestPath)));
  });

  it('denies a managed child of the target family', async () => {
    const db = testEnv
      .authenticatedContext(childAuthUid, { role: 'child', managedChild: true, childId, familyId })
      .firestore();
    await assertFails(getDoc(doc(db, requestPath)));
  });

  it('denies an unauthenticated reader', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, requestPath)));
  });
});

describe('Task 5: Firestore Security Rules — child_qr_join_requests are never client-writable', () => {
  it('denies the owner creating a request', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    await assertFails(setDoc(doc(db, `families/${familyId}/child_qr_join_requests/forged`), {
      status: 'approved',
    }));
  });

  it('denies the owner approving a request directly', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    await assertFails(updateDoc(doc(db, requestPath), { status: 'approved' }));
  });

  it('denies the owner deleting a request', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    await assertFails(deleteDoc(doc(db, requestPath)));
  });
});

describe('Task 5: Firestore Security Rules — Test 44 credential-adjacent collections are server-only', () => {
  it('denies every client read/write of child_qr_sessions', async () => {
    for (const context of [testEnv.authenticatedContext(ownerId), testEnv.unauthenticatedContext()]) {
      const db = context.firestore();
      await assertFails(getDoc(doc(db, sessionPath)));
      await assertFails(setDoc(doc(db, sessionPath), { status: 'revoked' }));
    }
  });

  it('denies every client read/write of childQrJoinSecrets', async () => {
    for (const context of [testEnv.authenticatedContext(ownerId), testEnv.unauthenticatedContext()]) {
      const db = context.firestore();
      await assertFails(getDoc(doc(db, secretPath)));
      await assertFails(setDoc(doc(db, secretPath), { requestSecretHash: 'x' }));
    }
  });

  it('denies every client read/write of childQrTokenLookup', async () => {
    for (const context of [testEnv.authenticatedContext(ownerId), testEnv.unauthenticatedContext()]) {
      const db = context.firestore();
      await assertFails(getDoc(doc(db, tokenLookupPath)));
      await assertFails(setDoc(doc(db, tokenLookupPath), { familyId }));
    }
  });

  it('denies every client read/write of childQrRequestLookup', async () => {
    for (const context of [testEnv.authenticatedContext(ownerId), testEnv.unauthenticatedContext()]) {
      const db = context.firestore();
      await assertFails(getDoc(doc(db, requestLookupPath)));
      await assertFails(setDoc(doc(db, requestLookupPath), { familyId }));
    }
  });
});
