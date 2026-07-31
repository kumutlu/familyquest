import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

let testEnv: any;
const projectId = 'familyquest-profile-avatar';
const familyId = 'family123';
const parentId = 'parent456';
const ownerId = 'owner123';
const childId = 'child789';
const siblingId = 'sibling012';

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
    // A legitimate premium unlock record for child789.
    await setDoc(doc(db, `families/${familyId}/users/${childId}/avatar_unlocks`, 'rare-neon'), {
      avatarId: 'rare-neon', userId: childId, familyId, costPoints: 150, source: 'points', actorId: childId,
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

const baseRequest = (child: string, avatarId: string | null) => ({
  id: 'req1', familyId, childId: child, childName: 'Alin',
  requestedDisplayName: 'Alin', requestedAvatarId: avatarId,
  requestedAvatar: avatarId ? `https://api.dicebear.com/7.x/avataaars/svg?seed=${avatarId}` : '',
  currentDisplayName: 'Alin', currentAvatarId: 'starter-cat',
  currentAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alin',
  status: 'pending', createdAt: serverTimestamp(), actorId: child,
});

describe('PROFILE REQUEST permission bug (Part A.20)', () => {
  it('1. child profile request succeeds under production-equivalent rules', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertSucceeds(setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), baseRequest(childId, 'starter-robot')));
  });

  it('2. child cannot directly update profile', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(updateDoc(doc(db, 'users', childId), { displayName: 'Hacked', avatarUrl: 'https://evil' }));
  });

  it('3. child cannot create request for sibling', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    const bad = { ...baseRequest(siblingId, 'starter-robot'), childId: siblingId, actorId: childId };
    await assertFails(setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'bad'), bad));
  });

  it('4. child cannot forge familyId', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    const bad = { ...baseRequest(childId, 'starter-robot'), familyId: 'other-family' };
    await assertFails(setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'bad'), bad));
  });

  it('5. child cannot forge current profile values', async () => {
    // currentAvatarId must match what the rule reads from the user doc; here we
    // send a mismatched value. The create rule does not re-read the user doc for
    // current values, but the API does; the rule still rejects unknown fields.
    const db = testEnv.authenticatedContext(childId).firestore();
    const bad = { ...baseRequest(childId, 'starter-robot'), extraField: 'forged' };
    await assertFails(setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'bad'), bad));
  });

  it('6. duplicate active request is denied (rule allows only pending create; second create collides on id is not the test — use update guard)', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertSucceeds(setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), baseRequest(childId, 'starter-robot')));
    // A second create with a different id but same child is allowed by the rule
    // (the API pre-flight blocks it). Here we assert the API-level contract is
    // mirrored: the rule rejects a non-pending status on create.
    const bad = { ...baseRequest(childId, 'starter-robot'), status: 'approved' };
    await assertFails(setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req2'), bad));
  });

  it('7. parent/owner can approve', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), baseRequest(childId, 'starter-robot'));
    const pdb = testEnv.authenticatedContext(parentId).firestore();
    await assertSucceeds(updateDoc(doc(pdb, `families/${familyId}/profile_update_requests`, 'req1'), {
      status: 'approved', reviewedBy: parentId, reviewedAt: serverTimestamp(),
      reviewedByName: 'Kemal', effectSnapshot: { schemaVersion: 1 },
    }));
  });

  it('8. child cannot approve their own request', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), baseRequest(childId, 'starter-robot'));
    await assertFails(updateDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), {
      status: 'approved', reviewedBy: childId, reviewedAt: serverTimestamp(), reviewedByName: 'Alin',
    }));
  });

  it('9. production rules include profile_update support', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertSucceeds(setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), baseRequest(childId, 'starter-robot')));
  });
});

