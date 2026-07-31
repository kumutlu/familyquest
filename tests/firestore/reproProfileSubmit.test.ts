import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, serverTimestamp, runTransaction, collection } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

let testEnv: any;
const projectId = 'familyquest-repro';
const familyId = 'family123';
const parentId = 'parent456';
const ownerId = 'owner123';
const childId = 'child789';

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
  });
});
afterAll(async () => { await testEnv.cleanup(); });

const baseRequest = (child: string, avatarId: string | null) => ({
  id: 'req1', familyId, childId: child, childName: 'Alin',
  requestedDisplayName: 'Alin New', requestedAvatarId: avatarId,
  requestedAvatar: avatarId ? `https://api.dicebear.com/7.x/avataaars/svg?seed=${avatarId}` : '',
  currentDisplayName: 'Alin', currentAvatarId: 'starter-cat',
  currentAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alin',
  status: 'pending', createdAt: serverTimestamp(), actorId: child,
});

const feedDoc = (uid: string) => ({
  actorId: uid, type: 'custom',
  text: 'Alin requested a profile update. Awaiting parent approval.',
  visibleTo: [uid, ownerId], timestamp: serverTimestamp(),
});

const notifDoc = (uid: string) => ({
  familyId, type: 'profile_update_requested', actorId: uid,
  recipientIds: [ownerId], title: 'Profile update approval needed',
  body: 'Alin wants to update their profile.', entityType: 'profile_update_request',
  entityId: 'req1', dedupeKey: 'profile_update_request_req1', metadata: {},
  createdAt: serverTimestamp(),
});

describe('REPRO: full submit transaction (request + feed + notification)', () => {
  it('A. display-name-only (null avatarId): full transaction SUCCEEDS', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertSucceeds(runTransaction(db, async (tx: any) => {
      await tx.get(doc(db, 'users', childId));
      tx.set(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), baseRequest(childId, null));
      tx.set(doc(collection(db, `families/${familyId}/feed`)), feedDoc(childId));
      tx.set(doc(db, `families/${familyId}/notifications`, 'profile_update_request_req1'), notifDoc(childId));
    }));
  });

  it('B. avatar-only (starter): full transaction SUCCEEDS', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertSucceeds(runTransaction(db, async (tx: any) => {
      await tx.get(doc(db, 'users', childId));
      tx.set(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), baseRequest(childId, 'starter-robot'));
      tx.set(doc(collection(db, `families/${familyId}/feed`)), feedDoc(childId));
      tx.set(doc(db, `families/${familyId}/notifications`, 'profile_update_request_req1'), notifDoc(childId));
    }));
  });

  it('C. combined (display name + starter avatar): full transaction SUCCEEDS', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertSucceeds(runTransaction(db, async (tx: any) => {
      await tx.get(doc(db, 'users', childId));
      tx.set(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), baseRequest(childId, 'starter-robot'));
      tx.set(doc(collection(db, `families/${familyId}/feed`)), feedDoc(childId));
      tx.set(doc(db, `families/${familyId}/notifications`, 'profile_update_request_req1'), notifDoc(childId));
    }));
  });

  it('D. child cannot directly update own profile (protected fields)', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(setDoc(doc(db, 'users', childId), { displayName: 'Hacked', avatarUrl: 'https://evil' }, { merge: true }));
  });
});
