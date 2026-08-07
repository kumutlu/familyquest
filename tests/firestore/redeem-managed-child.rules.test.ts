// ---------------------------------------------------------------------------
// P0 REDEEM — MANAGED-CHILD RULE BUDGET REGRESSION
// ---------------------------------------------------------------------------
// Reproduces the full multi-document redeem commit (users update + redemption
// create + feed create + notification create) for a managed child and proves:
//   1. normal child redeem ALLOW
//   2. managed child with valid claims ALLOW (full commit, no budget overflow)
//   3. managed child wrong authUid DENY
//   4. managed child wrong childId DENY
//   5. managed child wrong familyId DENY
//   6. managed child requiresPasswordChange=true DENY
//   7. cross-family managed child DENY
//   8. insufficient points DENY (business-error path, no partial write)
//   9. duplicate redemption DENY
//  10. full commit includes user update + redemption + feed + notification
//  11. no expression-budget / document-access overflow for valid managed child
//
// The rules refactor (P0 REDEEM BUDGET FIX) makes authProfileId() read-free and
// moves managed-child verification to the outer gate isTrustedManagedChild(),
// invoked once per managed-child write path (isFamilyMember + users update).
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const FAMILY_ID = 'fam-mc';
const OTHER_FAMILY = 'other-mc';
let testEnv: RulesTestEnvironment;

const NORMAL_CHILD = 'nchild';
const MANAGED_CHILD = 'mchild';
const MANAGED_CHILD_AUTH = 'auth-mchild';
const MANAGED_CHILD2 = 'mchild2';
const MANAGED_CHILD2_AUTH = 'auth-mchild2';
const CROSS_CHILD = 'xchild';
const CROSS_CHILD_AUTH = 'auth-xchild';
const PARENT = 'parent';

