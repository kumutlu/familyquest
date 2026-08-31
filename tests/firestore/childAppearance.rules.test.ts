import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, deleteField } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

let testEnv: any;
const projectId = 'familyquest-child-appearance';
const familyId = 'f1';
const parentId = 'p1';
const ownerId = 'owner1';
const childId = 'c1';
const siblingId = 'c2';
const managedChildId = 'mc1';
const managedChildAuthUid = 'auth-mc1';

const validAvatarConfig = {
  version: 1,
  base: 'round',
  skinTone: 'warm',
  hairStyle: 'curls',
  hairColor: 'brown',
  face: 'happy',
  accessory: 'none',
  outfit: 'hoodie',
  outfitColor: 'purple',
  background: 'sky',
};

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context: any) => {
    const db = context.firestore();
    // Rules only grant access to an existing, active family document.
    await setDoc(doc(db, 'families', familyId), { name: 'Family', currencyCode: 'GBP' });
    await setDoc(doc(db, 'users', parentId), { familyId, role: 'parent', displayName: 'Kemal' });
    await setDoc(doc(db, 'users', ownerId), { familyId, role: 'owner', displayName: 'Owner' });
    await setDoc(doc(db, 'users', childId), {
      familyId, role: 'child', displayName: 'Alin', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alin',
      avatarId: 'starter-cat', rewardPoints: 500, lifetimeXP: 100,
    });
    await setDoc(doc(db, 'users', siblingId), {
      familyId, role: 'child', displayName: 'Muhammed', avatarUrl: '', rewardPoints: 50, lifetimeXP: 50,
    });
    // Managed child profile
    await setDoc(doc(db, 'users', managedChildId), {
      uid: managedChildId,
      authUid: managedChildAuthUid,
      isManaged: true,
      requiresPasswordChange: false,
      role: 'child',
      familyId,
      displayName: 'Managed Child',
      avatarId: 'starter-cat',
      rewardPoints: 1000,
      lifetimeXP: 500,
    });
    // A legitimate premium unlock record for child c1.
    await setDoc(doc(db, `families/${familyId}/users/${childId}/avatar_unlocks`, 'rare-neon'), {
      avatarId: 'rare-neon', userId: childId, familyId, costPoints: 150, source: 'points', actorId: childId,
    });
    // Premium unlock for managed child
    await setDoc(doc(db, `families/${familyId}/users/${managedChildId}/avatar_unlocks`, 'rare-neon'), {
      avatarId: 'rare-neon', userId: managedChildId, familyId, costPoints: 150, source: 'points', actorId: managedChildId,
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

function childDb() {
  return testEnv.authenticatedContext(childId).firestore();
}

function siblingDb() {
  return testEnv.authenticatedContext(siblingId).firestore();
}

function parentDb() {
  return testEnv.authenticatedContext(parentId).firestore();
}

function managedChildDb() {
  // Managed child authenticates with synthetic Auth UID but has childId claim
  return testEnv.authenticatedContext(managedChildAuthUid, {
    managedChild: true,
    childId: managedChildId,
    role: 'child',
    familyId,
  }).firestore();
}

function managedChildWrongAuthDb() {
  return testEnv.authenticatedContext('wrong-auth-uid', {
    managedChild: true,
    childId: managedChildId,
    role: 'child',
    familyId,
  }).firestore();
}

function managedChildWrongFamilyDb() {
  return testEnv.authenticatedContext(managedChildAuthUid, {
    managedChild: true,
    childId: managedChildId,
    role: 'child',
    familyId: 'other-family',
  }).firestore();
}

function managedChildPasswordChangeDb() {
  return testEnv.authenticatedContext(managedChildAuthUid, {
    managedChild: true,
    childId: managedChildId,
    role: 'child',
    familyId,
  }).firestore();
}

describe('CHILD APPEARANCE — valid self-service writes (ALLOW)', () => {
  it('child can update avatarConfig on self', async () => {
    const db = childDb();
    await assertSucceeds(updateDoc(doc(db, 'users', childId), {
      avatarConfig: validAvatarConfig,
    }));
  });

  it('child can update avatarId to starter avatar on self', async () => {
    const db = childDb();
    await assertSucceeds(updateDoc(doc(db, 'users', childId), {
      avatarId: 'starter-robot',
    }));
  });

  it('child can update avatarId to owned premium avatar on self', async () => {
    const db = childDb();
    await assertSucceeds(updateDoc(doc(db, 'users', childId), {
      avatarId: 'rare-neon',
    }));
  });

  it('child can update both avatarConfig and avatarId together on self', async () => {
    const db = childDb();
    await assertSucceeds(updateDoc(doc(db, 'users', childId), {
      avatarConfig: validAvatarConfig,
      avatarId: 'starter-robot',
    }));
  });

  it('child can set avatarConfig to null (deleteField) to clear creator config', async () => {
    const db = childDb();
    // First set a config
    await assertSucceeds(updateDoc(doc(db, 'users', childId), {
      avatarConfig: validAvatarConfig,
    }));
    // Then clear it
    await assertSucceeds(updateDoc(doc(db, 'users', childId), {
      avatarConfig: deleteField(),
    }));
  });

  it('managed child can update avatarConfig on effective self profile', async () => {
    const db = managedChildDb();
    await assertSucceeds(updateDoc(doc(db, 'users', managedChildId), {
      avatarConfig: validAvatarConfig,
    }));
  });

  it('managed child can update avatarId to starter avatar on effective self profile', async () => {
    const db = managedChildDb();
    await assertSucceeds(updateDoc(doc(db, 'users', managedChildId), {
      avatarId: 'starter-robot',
    }));
  });

  it('managed child can update avatarId to owned premium avatar on effective self profile', async () => {
    const db = managedChildDb();
    await assertSucceeds(updateDoc(doc(db, 'users', managedChildId), {
      avatarId: 'rare-neon',
    }));
  });
});

describe('CHILD APPEARANCE — invalid writes (DENY)', () => {
  it('child CANNOT update avatarId to unowned premium avatar', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarId: 'epic-dragon',
    }));
  });

  it('child CANNOT update displayName directly', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      displayName: 'Hacked',
    }));
  });

  it('child CANNOT update avatarConfig + displayName together', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: validAvatarConfig,
      displayName: 'Hacked',
    }));
  });

  it('child CANNOT update avatarId + rewardPoints together', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarId: 'starter-robot',
      rewardPoints: 999999,
    }));
  });

  it('child CANNOT update avatarConfig + lifetimeXP together', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: validAvatarConfig,
      lifetimeXP: 999999,
    }));
  });

  it('child CANNOT update avatarConfig + familyId together', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: validAvatarConfig,
      familyId: 'other-family',
    }));
  });

  it('child CANNOT update avatarConfig + role together', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: validAvatarConfig,
      role: 'owner',
    }));
  });

  it('child CANNOT update avatarConfig + authUid together', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: validAvatarConfig,
      authUid: 'attacker',
    }));
  });

  it('child CANNOT update avatarConfig + avatarUrl together', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: validAvatarConfig,
      avatarUrl: 'https://evil.example/avatar.png',
    }));
  });

  it('child CANNOT update another child\'s avatarConfig', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', siblingId), {
      avatarConfig: validAvatarConfig,
    }));
  });

  it('child CANNOT update another child\'s avatarId', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', siblingId), {
      avatarId: 'starter-robot',
    }));
  });

  it('managed child with wrong authUid CANNOT update', async () => {
    const db = managedChildWrongAuthDb();
    await assertFails(updateDoc(doc(db, 'users', managedChildId), {
      avatarConfig: validAvatarConfig,
    }));
  });

  it('managed child with wrong family claim CANNOT update', async () => {
    const db = managedChildWrongFamilyDb();
    await assertFails(updateDoc(doc(db, 'users', managedChildId), {
      avatarConfig: validAvatarConfig,
    }));
  });

  it('managed child with requiresPasswordChange CANNOT update', async () => {
    // First set requiresPasswordChange to true
    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      const db = context.firestore();
      await updateDoc(doc(db, 'users', managedChildId), { requiresPasswordChange: true });
    });
    const db = managedChildPasswordChangeDb();
    await assertFails(updateDoc(doc(db, 'users', managedChildId), {
      avatarConfig: validAvatarConfig,
    }));
  });
});

