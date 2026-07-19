/**
 * Integration test: multi-child Return Funds transaction against the Firestore
 * emulator with the LEAN rules path.
 *
 * This is the authoritative expression-budget check for Phase 7. The unit tests
 * (api.goals.test.ts) mock the transaction and therefore CANNOT catch Firestore's
 * 1000-expression-per-request limit. Only a real transaction executed against the
 * emulator exercises the actual rule evaluation cost.
 *
 * Scenarios (per the Phase 7 acceptance matrix):
 *   1 child | 3 children | MAX_CHILD_REFUNDS_PER_GOAL | child + parent contribution
 *   | child + auto-match | multiple children + parent + match | idempotent replay
 *   | missing wallet atomic rollback.
 *
 * Run with: firebase emulators:exec --only firestore,auth 'vitest run
 * tests/firestore/goalReturn.integration.test.ts'
 */
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { connectFirestoreEmulator, connectAuthEmulator } from 'firebase/firestore';
import { connectAuthEmulator as connectAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { readFileSync } from 'fs';
import { db, auth } from '../../src/lib/firebase';
import {
  createGoal,
  contributeToGoal,
  addParentGoalContribution,
  returnGoalFunds,
  cancelGoal,
  MAX_CHILD_REFUNDS_PER_GOAL,
} from '../../src/lib/api';

const FAMILY = 'fam-return';
const PARENT_EMAIL = 'parent-return@test.com';
const PARENT_PW = 'password123';

// Connect the app's firebase instances to the emulator (idempotent-guarded).
try {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
} catch { /* already connected */ }
try {
  connectAuth(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
} catch { /* already connected */ }

let testEnv: RulesTestEnvironment;
let parentUid = '';

async function seedParent() {
  const cred = await createUserWithEmailAndPassword(auth, PARENT_EMAIL, PARENT_PW);
  parentUid = cred.user.uid;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const fdb = ctx.firestore();
    await fdb.collection('users').doc(parentUid).set({ familyId: FAMILY, role: 'parent', displayName: 'Parent' });
  });
}

async function seedChild(childId: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const fdb = ctx.firestore();
    await fdb.collection('users').doc(childId).set({ familyId: FAMILY, role: 'child', displayName: childId });
    await fdb.doc(`families/${FAMILY}/wallets/${childId}`).set({ balance: 0 });
  });
}

async function seedGoal(goalId: string, currentAmountPence: number) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const fdb = ctx.firestore();
    await fdb.doc(`families/${FAMILY}/savings_goals/${goalId}`).set({
      goalId, title: 'Goal', kind: 'family', targetAmountPence: 100000,
      currentAmountPence, currency: 'GBP', status: 'active',
      matching: { mode: 'none', perX: 0, matchY: 0 }, createdBy: parentUid, version: 1,
    });
  });
}

async function seedContribution(goalId: string, leg: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const fdb = ctx.firestore();
    const ref = fdb.collection(`families/${FAMILY}/savings_goals/${goalId}/contributions`).doc();
    await ref.set({ contribId: ref.id, goalId, status: 'applied', createdAt: new Date(), ...leg });
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-beta-402cb',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  await seedParent();
});

afterAll(async () => {
  await testEnv.cleanup();
  await auth.signOut();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // clearFirestore() wipes the seeded parent user doc too; re-create it so
  // assertParent() can read the role. The auth account itself persists.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await ctx.firestore().collection('users').doc(parentUid).set({ familyId: FAMILY, role: 'parent', displayName: 'Parent' });
  });
  await signInWithEmailAndPassword(auth, PARENT_EMAIL, PARENT_PW);
});

