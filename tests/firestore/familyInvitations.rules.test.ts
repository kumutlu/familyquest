// ---------------------------------------------------------------------------
// FIRESTORE RULES — ROLE-AUTHORITATIVE FAMILY INVITATIONS
// ---------------------------------------------------------------------------
// Invitation records are entirely server-owned: no client, not even the family
// owner, may read or write them. When a join request originated from an
// invitation, the stamped intendedRole is the only role the approving owner
// may assign.
// ---------------------------------------------------------------------------

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

let testEnv: any;
const projectId = 'familyquest-invitations-rules';
const familyId = 'familyINV';
const ownerId = 'ownerINV';
const joinerId = 'joinerINV';
const code = '7ZXWRZ';

const invitationPath = `families/${familyId}/invitations/${code}`;
const requestPath = `families/${familyId}/join_requests/${joinerId}`;

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
    await setDoc(doc(db, 'users', ownerId), { familyId, role: 'owner', displayName: 'Owner' });
    await setDoc(doc(db, 'users', joinerId), { displayName: 'Joiner' });
    await setDoc(doc(db, invitationPath), {
      code, familyId, intendedRole: 'child', createdBy: ownerId, status: 'active',
      expiresAtMs: 4_000_000_000_000,
    });
    // Server-written, invitation-derived join request.
    await setDoc(doc(db, requestPath), {
      uid: joinerId, displayName: 'Joiner', status: 'pending',
      intendedRole: 'child', invitationCode: code,
    });
  });
});

describe('invitation records', () => {
  it('are unreadable by the family owner', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    await assertFails(getDoc(doc(db, invitationPath)));
  });

  it('are unreadable by an unauthenticated visitor holding the code', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, invitationPath)));
  });

  it('cannot be created by a client', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    await assertFails(setDoc(doc(db, `families/${familyId}/invitations/AAAAAA`), {
      code: 'AAAAAA', familyId, intendedRole: 'parent', createdBy: ownerId, status: 'active',
    }));
  });

  it('cannot be escalated to a parent invitation by a client', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    await assertFails(updateDoc(doc(db, invitationPath), { intendedRole: 'parent' }));
  });

  it('cannot be deleted by a client', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    await assertFails(deleteDoc(doc(db, invitationPath)));
  });
});

describe('invitation-derived join requests', () => {
  it('preserves atomic approval of a pending legacy invitation request', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', joinerId), {
      uid: joinerId,
      joinRequestId: joinerId,
      familyId,
      role: 'child',
      displayName: 'Joiner',
      avatarUrl: 'avatar',
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastActiveDate: serverTimestamp(),
    }, { merge: true });
    batch.set(doc(db, `families/${familyId}/wallets/${joinerId}`), {
      balance: 0,
      createdAt: serverTimestamp(),
      migratedFromLegacy: true,
    });
    batch.update(doc(db, requestPath), {
      status: 'approved',
      assignedRole: 'child',
      reviewedBy: ownerId,
      reviewedByName: 'Owner',
      reviewedAt: serverTimestamp(),
    });
    batch.set(doc(db, `families/${familyId}/feed/join_${joinerId}`), {
      actorId: ownerId,
      type: 'custom',
      text: 'Joiner joined through a legacy invitation',
      timestamp: serverTimestamp(),
    });

    await assertSucceeds(batch.commit());
  });

  it('reject an approval that assigns a different role than the invitation', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    await assertFails(updateDoc(doc(db, requestPath), {
      status: 'approved',
      assignedRole: 'parent',
      reviewedBy: ownerId,
      reviewedByName: 'Owner',
      reviewedAt: serverTimestamp(),
    }));
  });

  it('reject an approval that assigns the owner role', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    await assertFails(updateDoc(doc(db, requestPath), {
      status: 'approved',
      assignedRole: 'owner',
      reviewedBy: ownerId,
      reviewedByName: 'Owner',
      reviewedAt: serverTimestamp(),
    }));
  });

  it('reject an attempt to rewrite the stamped intendedRole', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    await assertFails(updateDoc(doc(db, requestPath), { intendedRole: 'parent' }));
  });
});