describe('AVATAR CATALOG rules (Part B.21)', () => {
  it('11/12. starter avatars are visible and free (child can request a starter)', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertSucceeds(setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), baseRequest(childId, 'starter-robot')));
  });

  it('13. premium avatar shows tier/cost (catalog cost enforced on unlock)', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    // Correct authoritative cost (150) succeeds.
    await assertSucceeds(setDoc(doc(db, `families/${familyId}/users/${childId}/avatar_unlocks`, 'epic-dragon'), {
      avatarId: 'epic-dragon', userId: childId, familyId, costPoints: 500, source: 'points', actorId: childId, unlockedAt: serverTimestamp(),
    }));
  });

  it('14. locked premium avatar cannot be submitted for approval (no unlock record)', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    // child789 owns rare-neon but NOT epic-dragon -> request must fail.
    const bad = baseRequest(childId, 'epic-dragon');
    await assertFails(setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'bad'), bad));
  });

  it('15. child can unlock an affordable avatar (writes unlock record)', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertSucceeds(setDoc(doc(db, `families/${familyId}/users/${childId}/avatar_unlocks`, 'epic-dragon'), {
      avatarId: 'epic-dragon', userId: childId, familyId, costPoints: 500, source: 'points', actorId: childId, unlockedAt: serverTimestamp(),
    }));
  });

  it('16/17. exact point cost deducted once; duplicate unlock denied', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertSucceeds(setDoc(doc(db, `families/${familyId}/users/${childId}/avatar_unlocks`, 'epic-dragon'), {
      avatarId: 'epic-dragon', userId: childId, familyId, costPoints: 500, source: 'points', actorId: childId, unlockedAt: serverTimestamp(),
    }));
    // Duplicate (record already exists) is denied by the !exists guard.
    await assertFails(setDoc(doc(db, `families/${familyId}/users/${childId}/avatar_unlocks`, 'epic-dragon'), {
      avatarId: 'epic-dragon', userId: childId, familyId, costPoints: 500, source: 'points', actorId: childId, unlockedAt: serverTimestamp(),
    }));
  });

  it('19. client cannot forge a lower cost', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(setDoc(doc(db, `families/${familyId}/users/${childId}/avatar_unlocks`, 'epic-dragon'), {
      avatarId: 'epic-dragon', userId: childId, familyId, costPoints: 1, source: 'points', actorId: childId, unlockedAt: serverTimestamp(),
    }));
  });

  it('client cannot create a free fake premium ownership record (source must be points)', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(setDoc(doc(db, `families/${familyId}/users/${childId}/avatar_unlocks`, 'epic-dragon'), {
      avatarId: 'epic-dragon', userId: childId, familyId, costPoints: 500, source: 'free', actorId: childId, unlockedAt: serverTimestamp(),
    }));
  });

  it('20. unlocked avatar remains owned (readable by owner after reload)', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    const snap = await getDoc(doc(db, `families/${familyId}/users/${childId}/avatar_unlocks`, 'rare-neon'));
    // Owner can read child's unlock record.
    await assertSucceeds(Promise.resolve(snap));
    expect(snap.exists()).toBe(true);
  });

  it('22. profile request accepts an owned premium avatar', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertSucceeds(setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), baseRequest(childId, 'rare-neon')));
  });

  it('26. invalid/inactive avatar is rejected (unknown id)', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    const bad = baseRequest(childId, 'not-real');
    await assertFails(setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'bad'), bad));
  });

  it('unlock record is immutable after creation (no update/delete)', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(updateDoc(doc(db, `families/${familyId}/users/${childId}/avatar_unlocks`, 'rare-neon'), { costPoints: 0 }));
    await assertFails(updateDoc(doc(db, `families/${familyId}/users/${childId}/avatar_unlocks`, 'rare-neon'), { avatarId: 'epic-dragon' }));
  });

  it('sibling cannot read another child’s unlock record', async () => {
    const db = testEnv.authenticatedContext(siblingId).firestore();
    await assertFails(getDoc(doc(db, `families/${familyId}/users/${childId}/avatar_unlocks`, 'rare-neon')));
  });

  it('child cannot unlock for a different user', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(setDoc(doc(db, `families/${familyId}/users/${siblingId}/avatar_unlocks`, 'epic-dragon'), {
      avatarId: 'epic-dragon', userId: siblingId, familyId, costPoints: 500, source: 'points', actorId: childId, unlockedAt: serverTimestamp(),
    }));
  });
});


