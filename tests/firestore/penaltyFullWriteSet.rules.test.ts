/**
 * P0 REGRESSION — FULL PRODUCTION PENALTY WRITE SET (five documents).
 *
 * Reproduces the EXACT atomic commit performed by `addBehaviourEvent()`
 * (src/lib/api.ts) for a `financial` behaviour event:
 *
 *   1. families/{familyId}/wallets/{childId}                 (update)
 *   2. families/{familyId}/behaviour_events/{eventId}        (create)
 *   3. families/{familyId}/wallet_transactions/{txId}        (create)
 *   4. families/{familyId}/feed/{feedId}                     (create)
 *   5. families/{familyId}/notifications/{notificationId}    (create)
 *
 * Firestore evaluates every document of an atomic commit under ONE shared
 * 1000-expression budget, so a reduced three-document test does NOT reproduce
 * production. This suite therefore always writes the complete five-document
 * set, with production-equivalent document shapes and IDs.
 */
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
import type { Firestore } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const FAMILY_ID = 'penalty-family';
const OTHER_FAMILY = 'penalty-other-family';
const CHILD_ID = 'penalty-child';
const PENALTY_PENCE = 250;

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-penalty-fullset',
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
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `families/${FAMILY_ID}`), {
      name: 'Penalty family',
      currencyCode: 'GBP',
      debtLimitPence: -5000,
      lifecycleState: 'active',
    });
    await setDoc(doc(db, `families/${OTHER_FAMILY}`), {
      name: 'Other family',
      currencyCode: 'GBP',
      debtLimitPence: -5000,
      lifecycleState: 'active',
    });
    await setDoc(doc(db, 'users/parent'), {
      familyId: FAMILY_ID, role: 'parent', displayName: 'Parent',
    });
    await setDoc(doc(db, 'users/owner'), {
      familyId: FAMILY_ID, role: 'owner', displayName: 'Owner',
    });
    await setDoc(doc(db, `users/${CHILD_ID}`), {
      familyId: FAMILY_ID, role: 'child', displayName: 'Child',
      rewardPoints: 100, lifetimeXP: 0,
    });
    await setDoc(doc(db, 'users/foreign-parent'), {
      familyId: OTHER_FAMILY, role: 'parent', displayName: 'Foreign Parent',
    });
    await setDoc(doc(db, 'users/foreign-owner'), {
      familyId: OTHER_FAMILY, role: 'owner', displayName: 'Foreign Owner',
    });
    await setDoc(doc(db, `families/${FAMILY_ID}/wallets/${CHILD_ID}`), { balance: 1000 });
  });
});

const dbFor = (uid: string) => testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;

interface PenaltyOverrides {
  /** Balance actually written to the wallet (defaults to old balance - amount). */
  walletBalance?: number;
  /** Amount written on the ledger leg (defaults to the penalty amount). */
  ledgerAmount?: number;
  /** Skip the behaviour_events create (case 8). */
  omitEvent?: boolean;
  /** Write a ledger eventId that does not match the behaviour event id (case 9). */
  mismatchedEventId?: string;
  /** Force a specific wallet_transactions document id (case 10). */
  ledgerId?: string;
}

/**
 * Performs the EXACT production five-document penalty commit.
 * Mirrors addBehaviourEvent() field-for-field.
 */
