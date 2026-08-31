import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';

// Initialize Admin SDK once
if (getApps().length === 0) {
  initializeApp({ projectId: 'familyquest-beta-402cb' });
}

export const db = getFirestore();
export const adminAuth = getAuth();

export async function clearEmulator() {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/familyquest-beta-402cb/databases/(default)/documents`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error('Failed to clear firestore emulator');
  }
  // Clear Auth emulator (Delete all users)
  const users = await adminAuth.listUsers(1000);
  if (users.users.length > 0) {
    await adminAuth.deleteUsers(users.users.map(u => u.uid));
  }
}

export async function seedTestFamily() {
  await clearEmulator();
  const familyId = 'test-fam';

  // Auth Users
  await adminAuth.createUser({ uid: 'owner1', email: 'owner@test.com', emailVerified: true, password: 'password123', displayName: 'Owner Mom' });
  await adminAuth.createUser({ uid: 'parent1', email: 'parent@test.com', emailVerified: true, password: 'password123', displayName: 'Parent Dad' });
  await adminAuth.createUser({ uid: 'child1', email: 'child@test.com', emailVerified: true, password: 'password123', displayName: 'Child Leo' });
  await adminAuth.createUser({ uid: 'child2', email: 'child2@test.com', emailVerified: true, password: 'password123', displayName: 'Child Ava' });

  const batch = db.batch();

  // Family
  batch.set(db.doc(`families/${familyId}`), {
    name: 'Test Family',
    inviteCode: 'TEST99',
    currency: '£',
    debtLimit: 0,
    createdAt: Timestamp.now()
  });

  // Owner
  batch.set(db.doc(`users/owner1`), { familyId, role: 'owner', displayName: 'Owner Mom' });
  // Parent
  batch.set(db.doc(`users/parent1`), { familyId, role: 'parent', displayName: 'Parent Dad' });
  // Children
  batch.set(db.doc(`users/child1`), { familyId, role: 'child', displayName: 'Child Leo', rewardPoints: 100, lifetimeXP: 100, walletBalance: 500 });
  batch.set(db.doc(`users/child2`), { familyId, role: 'child', displayName: 'Child Ava', rewardPoints: 50, lifetimeXP: 50, walletBalance: 200 });

  // Wallets
  batch.set(db.doc(`families/${familyId}/wallets/child1`), { balance: 500 });
  batch.set(db.doc(`families/${familyId}/wallets/child2`), { balance: 200 });

  // Tasks
  batch.set(db.doc(`families/${familyId}/tasks/task1`), {
    title: 'Clean Room',
    pointsReward: 50,
    isActive: true,
    requiresApproval: true,
    type: 'daily',
    createdAt: Timestamp.now()
  });

  // Rewards
  batch.set(db.doc(`families/${familyId}/rewards/reward1`), {
    title: 'Screen Time',
    cost: 50,
    isActive: true,
    category: 'screen-time',
    createdAt: Timestamp.now()
  });

  // Notification fixture lives in the standalone seed process so Playwright
  // specs never import firebase-admin through Playwright's ESM transform.
  batch.set(db.doc(`families/${familyId}/notifications/notif-1`), {
    familyId,
    type: 'task_approved',
    actorId: 'parent1',
    recipientIds: ['child1'],
    title: 'Room cleaned!',
    body: 'Your task was approved.',
    entityType: 'task',
    entityId: 'task1',
    actionUrl: '/tasks',
    dedupeKey: 'notif-1',
    createdAt: Timestamp.now(),
  });

  // Pet Box
  batch.set(db.doc(`families/${familyId}/funds/petbox1`), {
    name: 'Vet Fund',
    type: 'pet',
    species: 'dog',
    balance: 10000,
    monthlyBudget: 20000,
    emergencyGoal: 50000,
    isActive: true
  });

  // Money Requests (seeded so the Approval Center flow can be exercised end-to-end)
  // child1 (Leo) requests £2.00 from parent1 (Dad) -> 'pending' (parent-approvable)
  batch.set(db.doc(`families/${familyId}/money_requests/mr-pending`), {
    familyId,
    requesterId: 'child1',
    requesterName: 'Child Leo',
    requestedFromId: 'parent1',
    requestedFromName: 'Parent Dad',
    requestedFromRole: 'parent',
    amountPence: 200,
    message: 'For a school trip',
    status: 'pending',
    createdAt: Timestamp.now()
  });
  // child2 (Ava) requests £3.00 from child1 (Leo) -> 'pending_acceptance' (awaiting acceptance)
  batch.set(db.doc(`families/${familyId}/money_requests/mr-accept`), {
    familyId,
    requesterId: 'child2',
    requesterName: 'Child Ava',
    requestedFromId: 'child1',
    requestedFromName: 'Child Leo',
    requestedFromRole: 'child',
    amountPence: 300,
    message: 'Please?',
    status: 'pending_acceptance',
    createdAt: Timestamp.now()
  });
  // child1 (Leo) requests £2.00 from parent1 (Dad) but stored as 'pending_acceptance'
  // (legacy/edge shape) -> parent is the requested-from and must see Accept, not Approve.
  batch.set(db.doc(`families/${familyId}/money_requests/mr-accept-parent`), {
    familyId,
    requesterId: 'child1',
    requesterName: 'Child Leo',
    requestedFromId: 'parent1',
    requestedFromName: 'Parent Dad',
    requestedFromRole: 'parent',
    amountPence: 200,
    message: 'For a school trip',
    status: 'pending_acceptance',
    createdAt: Timestamp.now()
  });

  // Goals (Phase 3): a family goal and a child goal, with a contributions
  // ledger and a pending goal withdrawal request so the UI flows are exercised.
  batch.set(db.doc(`families/${familyId}/savings_goals/goal-family`), {
    goalId: 'goal-family', title: 'Family Holiday', kind: 'family',
    targetAmountPence: 100000, currentAmountPence: 40000, currency: 'GBP',
    status: 'active', matching: { mode: 'none', perX: 0, matchY: 0 }, version: 1,
    createdAt: Timestamp.now(),
  });
  batch.set(db.doc(`families/${familyId}/savings_goals/goal-child`), {
    goalId: 'goal-child', title: 'Leo’s Bike', kind: 'child', childId: 'child1',
    targetAmountPence: 50000, currentAmountPence: 50000, currency: 'GBP',
    status: 'reached', matching: { mode: 'auto', perX: 1000, matchY: 500 }, version: 1,
    createdAt: Timestamp.now(),
  });
  // Contributions ledger for the child goal (ownership source of truth).
  batch.set(db.doc(`families/${familyId}/savings_goals/goal-child/contributions/c1`), {
    contribId: 'c1', goalId: 'goal-child', type: 'child_contribution',
    ownerType: 'child', ownerId: 'child1', amountPence: 40000, status: 'applied',
    createdAt: Timestamp.now(),
  });
  batch.set(db.doc(`families/${familyId}/savings_goals/goal-child/contributions/c2`), {
    contribId: 'c2', goalId: 'goal-child', type: 'auto_match',
    ownerType: 'parent', ownerId: 'parent1', amountPence: 10000, status: 'applied',
    createdAt: Timestamp.now(),
  });
  // Pending goal withdrawal request (child1 wants to withdraw from their bike goal).
  batch.set(db.doc(`families/${familyId}/goal_requests/gr1`), {
    requestType: 'withdrawal', goalId: 'goal-child', childId: 'child1',
    amountPence: 10000, status: 'pending', createdAt: Timestamp.now(),
  });

  await batch.commit();
}

// Adult invitation browser scenarios intentionally start from the same
// disposable owner/family fixture. Keeping the entry point explicit makes the
// test boundary discoverable without allowing browser code to write v2 records.
export async function seedAdultInviteE2E() {
  await seedTestFamily();
  await adminAuth.createUser({ uid: 'other1', email: 'other@test.com', password: 'password123', displayName: 'Other Family Adult' });
  const batch = db.batch();
  batch.set(db.doc('families/other-fam'), {
    name: 'Other Family',
    inviteCode: 'OTHER1',
    currency: '£',
    debtLimit: 0,
    createdAt: Timestamp.now(),
  });
  batch.set(db.doc('users/other1'), {
    familyId: 'other-fam',
    role: 'parent',
    lifecycle: 'active',
    displayName: 'Other Family Adult',
  });
  batch.set(db.doc('families/other-fam/users/other1'), {
    uid: 'other1',
    role: 'parent',
    lifecycle: 'active',
    displayName: 'Other Family Adult',
  });
  await batch.commit();
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const seed = process.argv.includes('--adult-invite') ? seedAdultInviteE2E : seedTestFamily;
  seed().then(() => {
    console.log('Seeded successfully');
    process.exit(0);
  }).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
