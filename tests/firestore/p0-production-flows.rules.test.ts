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
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  getDoc,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const FAMILY_ID = 'p0-family';
const OTHER_FAMILY = 'other-family';
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-p0-rules',
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
    await setDoc(doc(db, `families/${FAMILY_ID}`), {
      name: 'P0 family',
      currencyCode: 'GBP',
      debtLimitPence: -5000,
    });
    await setDoc(doc(db, `families/${OTHER_FAMILY}`), {
      name: 'Other family',
      currencyCode: 'GBP',
      debtLimitPence: -5000,
    });
    await setDoc(doc(db, 'users/parent'), {
      familyId: FAMILY_ID,
      role: 'parent',
      displayName: 'Parent',
    });
    await setDoc(doc(db, 'users/child'), {
      familyId: FAMILY_ID,
      role: 'child',
      displayName: 'Child',
      rewardPoints: 100,
      lifetimeXP: 0,
      walletBalance: 0,
    });
    await setDoc(doc(db, 'users/parent2'), {
      familyId: OTHER_FAMILY,
      role: 'parent',
      displayName: 'Parent2',
    });
    await setDoc(doc(db, 'users/child2'), {
      familyId: OTHER_FAMILY,
      role: 'child',
      displayName: 'Child2',
      rewardPoints: 5,
      lifetimeXP: 0,
      walletBalance: 0,
    });
    await setDoc(doc(db, `families/${FAMILY_ID}/rewards/toy`), {
      familyId: FAMILY_ID,
      title: 'Toy',
      cost: 10,
      active: true,
    });
    await setDoc(doc(db, `families/${FAMILY_ID}/rewards/expensive`), {
      familyId: FAMILY_ID,
      title: 'Expensive',
      cost: 1000,
      active: true,
    });
    await setDoc(doc(db, `families/${FAMILY_ID}/wallets/child`), { balance: 0 });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

const dbFor = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const anonDb = () => testEnv.unauthenticatedContext().firestore();

function behaviourEventDoc(type: string, pointsDelta: number, walletDelta: number) {
  return {
    familyId: FAMILY_ID,
    childId: 'child',
    type,
    reason: 'Because reasons are required here.',
    pointsDelta,
    walletDelta,
    createdBy: 'parent',
    createdByName: 'Parent',
    createdAt: serverTimestamp(),
    effectSnapshot: {
      schemaVersion: 1,
      entityType: 'behaviour_event',
      familyId: FAMILY_ID,
      actorId: 'parent',
      childId: 'child',
      pointsDelta,
      walletDeltaPence: walletDelta,
      xpAdjustment: 0,
    },
  };
}

describe('P0 — behaviour logging (parent → own child)', () => {
  it('1. parent can log positive behaviour for own child', async () => {
    const db = dbFor('parent');
    const ref = doc(collection(db, `families/${FAMILY_ID}/behaviour_events`));
    await assertSucceeds(setDoc(ref, behaviourEventDoc('positive', 1, 0)));
  });
  it('2. parent can log negative behaviour for own child', async () => {
    const db = dbFor('parent');
    const ref = doc(collection(db, `families/${FAMILY_ID}/behaviour_events`));
    await assertSucceeds(setDoc(ref, behaviourEventDoc('negative', -1, 0)));
  });
  it('3. parent can log financial penalty for own child', async () => {
    const db = dbFor('parent');
    const eventRef = doc(collection(db, `families/${FAMILY_ID}/behaviour_events`));
    const ledgerRef = doc(collection(db, `families/${FAMILY_ID}/wallet_transactions`));
    const walletRef = doc(db, `families/${FAMILY_ID}/wallets/child`);
    await assertSucceeds(
      runTransaction(db, async (tx) => {
        const walletDoc = await tx.get(walletRef);
        const balance = (walletDoc.data()?.balance ?? 0) - 100;
        tx.update(walletRef, { balance, lastPenaltyTxId: ledgerRef.id });
        tx.set(eventRef, behaviourEventDoc('financial', 0, -100));
        tx.set(ledgerRef, {
          type: 'financial_penalty',
          eventId: eventRef.id,
          sourceId: eventRef.id,
          familyId: FAMILY_ID,
          status: 'completed',
          childId: 'child',
          amount: 100,
          reason: 'Because reasons are required here.',
          createdBy: 'parent',
          createdByName: 'Parent',
          createdAt: serverTimestamp(),
          effectSnapshot: {
            schemaVersion: 1,
            entityType: 'behaviour_event',
            familyId: FAMILY_ID,
            actorId: 'parent',
            childId: 'child',
            walletDeltaPence: -100,
            xpAdjustment: 0,
          },
        });
      }),
    );
  });
  it('4. parent cannot log behaviour for another family’s child', async () => {
    const db = dbFor('parent');
    const ref = doc(collection(db, `families/${FAMILY_ID}/behaviour_events`));
    // child2 belongs to OTHER_FAMILY; isChildInFamily(FAMILY_ID, 'child2') is false.
    await assertFails(
      setDoc(ref, { ...behaviourEventDoc('positive', 1, 0), childId: 'child2' }),
    );
  });
  it('13a. child cannot log behaviour (parent/owner only)', async () => {
    const db = dbFor('child');
    const ref = doc(collection(db, `families/${FAMILY_ID}/behaviour_events`));
    await assertFails(setDoc(ref, behaviourEventDoc('positive', 1, 0)));
  });
});

