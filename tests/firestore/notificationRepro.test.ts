import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-notif-repro',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'families/fam1'), { name: 'Family 1', lifecycleState: 'active' });
    // Managed child: doc id 'mc1', auth uid 'mc-auth-1' (distinct from doc id)
    await setDoc(doc(db, 'users/mc1'), {
      uid: 'mc1',
      familyId: 'fam1',
      role: 'child',
      isManaged: true,
      authUid: 'mc-auth-1',
      requiresPasswordChange: false,
      displayName: 'Managed',
    });
    // Normal child: doc id == auth uid
    await setDoc(doc(db, 'users/c1'), {
      uid: 'c1',
      familyId: 'fam1',
      role: 'child',
      displayName: 'C1',
    });
    // Notification addressed to the managed child PROFILE ID (production shape)
    await setDoc(doc(db, 'families/fam1/notifications/n1'), {
      familyId: 'fam1',
      type: 'task_approved',
      actorId: 'parent1',
      recipientIds: ['mc1'],
      title: 'Task approved',
      body: 'Nice',
      createdAt: serverTimestamp(),
    });
    // Notification addressed to the managed child AUTH UID (divergence shape)
    await setDoc(doc(db, 'families/fam1/notifications/nAuth'), {
      familyId: 'fam1',
      type: 'task_approved',
      actorId: 'parent1',
      recipientIds: ['mc-auth-1'],
      title: 'Task approved',
      body: 'Nice',
      createdAt: serverTimestamp(),
    });
    // Notification addressed to the normal child
    await setDoc(doc(db, 'families/fam1/notifications/n2'), {
      familyId: 'fam1',
      type: 'task_approved',
      actorId: 'parent1',
      recipientIds: ['c1'],
      title: 'Task approved',
      body: 'Nice',
      createdAt: serverTimestamp(),
    });
  });
});

function readRecord(userId: string, notificationId: string, overrides: Record<string, any> = {}) {
  return {
    familyId: 'fam1',
    userId,
    notificationId,
    readAt: serverTimestamp(),
    ...overrides,
  };
}

function managedCtx() {
  return testEnv
    .authenticatedContext('mc-auth-1', {
      managedChild: true,
      childId: 'mc1',
      role: 'child',
      familyId: 'fam1',
    })
    .firestore();
}

describe('REPRO: managed child mark-read', () => {
  it('managed child writing with PROFILE ID (mc1) for profile-id notification -> succeeds', async () => {
    const db = managedCtx();
    await assertSucceeds(
      setDoc(doc(db, 'families/fam1/notification_reads/mc1_n1'), readRecord('mc1', 'n1')),
    );
  });

  it('managed child writing with PROFILE ID (mc1) for AUTH-UID notification -> FAILS (recipientIds mismatch)', async () => {
    const db = managedCtx();
    await assertFails(
      setDoc(doc(db, 'families/fam1/notification_reads/mc1_nAuth'), readRecord('mc1', 'nAuth')),
    );
  });

  it('managed child writing with AUTH UID (mc-auth-1) as userId -> FAILS (rule rejects auth uid)', async () => {
    const db = managedCtx();
    await assertFails(
      setDoc(doc(db, 'families/fam1/notification_reads/mc-auth-1_n1'), readRecord('mc-auth-1', 'n1')),
    );
  });

  it('normal child writing with PROFILE ID (c1) for THEIR notification -> succeeds', async () => {
    const db = testEnv.authenticatedContext('c1').firestore();
    await assertSucceeds(
      setDoc(doc(db, 'families/fam1/notification_reads/c1_n2'), readRecord('c1', 'n2')),
    );
  });
});