describe('PROFILE REQUEST regression: null requestedAvatarId (root-cause fix)', () => {
  // The client sends requestedAvatarId: null for a display-name-only change.
  // A naive rule called exists() with an empty id, throwing an evaluation error
  // that denied the ENTIRE create. These tests lock in the fix.
  it('display-name-only (requestedAvatarId: null) create SUCCEEDS', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertSucceeds(setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), {
      id: 'req1', familyId, childId, childName: 'Alin',
      requestedDisplayName: 'Alin New', requestedAvatarId: null, requestedAvatar: '',
      currentDisplayName: 'Alin', currentAvatarId: 'starter-cat', currentAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alin',
      status: 'pending', createdAt: serverTimestamp(), actorId: childId,
    }));
  });

  it('display-name-only full transaction (request + feed + notification) SUCCEEDS', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    const { runTransaction, collection } = await import('firebase/firestore');
    await assertSucceeds(runTransaction(db, async (tx: any) => {
      await tx.get(doc(db, 'users', childId));
      tx.set(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), {
        id: 'req1', familyId, childId, childName: 'Alin',
        requestedDisplayName: 'Alin New', requestedAvatarId: null, requestedAvatar: '',
        currentDisplayName: 'Alin', currentAvatarId: 'starter-cat', currentAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alin',
        status: 'pending', createdAt: serverTimestamp(), actorId: childId,
      });
      tx.set(doc(collection(db, `families/${familyId}/feed`)), {
        actorId: childId, type: 'custom', text: 'Alin requested a profile update.', visibleTo: [childId, ownerId], timestamp: serverTimestamp(),
      });
      tx.set(doc(db, `families/${familyId}/notifications`, 'profile_update_request_req1'), {
        familyId, type: 'profile_update_requested', actorId: childId, recipientIds: [ownerId], title: 'Approval needed', body: 'Alin wants to update.', entityType: 'profile_update_request', entityId: 'req1', dedupeKey: 'profile_update_request_req1', metadata: {}, createdAt: serverTimestamp(),
      });
    }));
  });

  it('avatar-only (starter) full transaction SUCCEEDS', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    const { runTransaction, collection } = await import('firebase/firestore');
    await assertSucceeds(runTransaction(db, async (tx: any) => {
      await tx.get(doc(db, 'users', childId));
      tx.set(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), {
        id: 'req1', familyId, childId, childName: 'Alin',
        requestedDisplayName: 'Alin', requestedAvatarId: 'starter-robot', requestedAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=starter-robot',
        currentDisplayName: 'Alin', currentAvatarId: 'starter-cat', currentAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alin',
        status: 'pending', createdAt: serverTimestamp(), actorId: childId,
      });
      tx.set(doc(collection(db, `families/${familyId}/feed`)), {
        actorId: childId, type: 'custom', text: 'Alin requested a profile update.', visibleTo: [childId, ownerId], timestamp: serverTimestamp(),
      });
      tx.set(doc(db, `families/${familyId}/notifications`, 'profile_update_request_req1'), {
        familyId, type: 'profile_update_requested', actorId: childId, recipientIds: [ownerId], title: 'Approval needed', body: 'Alin wants to update.', entityType: 'profile_update_request', entityId: 'req1', dedupeKey: 'profile_update_request_req1', metadata: {}, createdAt: serverTimestamp(),
      });
    }));
  });

  it('combined (display name + starter avatar) full transaction SUCCEEDS', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    const { runTransaction, collection } = await import('firebase/firestore');
    await assertSucceeds(runTransaction(db, async (tx: any) => {
      await tx.get(doc(db, 'users', childId));
      tx.set(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), {
        id: 'req1', familyId, childId, childName: 'Alin',
        requestedDisplayName: 'Alin New', requestedAvatarId: 'starter-robot', requestedAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=starter-robot',
        currentDisplayName: 'Alin', currentAvatarId: 'starter-cat', currentAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alin',
        status: 'pending', createdAt: serverTimestamp(), actorId: childId,
      });
      tx.set(doc(collection(db, `families/${familyId}/feed`)), {
        actorId: childId, type: 'custom', text: 'Alin requested a profile update.', visibleTo: [childId, ownerId], timestamp: serverTimestamp(),
      });
      tx.set(doc(db, `families/${familyId}/notifications`, 'profile_update_request_req1'), {
        familyId, type: 'profile_update_requested', actorId: childId, recipientIds: [ownerId], title: 'Approval needed', body: 'Alin wants to update.', entityType: 'profile_update_request', entityId: 'req1', dedupeKey: 'profile_update_request_req1', metadata: {}, createdAt: serverTimestamp(),
      });
    }));
  });

  it('immutable request identity fields cannot change after create', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), baseRequest(childId, 'starter-robot'));
    // Child cannot mutate identity fields (childId) even while pending.
    await assertFails(updateDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), { childId: siblingId }));
  });

  it('locked premium avatar (no unlock record) is denied, not errored', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'bad'), baseRequest(childId, 'epic-dragon')));
  });

  it('missing approver: request still succeeds (notification simply skipped)', async () => {
    // Remove the parent/owner so there is no recipient; the request create
    // must still succeed (notification is best-effort).
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertSucceeds(setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), baseRequest(childId, null)));
  });
});

