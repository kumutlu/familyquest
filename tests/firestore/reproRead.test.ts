import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, serverTimestamp, collection, getDocs, query, orderBy, where } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

let testEnv: any;
const projectId = 'familyquest-repro-read';
const familyId = 'test-fam';
const parentId = 'parent1';
const childId = 'child1';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx: any) => {
    const db = ctx.firestore();
    // Rules only grant access to an existing, active family document.
    await setDoc(doc(db, 'families', familyId), { name: 'Family', currencyCode: 'GBP' });
    await setDoc(doc(db, 'users', parentId), { familyId, role: 'parent', displayName: 'Parent' });
    await setDoc(doc(db, 'users', childId), { familyId, role: 'child', displayName: 'Child', avatarId: null });
    await setDoc(doc(db, `families/${familyId}/profile_update_requests`, 'req1'), {
      id: 'req1', familyId, childId, childName: 'Child',
      requestedDisplayName: 'Child', requestedAvatarId: null, requestedAvatar: '',
      currentDisplayName: 'Child', currentAvatarId: null, currentAvatar: '',
      status: 'pending', createdAt: serverTimestamp(), actorId: childId,
    });
  });
});

afterAll(async () => { await testEnv.cleanup(); });

describe('profile_update_requests read rule', () => {
  it('parent can LIST (read) profile_update_requests', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    const snap = await getDocs(query(collection(db, `families/${familyId}/profile_update_requests`), orderBy('createdAt', 'desc')));
    console.log('PARENT LIST SIZE:', snap.size);
  });
  it('child can LIST their own', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    // Production query (src/lib/bootstrapQueries.ts) filters by childId before
    // ordering, which is required for the per-document read rule to be enforceable.
    const snap = await getDocs(query(collection(db, `families/${familyId}/profile_update_requests`), where('childId', '==', childId), orderBy('createdAt', 'desc')));
    console.log('CHILD LIST SIZE:', snap.size);
  });
});
