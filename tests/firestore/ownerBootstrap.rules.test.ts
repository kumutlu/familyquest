import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { readFileSync } from 'fs';

let testEnv: RulesTestEnvironment;

const familyId = 'bootstrap-family';
const otherFamilyId = 'other-family';
const ownerId = 'bootstrap-owner';
const otherOwnerId = 'other-family-owner';
const childId = 'bootstrap-child';
const parentId = 'bootstrap-parent';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-owner-bootstrap',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    // Create a family owned by ownerId (legitimate owner)
    await setDoc(doc(db, 'families', familyId), {
      name: 'Bootstrap Family',
      ownerId: ownerId,
      createdBy: ownerId,
    });

    // Create another family owned by otherOwnerId
    await setDoc(doc(db, 'families', otherFamilyId), {
      name: 'Other Family',
      ownerId: otherOwnerId,
      createdBy: otherOwnerId,
    });

    // Create a user document for the owner (no family yet, role: parent)
    await setDoc(doc(db, 'users', ownerId), {
      role: 'parent',
      displayName: 'Future Owner',
    });

    // Create a user document for another user (no family yet, role: parent)
    await setDoc(doc(db, 'users', otherOwnerId), {
      role: 'parent',
      displayName: 'Other Owner',
    });

    // Create a child user (has family, role: child)
    await setDoc(doc(db, 'users', childId), {
      familyId,
      role: 'child',
      displayName: 'Child',
    });

    // Create a parent user (has family)
    await setDoc(doc(db, 'users', parentId), {
      familyId,
      role: 'parent',
      displayName: 'Parent',
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('isValidOwnerBootstrap security tests', () => {
  it('0. Family creation and owner promotion succeed in the same atomic write', async () => {
    const atomicOwnerId = 'atomic-owner';
    const atomicFamilyId = 'atomic-family';
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', atomicOwnerId), {
        uid: atomicOwnerId,
        role: 'parent',
        displayName: 'Atomic Owner',
        rewardPoints: 0,
        lifetimeXP: 0,
        currentStreak: 0,
        longestStreak: 0,
      });
    });

    const db = testEnv.authenticatedContext(atomicOwnerId).firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'families', atomicFamilyId), {
      name: 'Atomic Family',
      inviteCode: 'ATOMIC',
    });
    batch.update(doc(db, 'users', atomicOwnerId), {
      familyId: atomicFamilyId,
      role: 'owner',
    });

    await assertSucceeds(batch.commit());
  });

  it('0b. Owner promotion after the family already exists is denied', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();

    await assertFails(updateDoc(doc(db, 'users', ownerId), {
      familyId,
      role: 'owner',
      uid: ownerId,
      displayName: 'Future Owner',
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
    }));
  });

  it('1. Owner bootstrap cannot be split from family creation', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();

    await assertFails(updateDoc(doc(db, 'users', ownerId), {
      familyId,
      role: 'owner',
      uid: ownerId,
      displayName: 'Future Owner',
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
    }));
  });

  it('2. User cannot claim another existing family', async () => {
    // otherOwnerId tries to claim familyId (owned by ownerId)
    // This should fail because family.ownerId != otherOwnerId
    const db = testEnv.authenticatedContext(otherOwnerId).firestore();

    await assertFails(updateDoc(doc(db, 'users', otherOwnerId), {
      familyId,
      role: 'owner',
      uid: otherOwnerId,
      displayName: 'Other Owner',
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
    }));
  });

  it('3. Child cannot become owner', async () => {
    // A child (who already has a family) tries to bootstrap as owner
    // This should fail because resource.data.role == 'child', not 'parent'
    const db = testEnv.authenticatedContext(childId).firestore();

    await assertFails(updateDoc(doc(db, 'users', childId), {
      familyId,
      role: 'owner',
      uid: childId,
      displayName: 'Child',
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
    }));
  });

  it('4. Existing user cannot switch familyId', async () => {
    // A user who already has a family tries to switch to a different family
    // This should fail because 'familyId' already exists in resource.data
    const db = testEnv.authenticatedContext(parentId).firestore();

    await assertFails(updateDoc(doc(db, 'users', parentId), {
      familyId: otherFamilyId,
      role: 'owner',
      uid: parentId,
      displayName: 'Parent',
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
    }));
  });

  it('5. User cannot modify protected fields during bootstrap', async () => {
    // User tries to set rewardPoints to a non-zero value
    const db = testEnv.authenticatedContext(ownerId).firestore();

    await assertFails(updateDoc(doc(db, 'users', ownerId), {
      familyId,
      role: 'owner',
      uid: ownerId,
      displayName: 'Future Owner',
      rewardPoints: 100, // Not allowed - must be 0
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
    }));
  });

  it('6. User cannot add extra fields during bootstrap', async () => {
    // User tries to add an extra field not in allowedBootstrapFields
    const db = testEnv.authenticatedContext(ownerId).firestore();

    await assertFails(updateDoc(doc(db, 'users', ownerId), {
      familyId,
      role: 'owner',
      uid: ownerId,
      displayName: 'Future Owner',
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
      maliciousField: 'hacked', // Not in allowed fields
    }));
  });

  it('7. User cannot set non-zero lifetimeXP during bootstrap', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();

    await assertFails(updateDoc(doc(db, 'users', ownerId), {
      familyId,
      role: 'owner',
      uid: ownerId,
      displayName: 'Future Owner',
      rewardPoints: 0,
      lifetimeXP: 500, // Not allowed - must be 0
      currentStreak: 0,
      longestStreak: 0,
    }));
  });

  it('8. User cannot set non-zero currentStreak during bootstrap', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();

    await assertFails(updateDoc(doc(db, 'users', ownerId), {
      familyId,
      role: 'owner',
      uid: ownerId,
      displayName: 'Future Owner',
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 10, // Not allowed - must be 0
      longestStreak: 0,
    }));
  });

  it('9. User cannot set non-zero longestStreak during bootstrap', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();

    await assertFails(updateDoc(doc(db, 'users', ownerId), {
      familyId,
      role: 'owner',
      uid: ownerId,
      displayName: 'Future Owner',
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 50, // Not allowed - must be 0
    }));
  });

  it('10. User cannot set role to child during bootstrap', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();

    await assertFails(updateDoc(doc(db, 'users', ownerId), {
      familyId,
      role: 'child', // Not allowed - must be 'owner'
      uid: ownerId,
      displayName: 'Future Owner',
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
    }));
  });

  it('11. User cannot set uid to different value during bootstrap', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();

    await assertFails(updateDoc(doc(db, 'users', ownerId), {
      familyId,
      role: 'owner',
      uid: 'different-uid', // Not allowed - must match request.auth.uid
      displayName: 'Future Owner',
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
    }));
  });

  it('12. Unauthenticated user cannot bootstrap as owner', async () => {
    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(updateDoc(doc(db, 'users', ownerId), {
      familyId,
      role: 'owner',
      uid: ownerId,
      displayName: 'Future Owner',
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
    }));
  });

  it('13. A late bootstrap cannot bypass atomicity with optional avatar fields', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();

    await assertFails(updateDoc(doc(db, 'users', ownerId), {
      familyId,
      role: 'owner',
      uid: ownerId,
      displayName: 'Future Owner',
      avatarUrl: 'https://example.com/avatar.png',
      avatarId: 'starter-robot',
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
    }));
  });
});
