import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

// Initialize Admin SDK once
if (getApps().length === 0) {
  initializeApp({ projectId: 'familyquest-beta-402cb' });
}

export const db = getFirestore();
export const adminAuth = getAuth();

export async function clearEmulator() {
  const response = await fetch('http://127.0.0.1:8080/emulator/v1/projects/familyquest-beta-402cb/databases/(default)/documents', { method: 'DELETE' });
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
  await adminAuth.createUser({ uid: 'owner1', email: 'owner@test.com', password: 'password123', displayName: 'Owner Mom' });
  await adminAuth.createUser({ uid: 'parent1', email: 'parent@test.com', password: 'password123', displayName: 'Parent Dad' });
  await adminAuth.createUser({ uid: 'child1', email: 'child@test.com', password: 'password123', displayName: 'Child Leo' });
  await adminAuth.createUser({ uid: 'child2', email: 'child2@test.com', password: 'password123', displayName: 'Child Ava' });

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

  await batch.commit();
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedTestFamily().then(() => {
    console.log('Seeded successfully');
    process.exit(0);
  }).catch(e => {
    console.error(e);
    process.exit(1);
  });
}