describe('P0 — money request (child → parent, same family)', () => {
  it('5. child can create a money request to a parent in the same family', async () => {
    const db = dbFor('child');
    const reqRef = doc(collection(db, `families/${FAMILY_ID}/money_requests`));
    const feedRef = doc(collection(db, `families/${FAMILY_ID}/feed`));
    await assertSucceeds(
      runTransaction(db, async (tx) => {
        tx.set(reqRef, {
          familyId: FAMILY_ID,
          requesterId: 'child',
          requesterName: 'Child',
          requestedFromId: 'parent',
          requestedFromName: 'Parent',
          amountPence: 100,
          message: 'Please',
          status: 'pending',
          createdAt: serverTimestamp(),
        });
        tx.set(feedRef, {
          actorId: 'child',
          text: 'Child requested £1.00 from Parent.',
          entityType: 'money_request',
          entityId: reqRef.id,
          visibleTo: ['child', 'parent'],
          timestamp: serverTimestamp(),
        });
      }),
    );
  });
  it('6. child cannot request money from another family (wrong collection)', async () => {
    const db = dbFor('child');
    const ref = doc(collection(db, `families/${OTHER_FAMILY}/money_requests`));
    await assertFails(
      setDoc(ref, {
        familyId: OTHER_FAMILY,
        requesterId: 'child',
        requestedFromId: 'parent2',
        amountPence: 100,
        status: 'pending',
        createdAt: serverTimestamp(),
      }),
    );
  });
  it('6b. child cannot request money referencing a parent from another family', async () => {
    const db = dbFor('child');
    const ref = doc(collection(db, `families/${FAMILY_ID}/money_requests`));
    await assertFails(
      setDoc(ref, {
        familyId: FAMILY_ID,
        requesterId: 'child',
        requestedFromId: 'parent2', // belongs to OTHER_FAMILY
        amountPence: 100,
        status: 'pending',
        createdAt: serverTimestamp(),
      }),
    );
  });
  it('7. parent can read the money request', async () => {
    let reqId = '';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const d = ctx.firestore();
      const ref = doc(collection(d, `families/${FAMILY_ID}/money_requests`));
      reqId = ref.id;
      await setDoc(ref, {
        familyId: FAMILY_ID,
        requesterId: 'child',
        requestedFromId: 'parent',
        amountPence: 100,
        status: 'pending',
        createdAt: serverTimestamp(),
      });
    });
    const db = dbFor('parent');
    await assertSucceeds(getDoc(doc(db, `families/${FAMILY_ID}/money_requests/${reqId}`)));
  });
});