describe('CHILD APPEARANCE — malformed AvatarConfig (DENY)', () => {
  it('rejects version 2', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: { ...validAvatarConfig, version: 2 },
    }));
  });

  it('rejects unknown hairStyle value', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: { ...validAvatarConfig, hairStyle: 'arbitrary-value' },
    }));
  });

  it('rejects injected CSS/URL field', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: { ...validAvatarConfig, injectedCss: 'url(https://evil.example)' },
    }));
  });

  it('rejects incomplete config (missing required keys)', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: { version: 1, base: 'round' },
    }));
  });

  it('rejects extra unknown key', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: { ...validAvatarConfig, unknownKey: 'value' },
    }));
  });

  it('rejects invalid base value', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: { ...validAvatarConfig, base: 'invalid' },
    }));
  });

  it('rejects invalid skinTone value', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: { ...validAvatarConfig, skinTone: 'invalid' },
    }));
  });

  it('rejects invalid hairColor value', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: { ...validAvatarConfig, hairColor: 'invalid' },
    }));
  });

  it('rejects invalid face value', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: { ...validAvatarConfig, face: 'invalid' },
    }));
  });

  it('rejects invalid accessory value', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: { ...validAvatarConfig, accessory: 'invalid' },
    }));
  });

  it('rejects invalid outfit value', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: { ...validAvatarConfig, outfit: 'invalid' },
    }));
  });

  it('rejects invalid outfitColor value', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: { ...validAvatarConfig, outfitColor: 'invalid' },
    }));
  });

  it('rejects invalid background value', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: { ...validAvatarConfig, background: 'invalid' },
    }));
  });
});

