import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, collection, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';

let testEnv: any;
const projectId = 'familyquest-repro-txn';
const familyId = 'family123';
const parentId = 'parent456';
const childId = 'child789';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context: any) => {
    const db = context.firestore();
    // Rules only grant access to an existing, active family document.
    await setDoc(doc(db, 'families', familyId), { name: 'Family', currencyCode: 'GBP' });
    await setDoc(doc(db, 'users', parentId), { familyId, role: 'parent', displayName: 'Kemal' });
    await setDoc(doc(db, 'users', childId), {
      familyId, role: 'child', displayName: 'Alin', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alin',
      avatarId: 'starter-cat', rewardPoints: 500, lifetimeXP: 100,
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

async function submitAsChild(displayName: string, avatarId: string | null) {
  const db = testEnv.authenticatedContext(childId).firestore();
  await runTransaction(db, async (transaction: any) => {
    const userDoc = await transaction.get(doc(db, 'users', childId));
    const userData = userDoc.data();
    const reqRef = doc(collection(db, `families/${familyId}/profile_update_requests`));
    transaction.set(reqRef, {
      id: reqRef.id, familyId, childId, childName: userData.displayName,
      requestedDisplayName: displayName, requestedAvatarId: avatarId, requestedAvatar: avatarId ? `av-${avatarId}` : '',
      currentDisplayName: userData.displayName, currentAvatarId: userData.avatarId || null,
      currentAvatar: userData.avatarUrl || '', status: 'pending',
      createdAt: serverTimestamp(), actorId: childId,
    });
    const feedRef = doc(collection(db, `families/${familyId}/feed`));
    transaction.set(feedRef, {
      actorId: childId, type: 'custom', text: 'x',
      visibleTo: [childId, parentId], timestamp: serverTimestamp(),
    });
  });
}

describe('REPRO child profile update transaction', () => {
  it('name only', async () => {
    await expect(submitAsChild('Alin New', null)).resolves.toBeUndefined();
  });
  it('avatar only', async () => {
    await expect(submitAsChild('Alin', 'starter-cat')).resolves.toBeUndefined();
  });
  it('name + avatar', async () => {
    await expect(submitAsChild('Alin New', 'starter-cat')).resolves.toBeUndefined();
  });
});
