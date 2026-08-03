// ---------------------------------------------------------------------------
// Mobile regression seed
// ---------------------------------------------------------------------------
//
// Seeds the standard e2e family (see seed.ts) and then adds TWO managed
// children with logins enabled:
//
//   * child-managed-keep     "Managed Mia"   — sibling that must survive
//   * child-managed-dispose  "Disposable Dan" — disposable delete target
//
// Both are synthetic emulator-only records. No production child (in particular
// "Omar Serdar") is ever touched by this script: it only ever talks to the
// Firestore/Auth emulators on 127.0.0.1.
// ---------------------------------------------------------------------------

import { Timestamp } from 'firebase-admin/firestore';
import { db, adminAuth, seedTestFamily } from './seed';

export const MOBILE_FAMILY_ID = 'test-fam';

export const KEEP_CHILD = {
  id: 'child-managed-keep',
  displayName: 'Managed Mia',
  username: 'managed mia',
  authUid: 'auth-managed-keep',
};

export const DISPOSABLE_CHILD = {
  id: 'child-managed-dispose',
  displayName: 'Disposable Dan',
  username: 'disposable dan',
  authUid: 'auth-managed-dispose',
};

/** Mirror of functions/src/childLogin.ts `generateSyntheticEmail`. */
function syntheticEmail(normalizedUsername: string): string {
  return `child-${MOBILE_FAMILY_ID.toLowerCase()}-${normalizedUsername.replace(/ /g, '-')}@managed.familyquest.app`;
}

/**
 * Writes exactly the records that the real `createChildLogin` callable would
 * write, so the lifecycle callables (resetChildPassword / deleteChild) resolve
 * the managed child successfully.
 */
async function seedManagedChild(child: typeof KEEP_CHILD) {
  const email = syntheticEmail(child.username);

  await adminAuth.createUser({
    uid: child.authUid,
    email,
    password: 'password123',
    displayName: child.displayName,
  });
  await adminAuth.setCustomUserClaims(child.authUid, {
    role: 'child',
    familyId: MOBILE_FAMILY_ID,
    childId: child.id,
    managedChild: true,
  });

  await db.doc(`users/${child.id}`).set({
    familyId: MOBILE_FAMILY_ID,
    role: 'child',
    displayName: child.displayName,
    isManaged: true,
    hasLogin: true,
    loginEnabled: true,
    requiresPasswordChange: false,
    username: child.username,
    authUid: child.authUid,
    rewardPoints: 10,
    lifetimeXP: 10,
    walletBalance: 0,
    createdAt: Timestamp.now(),
  });

  await db.doc(`families/${MOBILE_FAMILY_ID}/wallets/${child.id}`).set({ balance: 0 });

  // Server-owned private login record (families/{familyId}/childLogins/{childId}).
  await db.doc(`families/${MOBILE_FAMILY_ID}/childLogins/${child.id}`).set({
    childId: child.id,
    username: child.username,
    normalizedUsername: child.username,
    syntheticEmail: email,
    authUid: child.authUid,
    familyId: MOBILE_FAMILY_ID,
    status: 'enabled',
    requiresPasswordChange: false,
    createdAt: Timestamp.now(),
    createdBy: 'parent1',
  });

  // Username uniqueness index.
  await db.doc(`families/${MOBILE_FAMILY_ID}/childLoginIndex/${child.username}`).set({
    childId: child.id,
    normalizedUsername: child.username,
    createdAt: Timestamp.now(),
  });
}

export async function seedMobileFixtures() {
  await seedTestFamily();
  await seedManagedChild(KEEP_CHILD);
  await seedManagedChild(DISPOSABLE_CHILD);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedMobileFixtures()
    .then(() => {
      console.log('Seeded mobile fixtures successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
}