describe('P0 — reward redemption (child, sufficient points)', () => {
  it('8. child can redeem an active reward with sufficient points', async () => {
    const db = dbFor('child');
    const userRef = doc(db, 'users/child');
    const redemptionRef = doc(collection(db, `families/${FAMILY_ID}/redemptions`));
    const feedRef = doc(collection(db, `families/${FAMILY_ID}/feed`));
    await assertSucceeds(
      runTransaction(db, async (tx) => {
        const userDoc = await tx.get(userRef);
        const currentPoints = userDoc.data()?.rewardPoints ?? 0;
        const cost = 10;
        tx.update(userRef, {
          rewardPoints: currentPoints - cost,
          lastRedemptionId: redemptionRef.id,
        });
        tx.set(redemptionRef, {
          rewardId: 'toy',
          userId: 'child',
          costPaid: cost,
          redeemedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          status: 'completed',
          familyId: FAMILY_ID,
          sourceId: redemptionRef.id,
          actorId: 'child',
          effectSnapshot: {
            schemaVersion: 1,
            entityType: 'reward_redemption',
            familyId: FAMILY_ID,
            actorId: 'child',
            childId: 'child',
            rewardId: 'toy',
            pointsDelta: -cost,
            xpAdjustment: 0,
          },
        });
        tx.set(feedRef, {
          actorId: 'child',
          text: 'Redeemed reward: Toy',
          timestamp: serverTimestamp(),
        });
      }),
    );
  });
  it('9. child cannot redeem another child’s balance (userId mismatch)', async () => {
    const db = dbFor('child');
    const userRef = doc(db, 'users/child');
    const redemptionRef = doc(collection(db, `families/${FAMILY_ID}/redemptions`));
    await assertFails(
      runTransaction(db, async (tx) => {
        const userDoc = await tx.get(userRef);
        const currentPoints = userDoc.data()?.rewardPoints ?? 0;
        const cost = 10;
        tx.update(userRef, {
          rewardPoints: currentPoints - cost,
          lastRedemptionId: redemptionRef.id,
        });
        tx.set(redemptionRef, {
          rewardId: 'toy',
          userId: 'child2', // not the signed-in child
          costPaid: cost,
          redeemedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          status: 'completed',
          familyId: FAMILY_ID,
          sourceId: redemptionRef.id,
          actorId: 'child',
          effectSnapshot: {
            schemaVersion: 1,
            entityType: 'reward_redemption',
            familyId: FAMILY_ID,
            actorId: 'child',
            childId: 'child2',
            rewardId: 'toy',
            pointsDelta: -cost,
            xpAdjustment: 0,
          },
        });
      }),
    );
  });
  it('9b. child from another family cannot redeem this family’s reward', async () => {
    const db = dbFor('child2');
    const userRef = doc(db, 'users/child2');
    const redemptionRef = doc(collection(db, `families/${FAMILY_ID}/redemptions`));
    await assertFails(
      runTransaction(db, async (tx) => {
        const userDoc = await tx.get(userRef);
        const currentPoints = userDoc.data()?.rewardPoints ?? 0;
        const cost = 10;
        tx.update(userRef, {
          rewardPoints: currentPoints - cost,
          lastRedemptionId: redemptionRef.id,
        });
        tx.set(redemptionRef, {
          rewardId: 'toy',
          userId: 'child2',
          costPaid: cost,
          redeemedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          status: 'completed',
          familyId: FAMILY_ID,
          sourceId: redemptionRef.id,
          actorId: 'child2',
          effectSnapshot: {
            schemaVersion: 1,
            entityType: 'reward_redemption',
            familyId: FAMILY_ID,
            actorId: 'child2',
            childId: 'child2',
            rewardId: 'toy',
            pointsDelta: -cost,
            xpAdjustment: 0,
          },
        });
      }),
    );
  });
  it('10. insufficient points fails without any partial write', async () => {
    const db = dbFor('child');
    const userRef = doc(db, 'users/child');
    const redemptionRef = doc(collection(db, `families/${FAMILY_ID}/redemptions`));
    const feedRef = doc(collection(db, `families/${FAMILY_ID}/feed`));
    await assertFails(
      runTransaction(db, async (tx) => {
        const userDoc = await tx.get(userRef);
        const currentPoints = userDoc.data()?.rewardPoints ?? 0;
        const cost = 1000; // child only has 100
        tx.update(userRef, {
          rewardPoints: currentPoints - cost,
          lastRedemptionId: redemptionRef.id,
        });
        tx.set(redemptionRef, {
          rewardId: 'expensive',
          userId: 'child',
          costPaid: cost,
          redeemedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          status: 'completed',
          familyId: FAMILY_ID,
          sourceId: redemptionRef.id,
          actorId: 'child',
          effectSnapshot: {
            schemaVersion: 1,
            entityType: 'reward_redemption',
            familyId: FAMILY_ID,
            actorId: 'child',
            childId: 'child',
            rewardId: 'expensive',
            pointsDelta: -cost,
            xpAdjustment: 0,
          },
        });
        tx.set(feedRef, { actorId: 'child', text: 'x', timestamp: serverTimestamp() });
      }),
    );
    const after = await getDoc(userRef);
    expect(after.data()?.rewardPoints).toBe(100); // unchanged
  });
  it('11. duplicate redemption (same id) does not deduct twice', async () => {
    const db = dbFor('child');
    const userRef = doc(db, 'users/child');
    const redemptionRef = doc(collection(db, `families/${FAMILY_ID}/redemptions`));
    const feedRef = doc(collection(db, `families/${FAMILY_ID}/feed`));
    const doRedeem = () =>
      runTransaction(db, async (tx) => {
        const userDoc = await tx.get(userRef);
        const currentPoints = userDoc.data()?.rewardPoints ?? 0;
        const cost = 10;
        tx.update(userRef, {
          rewardPoints: currentPoints - cost,
          lastRedemptionId: redemptionRef.id,
        });
        tx.set(redemptionRef, {
          rewardId: 'toy',
          userId: 'child',
          costPaid: cost,
          redeemedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          status: 'completed',
          familyId: FAMILY_ID,
          sourceId: redemptionRef.id,
          actorId: 'child',
          effectSnapshot: {
            schemaVersion: 1,
            entityType: 'reward_redemption',
            familyId: FAMILY_ID,
            actorId: 'child',
            childId: 'child',
            rewardId: 'toy',
            pointsDelta: -cost,
            xpAdjustment: 0,
          },
        });
        tx.set(feedRef, { actorId: 'child', text: 'x', timestamp: serverTimestamp() });
      });
    await assertSucceeds(doRedeem()); // first succeeds
    await assertFails(doRedeem()); // retry with same id is denied (idempotent)
    const after = await getDoc(userRef);
    expect(after.data()?.rewardPoints).toBe(90); // deducted exactly once
  });
});