async function commitPenalty(
  db: Firestore,
  actorId: string,
  actorName: string,
  familyId: string,
  childId: string,
  overrides: PenaltyOverrides = {},
) {
  const eventRef = doc(collection(db, `families/${familyId}/behaviour_events`));
  const ledgerRef = overrides.ledgerId
    ? doc(db, `families/${familyId}/wallet_transactions/${overrides.ledgerId}`)
    : doc(collection(db, `families/${familyId}/wallet_transactions`));
  const feedRef = doc(collection(db, `families/${familyId}/feed`));
  const walletRef = doc(db, `families/${familyId}/wallets/${childId}`);
  const notificationId = `behaviour_${eventRef.id}`;
  const notificationRef = doc(db, `families/${familyId}/notifications/${notificationId}`);
  const reason = 'Broken headphones';
  const walletDelta = -PENALTY_PENCE;

  await runTransaction(db, async (tx) => {
    // --- READ STAGE (identical ordering to production) ---
    const walletDoc = await tx.get(walletRef);
    await tx.get(notificationRef);
    const oldBalance = (walletDoc.data()?.balance as number | undefined) ?? 0;
    const balance = overrides.walletBalance ?? oldBalance + walletDelta;

    // --- WRITE STAGE (five documents, one atomic commit) ---
    // 1. wallet
    tx.update(walletRef, { balance, lastPenaltyTxId: ledgerRef.id });

    // 2. behaviour event
    if (!overrides.omitEvent) {
      tx.set(eventRef, {
        familyId,
        childId,
        type: 'financial',
        reason,
        pointsDelta: 0,
        walletDelta,
        createdBy: actorId,
        createdByName: actorName,
        createdAt: serverTimestamp(),
        effectSnapshot: {
          schemaVersion: 1,
          entityType: 'behaviour_event',
          familyId,
          actorId,
          childId,
          pointsDelta: 0,
          walletDeltaPence: walletDelta,
          xpAdjustment: 0,
        },
      });
    }

    // 3. wallet transaction (ledger leg)
    tx.set(ledgerRef, {
      type: 'financial_penalty',
      eventId: overrides.mismatchedEventId ?? eventRef.id,
      sourceId: overrides.mismatchedEventId ?? eventRef.id,
      familyId,
      status: 'completed',
      childId,
      amount: overrides.ledgerAmount ?? PENALTY_PENCE,
      reason,
      createdBy: actorId,
      createdByName: actorName,
      createdAt: serverTimestamp(),
      effectSnapshot: {
        schemaVersion: 1,
        entityType: 'behaviour_event',
        familyId,
        actorId,
        childId,
        walletDeltaPence: walletDelta,
        xpAdjustment: 0,
      },
    });

    // 4. feed
    const feedTimestamp = serverTimestamp();
    tx.set(feedRef, {
      type: 'behaviour',
      behaviourType: 'financial',
      reason,
      pointsDelta: 0,
      walletDelta,
      childId,
      actorId,
      actorName,
      text: `Logged behaviour for Child: ${reason} (-£2.50)`,
      createdAt: feedTimestamp,
      timestamp: feedTimestamp,
    });

    // 5. notification
    tx.set(notificationRef, {
      familyId,
      type: 'behaviour_negative',
      actorId,
      recipientIds: [childId],
      title: 'Behaviour noted',
      body: reason,
      metadata: {},
      entityType: 'behaviour_event',
      entityId: eventRef.id,
      actionUrl: `/family/${childId}`,
      dedupeKey: notificationId,
      createdAt: serverTimestamp(),
    });
  });

  return { eventRef, ledgerRef, feedRef, walletRef, notificationRef };
}

