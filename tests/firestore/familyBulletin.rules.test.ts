import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let env: any;
const familyId = 'bulletin-family';
const base = {
  familyId,
  title: 'Movie night',
  message: 'Friday at 7pm',
  type: 'event',
  audienceType: 'family',
  audienceUserIds: [],
  priority: 'normal',
  pinned: false,
  status: 'active',
  createdBy: 'owner1',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
};

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'familyquest-bulletin-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context: any) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users', 'owner1'), { familyId, role: 'owner', displayName: 'Owner' });
    await setDoc(doc(db, 'users', 'parent1'), { familyId, role: 'parent', displayName: 'Parent' });
    await setDoc(doc(db, 'users', 'child1'), { familyId, role: 'child', displayName: 'Child 1' });
    await setDoc(doc(db, 'users', 'child2'), { familyId, role: 'child', displayName: 'Child 2' });
    await setDoc(doc(db, 'users', 'outsider'), { familyId: 'other', role: 'parent' });
    await setDoc(doc(db, `families/${familyId}`), { name: 'Family' });
    await setDoc(doc(db, `families/${familyId}/tasks/task1`), { title: 'Task' });
  });
});
afterAll(async () => env.cleanup());

describe('Family Bulletin rules', () => {
  it('owner and parent can create valid announcements', async () => {
    await assertSucceeds(setDoc(doc(env.authenticatedContext('owner1').firestore(), `families/${familyId}/announcements/a1`), base));
    await assertSucceeds(setDoc(doc(env.authenticatedContext('parent1').firestore(), `families/${familyId}/announcements/a2`), { ...base, createdBy: 'parent1' }));
  });

  it('child cannot create, edit, or delete', async () => {
    const ownerDb = env.authenticatedContext('owner1').firestore();
    await setDoc(doc(ownerDb, `families/${familyId}/announcements/a1`), base);
    const childDb = env.authenticatedContext('child1').firestore();
    await assertFails(setDoc(doc(childDb, `families/${familyId}/announcements/a2`), { ...base, createdBy: 'child1' }));
    await assertFails(updateDoc(doc(childDb, `families/${familyId}/announcements/a1`), { message: 'forged', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(childDb, `families/${familyId}/announcements/a1`)));
  });

  it('family and child-specific visibility is enforced', async () => {
    const ownerDb = env.authenticatedContext('owner1').firestore();
    await setDoc(doc(ownerDb, `families/${familyId}/announcements/family`), base);
    await setDoc(doc(ownerDb, `families/${familyId}/announcements/selected`), { ...base, audienceType: 'selected', audienceUserIds: ['child1'] });
    const child1 = env.authenticatedContext('child1').firestore();
    const child2 = env.authenticatedContext('child2').firestore();
    await assertSucceeds(getDoc(doc(child1, `families/${familyId}/announcements/family`)));
    await assertSucceeds(getDoc(doc(child1, `families/${familyId}/announcements/selected`)));
    await assertFails(getDoc(doc(child2, `families/${familyId}/announcements/selected`)));
  });

  it('parent-only visibility and cross-family isolation are enforced', async () => {
    const ownerDb = env.authenticatedContext('owner1').firestore();
    await setDoc(doc(ownerDb, `families/${familyId}/announcements/adults`), { ...base, audienceType: 'adults' });
    await assertSucceeds(getDoc(doc(env.authenticatedContext('parent1').firestore(), `families/${familyId}/announcements/adults`)));
    await assertFails(getDoc(doc(env.authenticatedContext('child1').firestore(), `families/${familyId}/announcements/adults`)));
    await assertFails(getDoc(doc(env.authenticatedContext('outsider').firestore(), `families/${familyId}/announcements/adults`)));
  });

  it('child can mark only an addressed announcement as read for self', async () => {
    await setDoc(doc(env.authenticatedContext('owner1').firestore(), `families/${familyId}/announcements/a1`), base);
    const childDb = env.authenticatedContext('child1').firestore();
    await assertSucceeds(setDoc(doc(childDb, `families/${familyId}/announcement_reads/a1_child1`), {
      familyId, announcementId: 'a1', userId: 'child1', readAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(childDb, `families/${familyId}/announcement_reads/a1_child2`), {
      familyId, announcementId: 'a1', userId: 'child2', readAt: serverTimestamp(),
    }));
  });

  it('rejects missing cross-resource links and accepts same-family task links', async () => {
    const db = env.authenticatedContext('owner1').firestore();
    await assertSucceeds(setDoc(doc(db, `families/${familyId}/announcements/linked`), { ...base, linkedTaskId: 'task1' }));
    await assertFails(setDoc(doc(db, `families/${familyId}/announcements/missing`), { ...base, linkedTaskId: 'missing' }));
  });
});
