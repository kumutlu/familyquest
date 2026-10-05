/**
 * Seed fixture for the Theme Shop VISUAL QA (`theme-visuals.spec.ts`).
 *
 * Deliberately reproduces the LIVE PRODUCTION SHAPE, which the older theme
 * seed did not:
 *
 *   1. The family has NO `families/{familyId}/themes/{shopItemId}` catalogue
 *      rows at all. That is what every real family looks like, and it is the
 *      shape that used to make every purchase fail.
 *   2. Bonus: it exercises the compiled-in catalogue end to end (neon/space
 *      500, rainbow/pixel/calm 300) and the class of themes without rows.
 *
 * Two children give both purchase states for the screenshots:
 *
 *   Leo (child@test.com) — 1200 pts, owns all five themes → Owned / Current,
 *   enough headroom to afford both 500-pt themes through the real purchase UI.
 *
 *   Ava (child2@test.com) — 487 pts, owns nothing → the exact reported
 *   scenario: Space Explorer at 500 pts against a 487-pt balance must offer a
 *   preview and say "Need 13 more points", never attempt a transaction.
 *
 * Ownership is seeded with the Admin SDK (which bypasses rules) exactly like
 * the other E2E fixtures. This is a test fixture, not a production path.
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { seededThemePurchaseDocuments } from './themePurchaseSeedShape';

process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';

if (getApps().length === 0) {
  initializeApp({ projectId: 'familyquest-beta-402cb' });
}

const db = getFirestore();
const adminAuth = getAuth();

/** Built-in catalogue: shop item id → [themeId, price]. */
const SHOP_ITEMS: ReadonlyArray<readonly [string, string, number]> = [
  ['neon', 'theme.shop.neon', 500],
  ['space', 'theme.shop.space', 500],
  ['rainbow', 'theme.shop.rainbow', 300],
  ['pixel', 'theme.shop.pixel', 300],
  ['calm', 'theme.shop.calm', 300],
];

const FAMILY = 'test-fam';

async function clearEmulator() {
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/familyquest-beta-402cb/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw new Error('Failed to clear firestore emulator');
  const users = await adminAuth.listUsers(1000);
  if (users.users.length > 0) {
    await adminAuth.deleteUsers(users.users.map((u) => u.uid));
  }
}

export async function seedThemeVisuals() {
  await clearEmulator();

  await adminAuth.createUser({ uid: 'parent1', email: 'parent@test.com', password: 'password123', displayName: 'Parent Dad' });
  await adminAuth.createUser({ uid: 'child1', email: 'child@test.com', password: 'password123', displayName: 'Leo' });
  await adminAuth.createUser({ uid: 'child2', email: 'child2@test.com', password: 'password123', displayName: 'Ava' });

  const batch = db.batch();

  batch.set(db.doc(`families/${FAMILY}`), {
    name: 'Test Family',
    inviteCode: 'TEST99',
    currency: '£',
    debtLimit: 0,
    createdAt: Timestamp.now(),
  });

  batch.set(db.doc('users/parent1'), { familyId: FAMILY, role: 'parent', displayName: 'Parent Dad' });

  // Leo — owns every theme. 1200 pts is deliberate headroom: neon and space
  // both cost 500, so he can afford BOTH through the real purchase UI if a
  // future run ever needs to fall back to buying instead of applying. Nothing
  // in the runtime suite spends it — ownership is seeded, not bought.
  batch.set(db.doc('users/child1'), {
    familyId: FAMILY, role: 'child', displayName: 'Leo',
    rewardPoints: 1200, lifetimeXP: 320, walletBalance: 500, level: 4,
  });
  // Ava — the reported scenario: 487 pts against a 500-pt theme.
  batch.set(db.doc('users/child2'), {
    familyId: FAMILY, role: 'child', displayName: 'Ava',
    rewardPoints: 487, lifetimeXP: 120, walletBalance: 200, level: 2,
  });

  // A believable child home so the applied-theme screenshots show real content.
  batch.set(db.doc(`families/${FAMILY}/tasks/task1`), {
    title: 'Tidy your room', pointsReward: 30, isActive: true,
    requiresApproval: false, type: 'daily', assigneeId: 'child1', createdAt: Timestamp.now(),
  });
  batch.set(db.doc(`families/${FAMILY}/tasks/task2`), {
    title: 'Read for 20 minutes', pointsReward: 20, isActive: true,
    requiresApproval: false, type: 'daily', assigneeId: 'child1', createdAt: Timestamp.now(),
  });
  batch.set(db.doc(`families/${FAMILY}/tasks/task3`), {
    title: 'Help with dinner', pointsReward: 25, isActive: true,
    requiresApproval: false, type: 'daily', assigneeId: 'child1', createdAt: Timestamp.now(),
  });

  // Reward rows + a child wallet so the Rewards route shows real points /
  // reward surfaces (the theme-depth probe needs actual elements to sample).
  batch.set(db.doc(`families/${FAMILY}/rewards/reward1`), {
    title: 'Screen time', cost: 50, isActive: true, category: 'screen-time',
    createdAt: Timestamp.now(),
  });
  batch.set(db.doc(`families/${FAMILY}/rewards/reward2`), {
    title: 'Choose Friday dinner', cost: 120, isActive: true, category: 'privilege',
    createdAt: Timestamp.now(),
  });
  batch.set(db.doc(`families/${FAMILY}/rewards/reward3`), {
    title: 'Extra story before bed', cost: 80, isActive: true, category: 'privilege',
    createdAt: Timestamp.now(),
  });
  batch.set(db.doc(`families/${FAMILY}/wallets/child1`), {
    userId: 'child1', familyId: FAMILY, balance: 500, currency: '£',
    updatedAt: Timestamp.now(),
  });

  // Leo owns all five themes. TWO documents, exactly as the production
  // purchase transaction writes them (src/lib/api.ts purchaseShopTheme):
  //
  //   canonical (immutable, authority; read by the shop transaction and by
  //              the equip rule):
  //     families/{familyId}/themes/{shopItemId}/purchases/{childId}
  //   mirror    (per-child hydration projection; the ONLY collection the
  //              client bootstrap query reads, because rules-are-not-filters
  //              forbids a collection-group read of the canonical records):
  //     families/{familyId}/users/{childId}/theme_purchases/{shopItemId}
  //
  // The mirror field set is EXACTLY the four keys the create rule allows
  // (`allowedMirrorKeys`) — no `childId`, because the parent collection path
  // already carries the child scope and `useThemeShop`/`useChildThemeRights`
  // recognise the mirror by `shopItemId` being present with no `childId`.
  // Seeding one without the other is what produced the old, self-contradictory
  // fixture: the transaction said "You already own this theme" (canonical)
  // while the shop said "Buy" (mirror never hydrated).
  for (const [shopItemId, themeId, price] of SHOP_ITEMS) {
    const { canonical, mirror } = seededThemePurchaseDocuments({
      familyId: FAMILY,
      childId: 'child1',
      shopItemId,
      themeId,
      costPoints: price,
      purchasedAt: Timestamp.now(),
    });
    batch.set(db.doc(canonical.path), canonical.data);
    batch.set(db.doc(mirror.path), mirror.data);
  }

  await batch.commit();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedThemeVisuals()
    .then(() => {
      console.log('Seeded theme visuals successfully');
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