describe('P0 — full five-document production penalty commit', () => {
  it('1. same-family PARENT penalty → ALLOW (full write set)', async () => {
    await assertSucceeds(
      commitPenalty(dbFor('parent'), 'parent', 'Parent', FAMILY_ID, CHILD_ID),
    );
  });

  it('2. same-family OWNER penalty → ALLOW (full write set)', async () => {
    await assertSucceeds(
      commitPenalty(dbFor('owner'), 'owner', 'Owner', FAMILY_ID, CHILD_ID),
    );
  });

  it('3. CHILD actor penalty → DENY', async () => {
    await assertFails(
      commitPenalty(dbFor(CHILD_ID), CHILD_ID, 'Child', FAMILY_ID, CHILD_ID),
    );
  });

  it('4. cross-family PARENT penalty → DENY', async () => {
    await assertFails(
      commitPenalty(dbFor('foreign-parent'), 'foreign-parent', 'Foreign Parent', FAMILY_ID, CHILD_ID),
    );
  });

  it('5. cross-family OWNER penalty → DENY', async () => {
    await assertFails(
      commitPenalty(dbFor('foreign-owner'), 'foreign-owner', 'Foreign Owner', FAMILY_ID, CHILD_ID),
    );
  });

  it('6. invalid wallet balance change (delta ≠ penalty) → DENY', async () => {
    await assertFails(
      commitPenalty(dbFor('parent'), 'parent', 'Parent', FAMILY_ID, CHILD_ID, {
        walletBalance: 1, // arbitrary drain, not 1000 - 250
      }),
    );
  });

  it('7. invalid ledger delta (ledger amount ≠ wallet delta) → DENY', async () => {
    await assertFails(
      commitPenalty(dbFor('parent'), 'parent', 'Parent', FAMILY_ID, CHILD_ID, {
        ledgerAmount: PENALTY_PENCE + 100,
      }),
    );
  });

  it('8. missing behaviour event → DENY', async () => {
    await assertFails(
      commitPenalty(dbFor('parent'), 'parent', 'Parent', FAMILY_ID, CHILD_ID, {
        omitEvent: true,
      }),
    );
  });

  it('9. mismatched operation/entity IDs (ledger eventId ≠ event id) → DENY', async () => {
    await assertFails(
      commitPenalty(dbFor('parent'), 'parent', 'Parent', FAMILY_ID, CHILD_ID, {
        mismatchedEventId: 'not-the-event-id',
      }),
    );
  });

  it('10. duplicate transaction ID → DENY', async () => {
    const dupId = 'duplicate-penalty-tx';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), `families/${FAMILY_ID}/wallet_transactions/${dupId}`),
        { type: 'financial_penalty', familyId: FAMILY_ID, childId: CHILD_ID, amount: PENALTY_PENCE },
      );
    });
    await assertFails(
      commitPenalty(dbFor('parent'), 'parent', 'Parent', FAMILY_ID, CHILD_ID, {
        ledgerId: dupId,
      }),
    );
  });

  it('11. partial commit failure rolls back EVERY document', async () => {
    let before: number | undefined;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), `families/${FAMILY_ID}/wallets/${CHILD_ID}`));
      before = snap.data()?.balance as number;
    });
    expect(before).toBe(1000);

    // The behaviour event is omitted → the ledger leg is denied → the WHOLE
    // atomic commit must be rejected, leaving no wallet/feed/notification writes.
    await assertFails(
      commitPenalty(dbFor('parent'), 'parent', 'Parent', FAMILY_ID, CHILD_ID, {
        omitEvent: true,
      }),
    );

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const wallet = await getDoc(doc(db, `families/${FAMILY_ID}/wallets/${CHILD_ID}`));
      expect(wallet.data()?.balance).toBe(before);
      expect(wallet.data()?.lastPenaltyTxId).toBeUndefined();
      const { getDocs } = await import('firebase/firestore');
      for (const path of ['behaviour_events', 'wallet_transactions', 'feed', 'notifications']) {
        const docs = await getDocs(collection(db, `families/${FAMILY_ID}/${path}`));
        expect(docs.size, `${path} must be empty after rollback`).toBe(0);
      }
    });
  });

  it('12. full five-document OWNER commit does not hit expression-budget overflow', async () => {
    const refs = await commitPenalty(dbFor('owner'), 'owner', 'Owner', FAMILY_ID, CHILD_ID);

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const wallet = await getDoc(doc(db, `families/${FAMILY_ID}/wallets/${CHILD_ID}`));
      expect(wallet.data()?.balance).toBe(1000 - PENALTY_PENCE);
      expect(wallet.data()?.lastPenaltyTxId).toBe(refs.ledgerRef.id);
      for (const ref of [refs.eventRef, refs.ledgerRef, refs.feedRef, refs.notificationRef]) {
        const snap = await getDoc(doc(db, ref.path));
        expect(snap.exists(), `${ref.path} must exist`).toBe(true);
      }
    });
  });
});