describe('P0 — unauthenticated & role boundaries', () => {
  it('12. unauthenticated access fails', async () => {
    const db = anonDb();
    const ref = doc(collection(db, `families/${FAMILY_ID}/behaviour_events`));
    await assertFails(setDoc(ref, behaviourEventDoc('positive', 1, 0)));
  });
  it('13b. parent cannot redeem a reward (child-only action)', async () => {
    const db = dbFor('parent');
    const userRef = doc(db, 'users/parent');
    const redemptionRef = doc(collection(db, `families/${FAMILY_ID}/redemptions`));
    await assertFails(
      runTransaction(db, async (tx) => {
        const userDoc = await tx.get(userRef);
        const currentPoints = userDoc.data()?.rewardPoints ?? 0;
        const cost = 10;
        tx.update(userRef, {
          rewardPoints: currentPoints - cost,
          lastRedemptionId: redemptionRef.id,
        });
        tx.set(redemptionRef, {
          rewardId: 'toy',
          userId: 'parent',
          costPaid: cost,
          redeemedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          status: 'completed',
          familyId: FAMILY_ID,
          sourceId: redemptionRef.id,
          actorId: 'parent',
          effectSnapshot: {
            schemaVersion: 1,
            entityType: 'reward_redemption',
            familyId: FAMILY_ID,
            actorId: 'parent',
            childId: 'parent',
            rewardId: 'toy',
            pointsDelta: -cost,
            xpAdjustment: 0,
          },
        });
      }),
    );
  });
});