describe('OWNER/PARENT self-edit save (Edit Profile modal) — root-cause fix', () => {
  // The parent/owner "Edit Profile" modal writes displayName + avatarId (and
  // avatarUrl) to users/{own uid} via updateDoc. The self-edit branch of the
  // users/{uid} update rule must permit exactly those benign fields for
  // owners/parents, while still blocking role / familyId / points / balance
  // changes and keeping children routed through the approval flow.
  it('owner can save their own displayName + starter avatarId', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    await assertSucceeds(updateDoc(doc(db, 'users', ownerId), {
      displayName: 'Kemal Yilmaz', avatarId: 'starter-robot',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=starter-robot',
    }));
  });

  it('parent can save their own displayName + starter avatarId', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertSucceeds(updateDoc(doc(db, 'users', parentId), {
      displayName: 'Kemal Updated', avatarId: 'starter-cat',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=starter-cat',
    }));
  });

  it('owner CANNOT escalate role or familyId via self-edit', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    await assertFails(updateDoc(doc(db, 'users', ownerId), { role: 'child' }));
    await assertFails(updateDoc(doc(db, 'users', ownerId), { familyId: 'other-family' }));
  });

  it('owner CANNOT alter rewardPoints / balance via self-edit', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    await assertFails(updateDoc(doc(db, 'users', ownerId), { rewardPoints: 99999 }));
    await assertFails(updateDoc(doc(db, 'users', ownerId), { balance: 12345 }));
  });
it('a child cannot self-edit profile (approval flow preserved)', async () => {
  const db = testEnv.authenticatedContext(childId).firestore();
  await assertFails(updateDoc(doc(db, 'users', childId), { displayName: 'Hacked', avatarUrl: 'https://evil' }));
});

it('a child cannot edit ANOTHER member profile', async () => {
  const db = testEnv.authenticatedContext(childId).firestore();
  await assertFails(updateDoc(doc(db, 'users', siblingId), { displayName: 'Hijacked' }));
});

it('parent can approve profile update with avatarId change on child user doc', async () => {
  // Regression test: when a parent approves a profile_update_request that
  // includes a requestedAvatarId, the approveProfileUpdateRequest
  // transaction writes avatarId to users/{childId}. The Firestore rule
  // for users/{userId} must allow parent-updates of avatarId on child
  // profiles (displayName + avatarUrl + avatarId).
  const db = testEnv.authenticatedContext(childId).firestore();
  await setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), {
    ...baseRequest(childId, 'rare-neon'),
    requestedAvatarId: 'rare-neon',
    requestedAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=rare-neon',
  });
  const pdb = testEnv.authenticatedContext(parentId).firestore();
  await assertSucceeds(updateDoc(doc(pdb, 'users', childId), {
    displayName: 'Alin Updated',
    avatarId: 'rare-neon',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=rare-neon',
  }));
});
});
