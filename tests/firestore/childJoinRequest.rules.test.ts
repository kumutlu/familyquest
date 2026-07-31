// ---------------------------------------------------------------------------
// FIRESTORE RULES — CHILD JOIN REQUESTS (mandatory parent approval)
// ---------------------------------------------------------------------------
// The join-request projection is readable by parents/owners of the target
// family only, and is never client-writable. All credential-adjacent material
// (childJoinSecrets, childJoinRequestLookup, childJoinRateLimits) is fully
// server-owned and denied to every client, including the family's own owner.
// ---------------------------------------------------------------------------

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

let testEnv: any;
const projectId = 'familyquest-childjoin-rules';
const familyId = 'familyJOIN';
const otherFamilyId = 'familyOTHER';
const ownerId = 'owner1';
const parentId = 'parent1';
const childId = 'child1';
const childAuthUid = 'auth-child1';
const otherParentId = 'otherParent1';
const strangerId = 'stranger1';
const requestId = 'joinreq-abc123';

const requestPath = `families/${familyId}/child_join_requests/${requestId}`;

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
    // Server-written projection: no password, no family code, no secret.
    await setDoc(doc(db, requestPath), {
      normalizedUsername: 'alex star',
      displayUsername: 'Alex Star',
      status: 'pending',
      createdAtMs: 1_700_000_000_000,
      expiresAtMs: 1_700_604_800_000,
    });
    await setDoc(doc(db, `families/${familyId}/childJoinSecrets/${requestId}`), {
      secretHash: 'deadbeef', pendingAuthUid: 'auth-pending-1',
    });
    await setDoc(doc(db, `childJoinRequestLookup/${requestId}`), { familyId });
    await setDoc(doc(db, 'childJoinRateLimits/ip-1.2.3.4'), { events: [] });
  });
});

describe('child_join_requests visibility', () => {
  it('lets the owner of the target family read a request', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    await assertSucceeds(getDoc(doc(db, requestPath)));
  });

  it('lets a parent of the target family list requests', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertSucceeds(getDocs(collection(db, `families/${familyId}/child_join_requests`)));
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

  it('denies a signed-in user with no family', async () => {
    const db = testEnv.authenticatedContext(strangerId).firestore();
    await assertFails(getDoc(doc(db, requestPath)));
  });
});

describe('child_join_requests are never client-writable', () => {
  it('denies the owner creating a request', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    await assertFails(setDoc(doc(db, `families/${familyId}/child_join_requests/forged`), {
      normalizedUsername: 'mallory', status: 'approved',
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

  it('denies an unauthenticated write', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, requestPath), { status: 'approved' }));
  });
});

describe('credential-adjacent collections are server-only', () => {
  it('denies every client read/write of childJoinSecrets', async () => {
    const path = `families/${familyId}/childJoinSecrets/${requestId}`;
    for (const context of [
      testEnv.authenticatedContext(ownerId),
      testEnv.authenticatedContext(parentId),
      testEnv.unauthenticatedContext(),
    ]) {
      const db = context.firestore();
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), { secretHash: 'x' }));
    }
  });

  it('denies every client read/write of childJoinRequestLookup', async () => {
    for (const context of [testEnv.authenticatedContext(ownerId), testEnv.unauthenticatedContext()]) {
      const db = context.firestore();
      await assertFails(getDoc(doc(db, `childJoinRequestLookup/${requestId}`)));
      await assertFails(setDoc(doc(db, `childJoinRequestLookup/${requestId}`), { familyId }));
    }
  });

  it('denies every client read/write of childJoinRateLimits', async () => {
    for (const context of [testEnv.authenticatedContext(ownerId), testEnv.unauthenticatedContext()]) {
      const db = context.firestore();
      await assertFails(getDoc(doc(db, 'childJoinRateLimits/ip-1.2.3.4')));
      await assertFails(setDoc(doc(db, 'childJoinRateLimits/ip-1.2.3.4'), { events: [] }));
    }
  });

  it('keeps the reservation namespace (childLoginIndex) server-only', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    await assertFails(getDoc(doc(db, `families/${familyId}/childLoginIndex/alex star`)));
    await assertFails(setDoc(doc(db, `families/${familyId}/childLoginIndex/alex star`), {
      status: 'reserved', reservedByRequestId: requestId,
    }));
  });
});
