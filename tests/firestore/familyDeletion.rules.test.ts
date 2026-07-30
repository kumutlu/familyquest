import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const FAMILY_ID = 'deletion-family';
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-family-deletion-rules',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, `families/${FAMILY_ID}`), {
      name: 'Deletion family',
      inviteCode: 'DEL123',
      currencyCode: 'GBP',
      timezone: 'Europe/London',
      weekStartsOn: 1,
    });
    await setDoc(doc(db, 'users/owner'), { familyId: FAMILY_ID, role: 'owner' });
    await setDoc(doc(db, 'users/parent'), { familyId: FAMILY_ID, role: 'parent' });
    await setDoc(doc(db, 'users/child'), { familyId: FAMILY_ID, role: 'child' });
    await setDoc(doc(db, `families/${FAMILY_ID}/tasks/task-1`), { title: 'Task', familyId: FAMILY_ID });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

const dbFor = (uid: string) => testEnv.authenticatedContext(uid).firestore();

async function markDeleting() {
  await testEnv.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), `families/${FAMILY_ID}`), {
      lifecycleState: 'deleting',
      deletionJobId: FAMILY_ID,
      deletionRequestedBy: 'owner',
    });
  });
}

describe('family lifecycle freeze', () => {
  it('active legacy families with no lifecycleState retain existing access', async () => {
    await expect(assertSucceeds(getDoc(doc(dbFor('owner'), `families/${FAMILY_ID}`)))).resolves.toBeDefined();
    await expect(assertSucceeds(getDoc(doc(dbFor('child'), `families/${FAMILY_ID}/tasks/task-1`)))).resolves.toBeDefined();
  });

  it('denies family document reads for every role while deleting', async () => {
    await markDeleting();
    for (const uid of ['owner', 'parent', 'child']) {
      await expect(assertFails(getDoc(doc(dbFor(uid), `families/${FAMILY_ID}`)))).resolves.toBeDefined();
    }
  });

  it('denies subcollection reads and writes while deleting', async () => {
    await markDeleting();
    await expect(assertFails(getDoc(doc(dbFor('owner'), `families/${FAMILY_ID}/tasks/task-1`)))).resolves.toBeDefined();
    await expect(assertFails(getDocs(collection(dbFor('parent'), `families/${FAMILY_ID}/tasks`)))).resolves.toBeDefined();
    await expect(assertFails(setDoc(doc(dbFor('parent'), `families/${FAMILY_ID}/tasks/task-2`), {
      title: 'New task', familyId: FAMILY_ID,
    }))).resolves.toBeDefined();
    await expect(assertFails(setDoc(doc(dbFor('child'), `families/${FAMILY_ID}/task_completions/tc-1`), {
      taskId: 'task-1', assigneeId: 'child', status: 'pending_approval',
    }))).resolves.toBeDefined();
  });

  it('denies ordinary family settings updates while deleting', async () => {
    await markDeleting();
    await expect(assertFails(updateDoc(doc(dbFor('owner'), `families/${FAMILY_ID}`), {
      name: 'Renamed while deleting',
    }))).resolves.toBeDefined();
  });

  it('clients cannot set family lifecycle or deletion fields', async () => {
    for (const payload of [
      { lifecycleState: 'deleting' },
      { deletionJobId: FAMILY_ID },
      { deletionRequestedBy: 'owner' },
      { deletionRequestedAt: new Date() },
    ]) {
      await expect(assertFails(updateDoc(doc(dbFor('owner'), `families/${FAMILY_ID}`), payload))).resolves.toBeDefined();
    }
  });

  it('clients cannot unfreeze a deleting family', async () => {
    await markDeleting();
    await expect(assertFails(updateDoc(doc(dbFor('owner'), `families/${FAMILY_ID}`), {
      lifecycleState: 'active',
    }))).resolves.toBeDefined();
  });
});

describe('server-only deletion collections', () => {
  it.each([
    `familyDeletionJobs/${FAMILY_ID}`,
    `familyDeletionReceipts/${FAMILY_ID}`,
    'accountDeletionJobs/owner',
  ])('denies client reads and writes to %s', async path => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), path), { state: 'queued', familyId: FAMILY_ID });
    });
    await expect(assertFails(getDoc(doc(dbFor('owner'), path)))).resolves.toBeDefined();
    await expect(assertFails(updateDoc(doc(dbFor('owner'), path), { state: 'completed' }))).resolves.toBeDefined();
    await expect(assertFails(setDoc(doc(dbFor('owner'), `${path}-forged`), { state: 'queued' }))).resolves.toBeDefined();
  });
});
