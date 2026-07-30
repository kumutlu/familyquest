import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

let testEnv: any;
const projectId = 'familyquest-diagnostic-3';
const familyId = 'family123';
const parentId = 'parent456';
const childId = 'child789';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (context: any) => {
    const db = context.firestore();
    
    // Create production-shaped user documents
    await setDoc(doc(db, 'users', parentId), {
      familyId,
      role: 'owner', // testing owner role
      displayName: 'Owner Parent',
      rewardPoints: 1000,
      lifetimeXP: 1000
    });
    
    await setDoc(doc(db, 'users', childId), {
      familyId,
      role: 'child',
      displayName: 'Child',
      rewardPoints: 100,
      lifetimeXP: 100
    });

    // Create production-shaped task and completion
    await setDoc(doc(db, `families/${familyId}/tasks`, 'task1'), {
      title: 'Clean Room',
      pointsReward: 50
    });
    
    await setDoc(doc(db, `families/${familyId}/task_completions`, 'comp1'), {
      taskId: 'task1',
      assigneeId: childId,
      status: 'pending_approval',
      periodKey: '2026-07-23',
      completedAt: serverTimestamp(),
      approvedAt: null
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Phase 3 - Collision Test', () => {
  it('parent can update existing feed document (set on existing doc is an update)', async () => {
    // 1. Create existing feed document bypassing rules (simulate old data)
    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      const db = context.firestore();
      await setDoc(doc(db, `families/${familyId}/feed`, 'task_approval_comp1'), {
        actorId: parentId,
        type: 'custom',
        text: 'Task approved: Clean Room',
        timestamp: serverTimestamp()
      });
    });

    // 2. Try the transaction - parent can update feed documents
    const db = testEnv.authenticatedContext(parentId).firestore();
    const batch = writeBatch(db);
    
    batch.update(doc(db, `families/${familyId}/task_completions`, 'comp1'), {
      status: 'approved',
      parentComment: null,
      approvedAt: serverTimestamp(),
      reviewedBy: parentId,
      reviewedByName: 'Owner Parent',
      reviewedAt: serverTimestamp()
    });
    
    // set() on an existing document is an update, and parent can update feed
    batch.set(doc(db, `families/${familyId}/feed`, 'task_approval_comp1'), {
      actorId: parentId,
      type: 'custom',
      text: 'Task approved: Clean Room',
      timestamp: serverTimestamp()
    });
    
    batch.set(doc(db, `families/${familyId}/notifications`, 'task_approve_comp1'), {
      familyId,
      type: 'task_approved',
      actorId: parentId,
      recipientIds: [childId],
      title: 'Task Approved',
      body: 'Clean Room was approved',
      metadata: {},
      createdAt: serverTimestamp(),
      entityType: 'task_completion',
      entityId: 'comp1',
      dedupeKey: 'task_approve_comp1'
    });
    
    // The batch succeeds because parent can update feed documents
    await assertSucceeds(batch.commit());
  });
});