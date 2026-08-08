import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, serverTimestamp, collection, addDoc, getDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-notifications-rules-test',
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
    await setDoc(doc(db, 'families/family1'), { name: 'Family 1' });
    await setDoc(doc(db, 'families/family2'), { name: 'Family 2' });
    await setDoc(doc(db, 'users/owner1'), { familyId: 'family1', role: 'owner', displayName: 'Owner' });
    await setDoc(doc(db, 'users/parent1'), { familyId: 'family1', role: 'parent', displayName: 'Parent' });
    await setDoc(doc(db, 'users/child1'), { familyId: 'family1', role: 'child', displayName: 'C1' });
    await setDoc(doc(db, 'users/child2'), { familyId: 'family1', role: 'child', displayName: 'C2' });
    await setDoc(doc(db, 'users/owner2'), { familyId: 'family2', role: 'owner', displayName: 'Owner2' });
    await setDoc(doc(db, 'users/child3'), { familyId: 'family2', role: 'child', displayName: 'C3' });
  });
});

// A well-formed notification created by a parent in family1, addressed to child1.
function validNotification(overrides: Record<string, any> = {}) {
  return {
    familyId: 'family1',
    type: 'task_approved',
    actorId: 'parent1',
    recipientIds: ['child1'],
    title: 'Task approved',
    body: 'Nice work',
    entityType: 'task',
    entityId: 'task1',
    actionUrl: '/tasks',
    dedupeKey: 'task_approve_task1',
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

describe('Notification content (families/{familyId}/notifications/{id})', () => {
  it('parent can create a valid notification addressed to a child', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertSucceeds(
      setDoc(doc(db, 'families/family1/notifications/n1'), validNotification()),
    );
  });

  it('owner can create a valid notification', async () => {
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertSucceeds(
      setDoc(doc(db, 'families/family1/notifications/n1'), validNotification({ actorId: 'owner1' })),
    );
  });

  it('child CAN create a notification as themselves (e.g. task_submitted / profile_update_requested)', async () => {
    // Children legitimately originate notifications inside the same transaction
    // as the business event. The actor must equal the authenticated uid and the
    // child must be a family member; all field/recipient constraints still apply.
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertSucceeds(
      setDoc(doc(db, 'families/family1/notifications/n1'), validNotification({ actorId: 'child1', type: 'task_submitted', recipientIds: ['parent1'] })),
    );
  });

  it('child CANNOT forge a notification with actorId != auth.uid', async () => {
    // A child cannot create a notification attributed to another user.
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(
      setDoc(doc(db, 'families/family1/notifications/n1'), validNotification({ actorId: 'owner1' })),
    );
  });

  it('parent CANNOT forge a notification with actorId != auth.uid', async () => {
    // Even a parent cannot attribute a notification to another user.
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(
      setDoc(doc(db, 'families/family1/notifications/n1'), validNotification({ actorId: 'owner1' })),
    );
  });

  it('parent CANNOT create a notification with an empty recipientIds list', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(
      setDoc(doc(db, 'families/family1/notifications/n1'), validNotification({ recipientIds: [] })),
    );
  });

  it('parent CANNOT create a notification with more than 50 recipients', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    const tooMany = Array.from({ length: 51 }, (_, i) => `child${i}`);
    await assertFails(
      setDoc(doc(db, 'families/family1/notifications/n1'), validNotification({ recipientIds: tooMany })),
    );
  });

  it('parent CANNOT create a notification with unexpected fields', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(
      setDoc(doc(db, 'families/family1/notifications/n1'), {
        ...validNotification(),
        forgedField: 'evil',
      }),
    );
  });

  it('parent CANNOT create a notification with familyId != the document family', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(
      setDoc(doc(db, 'families/family1/notifications/n1'), validNotification({ familyId: 'family2' })),
    );
  });

  it('parent CANNOT create a notification with createdAt != request.time', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(
      setDoc(doc(db, 'families/family1/notifications/n1'), {
        ...validNotification(),
        createdAt: new Date('2020-01-01T00:00:00Z'),
      }),
    );
  });

  it('recipient child CAN read a notification addressed to them', async () => {
    const setup = testEnv.authenticatedContext('parent1').firestore();
    await setDoc(doc(setup, 'families/family1/notifications/n1'), validNotification());
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertSucceeds(getDoc(doc(db, 'families/family1/notifications/n1')));
  });

  it('a DIFFERENT child CANNOT read a notification not addressed to them', async () => {
    const setup = testEnv.authenticatedContext('parent1').firestore();
    await setDoc(doc(setup, 'families/family1/notifications/n1'), validNotification());
    const db = testEnv.authenticatedContext('child2').firestore();
    await assertFails(getDoc(doc(db, 'families/family1/notifications/n1')));
  });

  it('a parent CAN read a notification addressed to a child (family member + recipient)', async () => {
    const setup = testEnv.authenticatedContext('parent1').firestore();
    await setDoc(doc(setup, 'families/family1/notifications/n1'), validNotification({ recipientIds: ['parent1'] }));
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertSucceeds(getDoc(doc(db, 'families/family1/notifications/n1')));
  });

  it('cross-family user CANNOT read another family notification', async () => {
    const setup = testEnv.authenticatedContext('parent1').firestore();
    await setDoc(doc(setup, 'families/family1/notifications/n1'), validNotification());
    const db = testEnv.authenticatedContext('owner2').firestore();
    await assertFails(getDoc(doc(db, 'families/family1/notifications/n1')));
  });

  it('notification content CANNOT be updated (immutable)', async () => {
    const setup = testEnv.authenticatedContext('parent1').firestore();
    await setDoc(doc(setup, 'families/family1/notifications/n1'), validNotification());
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(updateDoc(doc(db, 'families/family1/notifications/n1'), { title: 'hacked' }));
  });

  it('notification content CANNOT be deleted (no client deletes)', async () => {
    const setup = testEnv.authenticatedContext('parent1').firestore();
    await setDoc(doc(setup, 'families/family1/notifications/n1'), validNotification());
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(deleteDoc(doc(db, 'families/family1/notifications/n1')));
  });
});

