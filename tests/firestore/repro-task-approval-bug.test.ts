import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, serverTimestamp, runTransaction, getDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';

let testEnv: RulesTestEnvironment;
const projectId = 'familyquest-task-approval-bug';
const familyId = 'family123';
const parentId = 'parent456';
const childId = 'child789';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
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
    await setDoc(doc(db, 'families', familyId), { name: 'Family 1' });
    await setDoc(doc(db, 'users', parentId), { familyId, role: 'parent', displayName: 'Parent' });
    await setDoc(doc(db, 'users', childId), { familyId, role: 'child', displayName: 'Child' });
    await setDoc(doc(db, `families/${familyId}/tasks`, 'task1'), { title: 'Clean Room', pointsReward: 50 });
    await setDoc(doc(db, `families/${familyId}/task_completions`, 'comp1'), {
      taskId: 'task1',
      assigneeId: childId,
      status: 'pending_approval'
    });
  });
});

describe('Task Approval Bug Reproduction - Transaction with pre-read', () => {
  it('APPROVE: transaction with notification pre-read (get) should SUCCEED', async () => {
    // This simulates the ACTUAL code in approveTaskCompletion
    // which does a pre-read for notification de-duplication
    const db = testEnv.authenticatedContext(parentId).firestore();
    
    await assertSucceeds(
      runTransaction(db, async (transaction) => {
        // Pre-read for notification de-duplication (this is what loadNotificationRecipientsInTransaction does)
        const notifRef = doc(db, `families/${familyId}/notifications`, 'task_approve_comp1');
        const existing = await transaction.get(notifRef);
        
        // Task completion update
        transaction.update(doc(db, `families/${familyId}/task_completions`, 'comp1'), {
          status: 'approved',
          parentComment: null,
          approvedAt: serverTimestamp(),
          reviewedBy: parentId,
          reviewedByName: 'Parent',
          reviewedAt: serverTimestamp()
        });

        // Feed write (deterministic ID)
        transaction.set(doc(db, `families/${familyId}/feed`, 'task_approval_comp1'), {
          actorId: parentId,
          type: 'custom',
          text: 'Task approved: Clean Room (+50 pts)',
          timestamp: serverTimestamp()
        });

        // Notification write (only if not exists)
        if (!existing.exists()) {
          transaction.set(notifRef, {
            familyId,
            type: 'task_approved',
            actorId: parentId,
            recipientIds: [childId],
            title: 'Task approved',
            body: '"Clean Room" was approved. +50 points',
            entityType: 'task_completion',
            entityId: 'comp1',
            actionUrl: '/tasks',
            dedupeKey: 'task_approve_comp1',
            createdAt: serverTimestamp()
          });
        }
      })
    );
  });

  it('REJECT: transaction with notification pre-read (get) should SUCCEED', async () => {
    // This simulates the ACTUAL code in rejectTaskCompletion
    const db = testEnv.authenticatedContext(parentId).firestore();
    
    await assertSucceeds(
      runTransaction(db, async (transaction) => {
        // Pre-read for notification de-duplication
        const notifRef = doc(db, `families/${familyId}/notifications`, 'task_reject_comp1');
        const existing = await transaction.get(notifRef);
        
        // Task completion update
        transaction.update(doc(db, `families/${familyId}/task_completions`, 'comp1'), {
          status: 'rejected',
          parentComment: 'Not clean enough',
          rejectedAt: serverTimestamp(),
          reviewedBy: parentId,
          reviewedByName: 'Parent',
          reviewedAt: serverTimestamp()
        });

        // Feed write (auto-generated ID)
        transaction.set(doc(db, `families/${familyId}/feed`, 'feed_reject_task'), {
          actorId: parentId,
          type: 'custom',
          text: 'Task rejected: Clean Room - "Not clean enough"',
          timestamp: serverTimestamp()
        });

        // Notification write (only if not exists)
        if (!existing.exists()) {
          transaction.set(notifRef, {
            familyId,
            type: 'task_rejected',
            actorId: parentId,
            recipientIds: [childId],
            title: 'Task needs attention',
            body: '"Clean Room" needs attention: "Not clean enough"',
            entityType: 'task_completion',
            entityId: 'comp1',
            actionUrl: '/tasks',
            dedupeKey: 'task_reject_comp1',
            createdAt: serverTimestamp()
          });
        }
      })
    );
  });

  it('APPROVE: notification pre-read for non-existent doc should SUCCEED', async () => {
    // Test that the pre-read for a non-existent notification works
    const db = testEnv.authenticatedContext(parentId).firestore();
    
    await assertSucceeds(
      runTransaction(db, async (transaction) => {
        // Pre-read for non-existent notification
        const notifRef = doc(db, `families/${familyId}/notifications`, 'nonexistent');
        const existing = await transaction.get(notifRef);
        if (!existing.exists()) {
          transaction.set(notifRef, {
            familyId,
            type: 'task_approved',
            actorId: parentId,
            recipientIds: [childId],
            title: 'Task approved',
            body: 'Test',
            createdAt: serverTimestamp()
          });
        }
      })
    );
  });
});