describe('CHILD APPEARANCE — parent/owner approval path is identity-only', () => {
  it('parent CANNOT write avatarId/avatarUrl/avatarConfig on child profile — only displayName allowed', async () => {
    const db = childDb();
    await setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), {
      id: 'req1', familyId, childId, childName: 'Alin',
      requestedDisplayName: 'Alin Updated', requestedAvatarId: 'rare-neon',
      requestedAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=rare-neon',
      currentDisplayName: 'Alin', currentAvatarId: 'starter-cat', currentAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alin',
      status: 'pending', createdAt: serverTimestamp(), actorId: childId,
    });
    const pdb = parentDb();
    await assertFails(updateDoc(doc(pdb, 'users', childId), {
      displayName: 'Alin Updated',
      avatarId: 'rare-neon',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=rare-neon',
    }));
  });

  it('parent CAN approve displayName-only update on child profile', async () => {
    const db = childDb();
    await setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), {
      id: 'req1', familyId, childId, childName: 'Alin',
      requestedDisplayName: 'Alin Updated', requestedAvatarId: 'rare-neon',
      requestedAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=rare-neon',
      currentDisplayName: 'Alin', currentAvatarId: 'starter-cat', currentAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alin',
      status: 'pending', createdAt: serverTimestamp(), actorId: childId,
    });
    const pdb = parentDb();
    await assertSucceeds(updateDoc(doc(pdb, 'users', childId), {
      displayName: 'Alin Updated',
    }));
  });

  it('parent approval applies ONLY displayName — legacy avatarConfig is ignored', async () => {
    const db = childDb();
    // Child first updates their appearance directly (self-service)
    await assertSucceeds(updateDoc(doc(db, 'users', childId), {
      avatarConfig: validAvatarConfig,
      avatarId: 'starter-robot',
    }));
    // Verify the self-service update took effect
    const childDocAfterSelfService = await getDoc(doc(db, 'users', childId));
    expect(childDocAfterSelfService.data().avatarConfig).toEqual(validAvatarConfig);
    expect(childDocAfterSelfService.data().avatarId).toBe('starter-robot');

    // Now create a LEGACY pending request that contains avatarConfig (avatar A)
    // Use withSecurityRulesDisabled to simulate a pre-existing legacy request
    // that was created before the identity-only rules change.
    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, `families/${familyId}/profile_update_requests`, 'req1'), {
        id: 'req1', familyId, childId, childName: 'Alin',
        requestedDisplayName: 'Alin Updated',
        requestedAvatarId: 'starter-cat', // legacy avatar A
        requestedAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=starter-cat',
        requestedAvatarConfig: { ...validAvatarConfig, hairStyle: 'short' }, // legacy avatarConfig A (different from B)
        currentDisplayName: 'Alin', currentAvatarId: 'starter-cat', currentAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alin',
        status: 'pending', createdAt: serverTimestamp(), actorId: childId,
      });
    });

    // Parent approves the legacy request
    const pdb = parentDb();
    await assertSucceeds(updateDoc(doc(pdb, 'users', childId), {
      displayName: 'Alin Updated',
      // Note: parent should NOT be able to write avatarConfig/avatarId/avatarUrl
      // The rules now only allow displayName for parent approval on child profile
    }));

    // Final profile should have the child's self-service appearance (avatar B)
    // and the approved displayName
    const finalDoc = await getDoc(doc(pdb, 'users', childId));
    expect(finalDoc.data().displayName).toBe('Alin Updated');
    expect(finalDoc.data().avatarConfig).toEqual(validAvatarConfig); // child's self-service avatarConfig (B)
    expect(finalDoc.data().avatarId).toBe('starter-robot'); // child's self-service avatarId (B)
  });

  it('parent approval applies ONLY displayName — legacy avatarId is ignored', async () => {
    const db = childDb();
    // Child first updates their appearance directly (self-service)
    await assertSucceeds(updateDoc(doc(db, 'users', childId), {
      avatarConfig: validAvatarConfig,
      avatarId: 'starter-robot',
    }));

    // Legacy pending request with avatarId (avatar A)
    await setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req2'), {
      id: 'req2', familyId, childId, childName: 'Alin',
      requestedDisplayName: 'Alin Updated',
      requestedAvatarId: 'starter-cat', // legacy avatar A
      requestedAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=starter-cat',
      currentDisplayName: 'Alin', currentAvatarId: 'starter-cat', currentAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alin',
      status: 'pending', createdAt: serverTimestamp(), actorId: childId,
    });

    const pdb = parentDb();
    await assertSucceeds(updateDoc(doc(pdb, 'users', childId), {
      displayName: 'Alin Updated',
    }));

    const finalDoc = await getDoc(doc(pdb, 'users', childId));
    expect(finalDoc.data().displayName).toBe('Alin Updated');
    expect(finalDoc.data().avatarId).toBe('starter-robot'); // child's self-service avatarId (B) preserved
  });
});

describe('CHILD APPEARANCE — avatarUrl is NOT in child self-write allowlist', () => {
  it('child CANNOT write avatarUrl directly', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarUrl: 'https://evil.example/avatar.png',
    }));
  });

  it('child CANNOT write avatarUrl with avatarId', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarId: 'starter-robot',
      avatarUrl: 'https://evil.example/avatar.png',
    }));
  });

  it('child CANNOT write avatarUrl with avatarConfig', async () => {
    const db = childDb();
    await assertFails(updateDoc(doc(db, 'users', childId), {
      avatarConfig: validAvatarConfig,
      avatarUrl: 'https://evil.example/avatar.png',
    }));
  });
});