const managedClaims = (overrides: Record<string, unknown> = {}) => ({
  role: 'child',
  managedChild: true,
  childId: MANAGED_CHILD,
  familyId: FAMILY_ID,
  ...overrides,
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-redeem-mc-rules',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAMILY_ID}`), { name: 'Fam', currencyCode: 'GBP' });
    await setDoc(doc(db, `families/${OTHER_FAMILY}`), { name: 'Other', currencyCode: 'GBP' });

    await setDoc(doc(db, 'users', PARENT), { familyId: FAMILY_ID, role: 'parent', displayName: 'Parent' });
    await setDoc(doc(db, 'users', NORMAL_CHILD), {
      familyId: FAMILY_ID, role: 'child', displayName: 'Normal', rewardPoints: 100, lifetimeXP: 0,
    });
    await setDoc(doc(db, 'users', MANAGED_CHILD), {
      familyId: FAMILY_ID, role: 'child', isManaged: true, authUid: MANAGED_CHILD_AUTH,
      displayName: 'Managed', rewardPoints: 100, lifetimeXP: 0, requiresPasswordChange: false,
    });
    await setDoc(doc(db, 'users', MANAGED_CHILD2), {
      familyId: FAMILY_ID, role: 'child', isManaged: true, authUid: MANAGED_CHILD2_AUTH,
      displayName: 'Managed2', rewardPoints: 100, lifetimeXP: 0, requiresPasswordChange: false,
    });
    await setDoc(doc(db, 'users', CROSS_CHILD), {
      familyId: OTHER_FAMILY, role: 'child', isManaged: true, authUid: CROSS_CHILD_AUTH,
      displayName: 'Cross', rewardPoints: 100, lifetimeXP: 0, requiresPasswordChange: false,
    });

    await setDoc(doc(db, `families/${FAMILY_ID}/rewards/toy`), {
      familyId: FAMILY_ID, title: 'Toy', cost: 10, active: true,
    });
    await setDoc(doc(db, `families/${FAMILY_ID}/rewards/expensive`), {
      familyId: FAMILY_ID, title: 'Expensive', cost: 1000, active: true,
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

// Builds and commits the full redeem transaction (user update + redemption +
// feed + notification) for the given Firestore db. `childId` is the profile id
// that must match the caller's authProfileId() (the managed-childId claim).
async function redeemCommit(db: any, childId: string, cost: number, rewardId = 'toy') {
  const userRef = doc(db, `users/${childId}`);
  const redemptionRef = doc(collection(db, `families/${FAMILY_ID}/redemptions`));
  const feedRef = doc(collection(db, `families/${FAMILY_ID}/feed`));
  const notifRef = doc(db, `families/${FAMILY_ID}/notifications`, `reward_requested_${redemptionRef.id}`);
  await runTransaction(db, async (tx: any) => {
    const userDoc = await tx.get(userRef);
    const currentPoints = userDoc.data()?.rewardPoints ?? 0;
    const redemptionPayload = {
      rewardId,
      userId: childId,
      costPaid: cost,
      redeemedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      status: 'completed',
      familyId: FAMILY_ID,
      sourceId: redemptionRef.id,
      actorId: childId,
      effectSnapshot: {
        schemaVersion: 1,
        entityType: 'reward_redemption',
        familyId: FAMILY_ID,
        actorId: childId,
        childId,
        rewardId,
        pointsDelta: -cost,
        xpAdjustment: 0,
      },
    };
    const userUpdate = { rewardPoints: currentPoints - cost, lastRedemptionId: redemptionRef.id };
    const feedPayload = { actorId: childId, text: `Redeemed reward`, timestamp: serverTimestamp() };
    const notifPayload = {
      familyId: FAMILY_ID,
      type: 'reward_requested',
      actorId: childId,
      recipientIds: [PARENT],
      title: 'Reward approval needed',
      body: 'probe',
      metadata: {},
      createdAt: serverTimestamp(),
      entityType: 'redemption',
      entityId: redemptionRef.id,
      actionUrl: '/',
      dedupeKey: `reward_requested_${redemptionRef.id}`,
    };
    await tx.get(doc(db, `families/${FAMILY_ID}/rewards/${rewardId}`));
    await tx.get(notifRef);
    tx.update(userRef, userUpdate);
    tx.set(redemptionRef, redemptionPayload);
    tx.set(feedRef, feedPayload);
    tx.set(notifRef, notifPayload);
  });
  return { userRef, redemptionRef, feedRef, notifRef };
}

describe('P0 redeem — managed-child budget regression', () => {
  it('1. normal child redeem ALLOW', async () => {
    const db = testEnv.authenticatedContext(NORMAL_CHILD).firestore();
    await assertSucceeds(redeemCommit(db, NORMAL_CHILD, 10));
  });

  it('2. managed child with valid claims ALLOW (full commit)', async () => {
    const db = testEnv.authenticatedContext(MANAGED_CHILD_AUTH, managedClaims()).firestore();
    await assertSucceeds(redeemCommit(db, MANAGED_CHILD, 10));
  });

  it('3. managed child wrong authUid DENY', async () => {
    const db = testEnv.authenticatedContext('wrong-auth-uid', managedClaims()).firestore();
    await assertFails(redeemCommit(db, MANAGED_CHILD, 10));
  });

  it('4. managed child wrong childId DENY', async () => {
    // Valid auth uid but claims a different managed child's id.
    const db = testEnv
      .authenticatedContext(MANAGED_CHILD_AUTH, managedClaims({ childId: MANAGED_CHILD2 }))
      .firestore();
    await assertFails(redeemCommit(db, MANAGED_CHILD2, 10));
  });

  it('5. managed child wrong familyId DENY', async () => {
    const db = testEnv
      .authenticatedContext(MANAGED_CHILD_AUTH, managedClaims({ familyId: OTHER_FAMILY }))
      .firestore();
    await assertFails(redeemCommit(db, MANAGED_CHILD, 10));
  });

  it('6. managed child requiresPasswordChange=true DENY', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx: any) => {
      await setDoc(doc(ctx.firestore(), 'users', MANAGED_CHILD), { requiresPasswordChange: true }, { merge: true });
    });
    const db = testEnv.authenticatedContext(MANAGED_CHILD_AUTH, managedClaims()).firestore();
    await assertFails(redeemCommit(db, MANAGED_CHILD, 10));
  });

  it('7. cross-family managed child DENY', async () => {
    // Token claims FAMILY_ID but the managed child doc lives in OTHER_FAMILY.
    const db = testEnv
      .authenticatedContext(CROSS_CHILD_AUTH, managedClaims({ childId: CROSS_CHILD, familyId: FAMILY_ID }))
      .firestore();
    await assertFails(redeemCommit(db, CROSS_CHILD, 10));
  });

  it('8. insufficient points DENY (no partial write)', async () => {
    const db = testEnv.authenticatedContext(MANAGED_CHILD_AUTH, managedClaims()).firestore();
    await assertFails(redeemCommit(db, MANAGED_CHILD, 1000, 'expensive'));
    const after = await getDoc(doc(db, `users/${MANAGED_CHILD}`));
    expect(after.data()?.rewardPoints).toBe(100); // unchanged
  });

  it('9. duplicate redemption DENY', async () => {
    const db = testEnv.authenticatedContext(MANAGED_CHILD_AUTH, managedClaims()).firestore();
    const userRef = doc(db, `users/${MANAGED_CHILD}`);
    const redemptionRef = doc(db, `families/${FAMILY_ID}/redemptions/dup-id`);
    const feedRef = doc(db, `families/${FAMILY_ID}/feed/dup-feed`);
    const doRedeem = () =>
      runTransaction(db, async (tx: any) => {
        const userDoc = await tx.get(userRef);
        const currentPoints = userDoc.data()?.rewardPoints ?? 0;
        tx.update(userRef, { rewardPoints: currentPoints - 10, lastRedemptionId: 'dup-id' });
        tx.set(redemptionRef, {
          rewardId: 'toy', userId: MANAGED_CHILD, costPaid: 10, redeemedAt: serverTimestamp(),
          createdAt: serverTimestamp(), status: 'completed', familyId: FAMILY_ID, sourceId: 'dup-id',
          actorId: MANAGED_CHILD,
          effectSnapshot: {
            schemaVersion: 1, entityType: 'reward_redemption', familyId: FAMILY_ID,
            actorId: MANAGED_CHILD, childId: MANAGED_CHILD, rewardId: 'toy', pointsDelta: -10, xpAdjustment: 0,
          },
        });
        tx.set(feedRef, { actorId: MANAGED_CHILD, text: 'x', timestamp: serverTimestamp() });
      });
    await assertSucceeds(doRedeem());
    await assertFails(doRedeem());
  });

  it('10. full commit includes user update + redemption + feed + notification', async () => {
    const db = testEnv.authenticatedContext(MANAGED_CHILD_AUTH, managedClaims()).firestore();
    const { userRef, redemptionRef, feedRef, notifRef } = await redeemCommit(db, MANAGED_CHILD, 10);
    const user = await getDoc(userRef);
    const redemption = await getDoc(redemptionRef);
    const feed = await getDoc(feedRef);
    const notif = await getDoc(doc(testEnv.authenticatedContext(PARENT).firestore(), notifRef.path));
    expect(user.data()?.rewardPoints).toBe(90);
    expect(user.data()?.lastRedemptionId).toBe(redemptionRef.id);
    expect(redemption.exists()).toBe(true);
    expect(feed.exists()).toBe(true);
    expect(notif.exists()).toBe(true);
  });

  it('11. no expression-budget / document-access overflow for valid managed child', async () => {
    // The full 4-document commit for a managed child must succeed. A budget
    // overflow would deny the whole commit; success proves the read-free
    // authProfileId() + single outer-gate verification stays within budget.
    const db = testEnv.authenticatedContext(MANAGED_CHILD_AUTH, managedClaims()).firestore();
    await assertSucceeds(redeemCommit(db, MANAGED_CHILD, 10));
  });
});