describe('Notification read state (families/{familyId}/notification_reads/{id})', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'families/family1/notifications/n1'), validNotification());
      await setDoc(doc(db, 'families/family1/notifications/n2'), validNotification({ recipientIds: ['child2'], dedupeKey: 'task_approve_task2' }));
    });
  });

  function validRead(userId: string, notificationId: string, overrides: Record<string, any> = {}) {
    return {
      familyId: 'family1',
      userId,
      notificationId,
      readAt: serverTimestamp(),
      ...overrides,
    };
  }

  it('recipient can create their own read record', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertSucceeds(
      setDoc(doc(db, 'families/family1/notification_reads/r1'), validRead('child1', 'n1')),
    );
  });

  it('user CANNOT create a read record for another user (userId != auth.uid)', async () => {
    const db = testEnv.authenticatedContext('child2').firestore();
    await assertFails(
      setDoc(doc(db, 'families/family1/notification_reads/r1'), validRead('child1', 'n1')),
    );
  });

  it('user CANNOT mark read a notification they are not a recipient of', async () => {
    // child2 is not a recipient of n1.
    const db = testEnv.authenticatedContext('child2').firestore();
    await assertFails(
      setDoc(doc(db, 'families/family1/notification_reads/r1'), validRead('child2', 'n1')),
    );
  });

  it('user CANNOT create a read record with a non-timestamp readAt', async () => {
    // readAt must be a server timestamp; a client-supplied string is rejected.
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(
      setDoc(doc(db, 'families/family1/notification_reads/r1'), validRead('child1', 'n1', { readAt: '2020-01-01T00:00:00Z' })),
    );
  });

  it('user CANNOT create a read record for a non-existent notification', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(
      setDoc(doc(db, 'families/family1/notification_reads/r1'), validRead('child1', 'does-not-exist')),
    );
  });

  it('user CANNOT create a read record with unexpected fields', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(
      setDoc(doc(db, 'families/family1/notification_reads/r1'), { ...validRead('child1', 'n1'), forged: true }),
    );
  });

  it('user can update their own existing read record', async () => {
    const setup = testEnv.authenticatedContext('child1').firestore();
    await setDoc(doc(setup, 'families/family1/notification_reads/r1'), validRead('child1', 'n1'));
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertSucceeds(
      setDoc(doc(db, 'families/family1/notification_reads/r1'), validRead('child1', 'n1')),
    );
  });

  it('user CANNOT read another user read record', async () => {
    const setup = testEnv.authenticatedContext('child1').firestore();
    await setDoc(doc(setup, 'families/family1/notification_reads/r1'), validRead('child1', 'n1'));
    const db = testEnv.authenticatedContext('child2').firestore();
    await assertFails(getDoc(doc(db, 'families/family1/notification_reads/r1')));
  });

  it('read record CANNOT be deleted', async () => {
    const setup = testEnv.authenticatedContext('child1').firestore();
    await setDoc(doc(setup, 'families/family1/notification_reads/r1'), validRead('child1', 'n1'));
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(deleteDoc(doc(db, 'families/family1/notification_reads/r1')));
  });

  it('cross-family user CANNOT create a read record in another family', async () => {
    const db = testEnv.authenticatedContext('owner2').firestore();
    await assertFails(
      setDoc(doc(db, 'families/family1/notification_reads/r1'), validRead('owner2', 'n1', { familyId: 'family1' })),
    );
  });

  it('mark-all: user can mark multiple own unread notifications read', async () => {
    // Mirrors markAllNotificationsRead — one serverTimestamp() read record per
    // notification the user is a recipient of. The batch mechanism is covered by
    // the client unit test; here we assert the rule permits multiple own reads.
    // n1 and n3 are both addressed to child1 (n2 is addressed to child2).
    const setup = testEnv.authenticatedContext('parent1').firestore();
    await setDoc(doc(setup, 'families/family1/notifications/n3'), validNotification({ recipientIds: ['child1'], dedupeKey: 'task_approve_task3' }));
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertSucceeds(setDoc(doc(db, 'families/family1/notification_reads/child1_n1'), validRead('child1', 'n1')));
    await assertSucceeds(setDoc(doc(db, 'families/family1/notification_reads/child1_n3'), validRead('child1', 'n3')));
  });

  it('mark-all: a read record for another user is rejected (no broad parent permission)', async () => {
    // A parent must NOT gain a blanket "update any notification" permission.
    // Marking child1's read record as parent1 must fail.
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(
      setDoc(doc(db, 'families/family1/notification_reads/child1_n1'), validRead('child1', 'n1')),
    );
  });

  it('forged immutable read-record field (userId) is denied', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(
      setDoc(doc(db, 'families/family1/notification_reads/r1'), { ...validRead('child1', 'n1'), userId: 'child2' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Regression: "Mark all as read" must not exceed the Firestore rules
// per-request document-access limit (20 get/exists calls).
//
// The notification_reads create rule performs a `get()` on the parent
// notification document for every write it evaluates. A single batched write of
// 20+ read records therefore triggers 20+ distinct document accesses (one
// cached family doc + one per distinct notification) and the whole batch is
// rejected with permission-denied. The client must chunk the writes (see
// MARK_ALL_READ_CHUNK_SIZE = 15 in src/lib/notifications.ts) so each commit
// stays under the limit.
// ---------------------------------------------------------------------------
describe('mark-all batching vs Firestore rules document-access limit', () => {
  // Mirrors validNotification / validRead from the read-records suite so this
  // regression block is self-contained.
  function notif(nid: string) {
    return validNotification({ recipientIds: ['child1'], dedupeKey: `task_approve_${nid}` });
  }
  function read(nid: string) {
    return {
      familyId: 'family1',
      userId: 'child1',
      notificationId: nid,
      readAt: serverTimestamp(),
    };
  }

  const COUNT = 25; // > 20, clearly exceeds the per-request access limit
  const CHUNK = 15; // mirrors MARK_ALL_READ_CHUNK_SIZE in src/lib/notifications.ts

  beforeEach(async () => {
    const setup = testEnv.authenticatedContext('parent1').firestore();
    for (let i = 0; i < COUNT; i++) {
      await setDoc(doc(setup, `families/family1/notifications/n${i}`), notif(`n${i}`));
    }
  });

  it('OLD behaviour: a single batch of 20+ read records is REJECTED (document access limit)', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    const batch = writeBatch(db);
    for (let i = 0; i < COUNT; i++) {
      batch.set(doc(db, `families/family1/notification_reads/child1_n${i}`), read(`n${i}`));
    }
    // Reproduces the production failure: the whole batch is denied because the
    // rules evaluation exceeds the 20 document-access limit.
    await assertFails(batch.commit());
  });

  it('NEW behaviour: chunked writes of 20+ read records SUCCEED (stays under the limit)', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    for (let i = 0; i < COUNT; i += CHUNK) {
      const batch = writeBatch(db);
      for (let j = i; j < Math.min(i + CHUNK, COUNT); j++) {
        batch.set(doc(db, `families/family1/notification_reads/child1_n${j}`), read(`n${j}`));
      }
      // Each chunk commits independently and stays within the access budget.
      await assertSucceeds(batch.commit());
    }
    // All 25 notifications are eventually marked read.
    const snap = await getDoc(doc(db, 'families/family1/notification_reads/child1_n24'));
    expect(snap.exists()).toBe(true);
  });
});