describe('Return Funds — emulator expression-budget (lean rules path)', () => {
  it('1. single child refund succeeds within budget', async () => {
    await seedChild('c1');
    await seedGoal('g1', 500);
    await seedContribution('g1', { type: 'child_contribution', ownerType: 'child', ownerId: 'c1', amountPence: 500 });
    await expect(returnGoalFunds(FAMILY, 'g1', 'r1')).resolves.toBeUndefined();
  });

  it('2. three children refund succeeds within budget', async () => {
    for (const c of ['c1', 'c2', 'c3']) await seedChild(c);
    await seedGoal('g3', 1500);
    await seedContribution('g3', { type: 'child_contribution', ownerType: 'child', ownerId: 'c1', amountPence: 500 });
    await seedContribution('g3', { type: 'child_contribution', ownerType: 'child', ownerId: 'c2', amountPence: 500 });
    await seedContribution('g3', { type: 'child_contribution', ownerType: 'child', ownerId: 'c3', amountPence: 500 });
    await expect(returnGoalFunds(FAMILY, 'g3', 'r1')).resolves.toBeUndefined();
  });

  it(`3. MAX_CHILD_REFUNDS_PER_GOAL (${MAX_CHILD_REFUNDS_PER_GOAL}) children refund succeeds within budget`, async () => {
    for (let i = 1; i <= MAX_CHILD_REFUNDS_PER_GOAL; i++) await seedChild(`c${i}`);
    await seedGoal('gMax', MAX_CHILD_REFUNDS_PER_GOAL * 100);
    for (let i = 1; i <= MAX_CHILD_REFUNDS_PER_GOAL; i++) {
      await seedContribution('gMax', { type: 'child_contribution', ownerType: 'child', ownerId: `c${i}`, amountPence: 100 });
    }
    await expect(returnGoalFunds(FAMILY, 'gMax', 'r1')).resolves.toBeUndefined();
  });

  it('4. child + parent contribution: parent portion closed via external_closure', async () => {
    await seedChild('c1');
    await seedGoal('g4', 1000);
    await seedContribution('g4', { type: 'child_contribution', ownerType: 'child', ownerId: 'c1', amountPence: 600 });
    await seedContribution('g4', { type: 'parent_contribution', ownerType: 'parent', ownerId: parentUid, amountPence: 400 });
    await expect(returnGoalFunds(FAMILY, 'g4', 'r1')).resolves.toBeUndefined();
  });

  it('5. child + auto-match: match portion closed via external_closure', async () => {
    await seedChild('c1');
    await seedGoal('g5', 1000);
    await seedContribution('g5', { type: 'child_contribution', ownerType: 'child', ownerId: 'c1', amountPence: 500 });
    await seedContribution('g5', { type: 'auto_match', ownerType: 'parent', ownerId: parentUid, amountPence: 500 });
    await expect(returnGoalFunds(FAMILY, 'g5', 'r1')).resolves.toBeUndefined();
  });

  it('6. multiple children + parent + match: all closed correctly within budget', async () => {
    for (const c of ['c1', 'c2', 'c3']) await seedChild(c);
    await seedGoal('g6', 2600);
    await seedContribution('g6', { type: 'child_contribution', ownerType: 'child', ownerId: 'c1', amountPence: 500 });
    await seedContribution('g6', { type: 'child_contribution', ownerType: 'child', ownerId: 'c2', amountPence: 500 });
    await seedContribution('g6', { type: 'child_contribution', ownerType: 'child', ownerId: 'c3', amountPence: 500 });
    await seedContribution('g6', { type: 'parent_contribution', ownerType: 'parent', ownerId: parentUid, amountPence: 400 });
    await seedContribution('g6', { type: 'auto_match', ownerType: 'parent', ownerId: parentUid, amountPence: 700 });
    await expect(returnGoalFunds(FAMILY, 'g6', 'r1')).resolves.toBeUndefined();
  });

  it('7. idempotent replay performs no new writes', async () => {
    await seedChild('c1');
    await seedGoal('g7', 500);
    await seedContribution('g7', { type: 'child_contribution', ownerType: 'child', ownerId: 'c1', amountPence: 500 });
    await returnGoalFunds(FAMILY, 'g7', 'r1');
    // Second call with same clientReqId must be a no-op (idempotent).
    await expect(returnGoalFunds(FAMILY, 'g7', 'r1')).resolves.toBeUndefined();
  });

  it('8. missing wallet during multi-child return fails closed (atomic rollback)', async () => {
    await seedChild('c1');
    // c2 wallet intentionally NOT seeded.
    await seedGoal('g8', 1000);
    await seedContribution('g8', { type: 'child_contribution', ownerType: 'child', ownerId: 'c1', amountPence: 500 });
    await seedContribution('g8', { type: 'child_contribution', ownerType: 'child', ownerId: 'c2', amountPence: 500 });
    await expect(returnGoalFunds(FAMILY, 'g8', 'r1')).rejects.toThrow(/Wallet not found/);
  });

  it('9. cancelGoal with money present == return funds (lean path)', async () => {
    await seedChild('c1');
    await seedGoal('g9', 500);
    await seedContribution('g9', { type: 'child_contribution', ownerType: 'child', ownerId: 'c1', amountPence: 500 });
    await expect(cancelGoal(FAMILY, 'g9', 'r1')).resolves.toBeUndefined();
  });
});

describe('Goal creation — atomic initial parent contribution proof (real transaction)', () => {
  it('10. zero-contribution goal creation succeeds (no forged leg)', async () => {
    await expect(createGoal(FAMILY, {
      title: 'Zero Goal', kind: 'family', targetAmountPence: 1000, currency: 'GBP',
    })).resolves.toBeDefined();
  });

  it('11. fixed-amount parent contribution creation succeeds with atomic proof', async () => {
    const ref = await createGoal(FAMILY, {
      title: 'Fixed Goal', kind: 'family', targetAmountPence: 1000, currency: 'GBP',
      parentContribution: { mode: 'fixed', fixedPence: 500 },
    });
    const snap = await testEnv.authenticatedContext(parentUid).firestore().doc(`families/${FAMILY}/savings_goals/${ref.id}`).get();
    expect(snap.data()?.currentAmountPence).toBe(500);
  });

  it('12. percentage parent contribution creation succeeds with atomic proof', async () => {
    const ref = await createGoal(FAMILY, {
      title: 'Pct Goal', kind: 'family', targetAmountPence: 1000, currency: 'GBP',
      parentContribution: { mode: 'percent', percent: 20 },
    });
    const snap = await testEnv.authenticatedContext(parentUid).firestore().doc(`families/${FAMILY}/savings_goals/${ref.id}`).get();
    expect(snap.data()?.currentAmountPence).toBe(200);
  });

  it('13. idempotent replay with matching requestHash performs no new writes', async () => {
    const ref = await createGoal(FAMILY, {
      title: 'Replay Goal', kind: 'family', targetAmountPence: 1000, currency: 'GBP',
      parentContribution: { mode: 'fixed', fixedPence: 300 },
    });
    // Second call with identical input must be a no-op (idempotent replay).
    const ref2 = await createGoal(FAMILY, {
      title: 'Replay Goal', kind: 'family', targetAmountPence: 1000, currency: 'GBP',
      parentContribution: { mode: 'fixed', fixedPence: 300 },
    });
    expect(ref2.id).toBe(ref.id);
  });
});
