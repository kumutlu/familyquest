import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

let testEnv: any;
const projectId = 'familyquest-repro-null';
const familyId = 'family123';
const parentId = 'parent456';
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
    await setDoc(doc(db, 'users', parentId), { familyId, role: 'parent', displayName: 'Kemal' });
    await setDoc(doc(db, 'users', childId), {
      familyId, role: 'child', displayName: 'Alin', avatarUrl: 'https://x', avatarId: 'starter-cat',
    });
  });
});
afterAll(async () => { await testEnv.cleanup(); });

const base = (over: any) => ({
  id: 'req1', familyId, childId, childName: 'Alin',
  requestedDisplayName: 'Alin New', requestedAvatarId: null, requestedAvatar: '',
  currentDisplayName: 'Alin', currentAvatarId: 'starter-cat', currentAvatar: 'https://x',
  status: 'pending', createdAt: serverTimestamp(), actorId: childId, ...over,
});

describe('NULL avatarId handling (post-fix)', () => {
  it('explicit null requestedAvatarId -> SUCCEEDS (was evaluation error before fix)', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertSucceeds(setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), base({})));
  });
  it('omitted requestedAvatarId (absent key) -> succeeds', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    const { requestedAvatarId, ...rest } = base({});
    await assertSucceeds(setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), rest));
  });
  it('empty-string requestedAvatarId -> succeeds', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertSucceeds(setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), base({ requestedAvatarId: '' })));
  });
  it('locked premium avatar (no unlock record) -> still FAILS (legit denial, not error)', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'bad'), base({ requestedAvatarId: 'epic-dragon' })));
  });
});
