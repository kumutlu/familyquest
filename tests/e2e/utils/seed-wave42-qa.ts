// ---------------------------------------------------------------------------
// Wave 4.2 + 4.3 FINAL release-proof seed (QA only — NOT part of the release)
// ---------------------------------------------------------------------------
//
// Seeds three distinct children exactly as required by the release-proof brief:
//
//   Alisya   wallet £11.11 (1111 pence) / 111 points
//   Mostium  wallet £22.22 (2222 pence) / 222 points
//   Mnalium  wallet £33.33 (3333 pence) / 333 points
//
// Rewards include an affordable, an unaffordable and a sold-out reward.
// Emulator-only. Never touches production.
// ---------------------------------------------------------------------------

import { Timestamp } from 'firebase-admin/firestore';
import { db, adminAuth, clearEmulator } from './seed';

export const QA_FAMILY_ID = 'qa-fam';

export const QA_CHILDREN = [
  { id: 'alisya', name: 'Alisya', email: 'alisya@test.com', pence: 1111, points: 111 },
  { id: 'mostium', name: 'Mostium', email: 'mostium@test.com', pence: 2222, points: 222 },
  { id: 'mnalium', name: 'Mnalium', email: 'mnalium@test.com', pence: 3333, points: 333 },
];

export async function seedWave42QaFamily() {
  await clearEmulator();

  await adminAuth.createUser({
    uid: 'qa-owner',
    email: 'owner@test.com',
    password: 'password123',
    displayName: 'QA Owner',
  });

  const batch = db.batch();

  batch.set(db.doc(`families/${QA_FAMILY_ID}`), {
    name: 'QA Release Family',
    inviteCode: 'QAREL1',
    currency: '£',
    debtLimit: 0,
    createdAt: Timestamp.now(),
  });

  batch.set(db.doc('users/qa-owner'), {
    familyId: QA_FAMILY_ID,
    role: 'owner',
    displayName: 'QA Owner',
  });

  for (const c of QA_CHILDREN) {
    await adminAuth.createUser({
      uid: c.id,
      email: c.email,
      password: 'password123',
      displayName: c.name,
    });
    batch.set(db.doc(`users/${c.id}`), {
      familyId: QA_FAMILY_ID,
      role: 'child',
      displayName: c.name,
      rewardPoints: c.points,
      lifetimeXP: c.points,
      walletBalance: c.pence,
    });
    batch.set(db.doc(`families/${QA_FAMILY_ID}/wallets/${c.id}`), { balance: c.pence });
    // One historical ledger entry per child so history is non-empty.
    batch.set(db.doc(`families/${QA_FAMILY_ID}/wallet_transactions/${c.id}-seed`), {
      childId: c.id,
      type: 'deposit',
      amountPence: c.pence,
      note: 'Seed allowance',
      createdAt: Timestamp.now(),
    });
  }

  // Rewards: affordable / unaffordable / sold-out
  batch.set(db.doc(`families/${QA_FAMILY_ID}/rewards/qa-affordable`), {
    title: 'Sticker Pack',
    cost: 50,
    icon: 'Gift',
    isActive: true,
    inventory: null,
    createdAt: Timestamp.now(),
  });
  batch.set(db.doc(`families/${QA_FAMILY_ID}/rewards/qa-unaffordable`), {
    title: 'Theme Park Trip',
    cost: 9999,
    icon: 'Ticket',
    isActive: true,
    inventory: null,
    createdAt: Timestamp.now(),
  });
  batch.set(db.doc(`families/${QA_FAMILY_ID}/rewards/qa-soldout`), {
    title: 'Limited Poster',
    cost: 50,
    icon: 'Star',
    isActive: true,
    inventory: 0,
    createdAt: Timestamp.now(),
  });

  await batch.commit();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedWave42QaFamily()
    .then(() => {
      console.log('Wave 4.2 QA family seeded');
      process.exit(0);
    })
    .catch(e => {
      console.error(e);
      process.exit(1);
    });
}
