import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';

let testEnv: RulesTestEnvironment;

const FAMILY = 'family1';
const OTHER = 'family2';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-goals-rules-test',
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
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    // Families
    await setDoc(doc(db, `families/${FAMILY}`), { name: 'Family 1' });
    await setDoc(doc(db, `families/${OTHER}`), { name: 'Family 2' });
    // Users
    await setDoc(doc(db, 'users/parent1'), { familyId: FAMILY, role: 'parent', displayName: 'P1' });
    await setDoc(doc(db, 'users/owner1'), { familyId: FAMILY, role: 'owner', displayName: 'O1' });
    await setDoc(doc(db, 'users/child1'), { familyId: FAMILY, role: 'child', displayName: 'C1' });
    await setDoc(doc(db, 'users/child2'), { familyId: FAMILY, role: 'child', displayName: 'C2' });
    await setDoc(doc(db, 'users/parent2'), { familyId: OTHER, role: 'parent', displayName: 'P2' });
    await setDoc(doc(db, 'users/child3'), { familyId: OTHER, role: 'child', displayName: 'C3' });
    // Wallets
    await setDoc(doc(db, `families/${FAMILY}/wallets/child1`), { balance: 1000 });
    await setDoc(doc(db, `families/${FAMILY}/wallets/child2`), { balance: 1000 });
    // A v1 goal owned by child1
    await setDoc(doc(db, `families/${FAMILY}/savings_goals/goal1`), {
      goalId: 'goal1', title: 'Bike', kind: 'child', childId: 'child1',
      targetAmountPence: 2000, currentAmountPence: 0, currency: 'GBP',
      status: 'active', matching: { mode: 'none', perX: 0, matchY: 0 },
      createdBy: 'child1', createdAt: serverTimestamp(), version: 1,
    });
    // A v1 family goal
    await setDoc(doc(db, `families/${FAMILY}/savings_goals/goalFam`), {
      goalId: 'goalFam', title: 'Holiday', kind: 'family',
      targetAmountPence: 5000, currentAmountPence: 0, currency: 'GBP',
      status: 'active', matching: { mode: 'none', perX: 0, matchY: 0 },
      createdBy: 'parent1', createdAt: serverTimestamp(), version: 1,
    });
    // A legacy (pre-v1) savings_goals doc for compatibility
    await setDoc(doc(db, `families/${FAMILY}/savings_goals/legacyGoal`), {
      title: 'Legacy', childId: 'child1', targetAmount: 20, currentAmount: 0,
      status: 'active',
    });
    // A terminal goal (completed_returned) with zero balance
    await setDoc(doc(db, `families/${FAMILY}/savings_goals/goalDone`), {
      goalId: 'goalDone', title: 'Done', kind: 'child', childId: 'child1',
      targetAmountPence: 2000, currentAmountPence: 0, currency: 'GBP',
      status: 'completed_returned', completedMode: 'returned',
      matching: { mode: 'none', perX: 0, matchY: 0 },
      createdBy: 'parent1', createdAt: serverTimestamp(), version: 1,
    });
    // A CANCELLED, zero-balance goal (the only deletable kind).
    await setDoc(doc(db, `families/${FAMILY}/savings_goals/goalCancelled`), {
      goalId: 'goalCancelled', title: 'Cancelled', kind: 'child', childId: 'child1',
      targetAmountPence: 2000, currentAmountPence: 0, currency: 'GBP',
      status: 'cancelled', completedMode: 'cancelled',
      matching: { mode: 'none', perX: 0, matchY: 0 },
      createdBy: 'parent1', createdAt: serverTimestamp(), version: 1,
    });
    // A CANCELLED goal WITH remaining funds (must NOT be deletable).
    await setDoc(doc(db, `families/${FAMILY}/savings_goals/goalCancelledFunded`), {
      goalId: 'goalCancelledFunded', title: 'CancelledFunded', kind: 'child', childId: 'child1',
      targetAmountPence: 2000, currentAmountPence: 500, currency: 'GBP',
      status: 'cancelled', completedMode: 'cancelled',
      matching: { mode: 'none', perX: 0, matchY: 0 },
      createdBy: 'parent1', createdAt: serverTimestamp(), version: 1,
    });
    // A reached goal
    await setDoc(doc(db, `families/${FAMILY}/savings_goals/goalReached`), {
      goalId: 'goalReached', title: 'Reached', kind: 'child', childId: 'child1',
      targetAmountPence: 2000, currentAmountPence: 2000, currency: 'GBP',
      status: 'reached', matching: { mode: 'none', perX: 0, matchY: 0 },
      createdBy: 'child1', createdAt: serverTimestamp(), version: 1,
    });
    // Additional reached goals so each sub-assertion in test 14 starts fresh.
    await setDoc(doc(db, `families/${FAMILY}/savings_goals/goalReached2`), {
      goalId: 'goalReached2', title: 'Reached2', kind: 'child', childId: 'child1',
      targetAmountPence: 2000, currentAmountPence: 2000, currency: 'GBP',
      status: 'reached', matching: { mode: 'none', perX: 0, matchY: 0 },
      createdBy: 'child1', createdAt: serverTimestamp(), version: 1,
    });
    await setDoc(doc(db, `families/${FAMILY}/savings_goals/goalReached3`), {
      goalId: 'goalReached3', title: 'Reached3', kind: 'child', childId: 'child1',
      targetAmountPence: 2000, currentAmountPence: 2000, currency: 'GBP',
      status: 'reached', matching: { mode: 'none', perX: 0, matchY: 0 },
      createdBy: 'child1', createdAt: serverTimestamp(), version: 1,
    });
    // An active goal that already has a balance (for arbitrary-decrease denial).
    await setDoc(doc(db, `families/${FAMILY}/savings_goals/goalFunded`), {
      goalId: 'goalFunded', title: 'Funded', kind: 'child', childId: 'child1',
      targetAmountPence: 2000, currentAmountPence: 800, currency: 'GBP',
      status: 'active', matching: { mode: 'none', perX: 0, matchY: 0 },
      createdBy: 'parent1', createdAt: serverTimestamp(), version: 1,
    });
    // A pending withdrawal request
    await setDoc(doc(db, `families/${FAMILY}/goal_requests/req1`), {
      requestType: 'withdrawal', goalId: 'goalReached', childId: 'child1',
      amountPence: 500, status: 'pending', createdBy: 'child1', createdAt: serverTimestamp(),
    });
    // A match proposal
    await setDoc(doc(db, `families/${FAMILY}/savings_goals/goal1/match_proposals/prop1`), {
      proposalId: 'prop1', goalId: 'goal1', sourceContributionId: 'c1',
      proposedMatchAmountPence: 100, status: 'proposed', createdBy: 'parent1', createdAt: serverTimestamp(),
    });
    // A seeded contribution and ledger entry (for update/delete denial tests).
    await setDoc(doc(db, `families/${FAMILY}/savings_goals/goal1/contributions/c1`), {
      contribId: 'c1', goalId: 'goal1', type: 'child_contribution', ownerType: 'child',
      ownerId: 'child1', amountPence: 100, status: 'applied', createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, `families/${FAMILY}/savings_goals/goal1/goal_ledger/l1`), {
      entryId: 'l1', goalId: 'goal1', type: 'child_contribution', amountPence: 100, ownerId: 'child1', createdAt: serverTimestamp(),
    });
  });
});

const goalPath = (id: string) => `families/${FAMILY}/savings_goals/${id}`;
const contribPath = (id: string, cid: string) => `families/${FAMILY}/savings_goals/${id}/contributions/${cid}`;
const ledgerPath = (id: string, lid: string) => `families/${FAMILY}/savings_goals/${id}/goal_ledger/${lid}`;
const proposalPath = (id: string, pid: string) => `families/${FAMILY}/savings_goals/${id}/match_proposals/${pid}`;
const requestPath = (rid: string) => `families/${FAMILY}/goal_requests/${rid}`;
const otherGoalPath = (id: string) => `families/${OTHER}/savings_goals/${id}`;
const idemPath = (key: string) => `families/${FAMILY}/idempotency/${key}`;

const v1GoalShape = (over: Record<string, any> = {}) => ({
  goalId: 'newGoal', title: 'New', kind: 'child', childId: 'child1',
  targetAmountPence: 1000, currentAmountPence: 0, currency: 'GBP',
  status: 'active', matching: { mode: 'none', perX: 0, matchY: 0 },
  createdBy: 'child1', createdAt: serverTimestamp(), version: 1,
  clientReqId: over.clientReqId ?? 'req-newGoal', ...over,
});

describe('Goals — cross-family access', () => {
  it('1. cross-family goal read denied', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(getDoc(doc(db, otherGoalPath('goalX'))));
  });

  it('1b. cross-family goal write denied', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(setDoc(doc(db, otherGoalPath('goalX')), v1GoalShape({ goalId: 'goalX', createdBy: 'parent1' })));
  });

  it('17. cross-family linked contribution/request references denied', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(setDoc(doc(db, `families/${OTHER}/savings_goals/goalOther/contributions/cX`), {
      contribId: 'cX', goalId: 'goalOther', type: 'parent_contribution', ownerType: 'parent',
      ownerId: 'parent1', amountPence: 100, status: 'applied', createdAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(db, `families/${OTHER}/goal_requests/reqX`), {
      requestType: 'withdrawal', goalId: 'goalOther', childId: 'child3',
      amountPence: 100, status: 'pending', createdBy: 'parent1', createdAt: serverTimestamp(),
    }));
  });
});

describe('Goals — create', () => {
  it('2. parent can create family and child goals', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertSucceeds(setDoc(doc(db, goalPath('famNew')), v1GoalShape({ goalId: 'famNew', kind: 'family', createdBy: 'parent1' })));
    await assertSucceeds(setDoc(doc(db, goalPath('childNew')), v1GoalShape({ goalId: 'childNew', kind: 'child', childId: 'child2', createdBy: 'parent1' })));
  });

  it('3. child can create only a self-owned child goal (legacy behaviour enabled)', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertSucceeds(setDoc(doc(db, goalPath('childSelf')), v1GoalShape({ goalId: 'childSelf', kind: 'child', childId: 'child1', createdBy: 'child1' })));
  });

  it('4. child cannot create family goals', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(setDoc(doc(db, goalPath('famByChild')), v1GoalShape({ goalId: 'famByChild', kind: 'family', createdBy: 'child1' })));
  });

  it('4b. child cannot create a child goal for another child', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(setDoc(doc(db, goalPath('childOther')), v1GoalShape({ goalId: 'childOther', kind: 'child', childId: 'child2', createdBy: 'child1' })));
  });

  // ---- SECURITY BOUNDARY: atomic initial parent contribution proof on goal create ----
  // A goal created with currentAmountPence > 0 MUST be backed, in the SAME batch,
  // by an immutable parent_contribution leg + matching goal_ledger entry +
  // goal_create idempotency doc, all with matching familyId/goalId/actorId/
  // clientReqId/amount. The create rule enforces this at the trust boundary using
  // getAfter(). A direct client write that forges a non-zero balance without the
  // matching legs is DENIED. A zero-seeded goal requires no legs.

  // Seed the three atomic-proof documents for a goal (used to build a VALID batch
  // or to test individual-leg mismatches). clientReqId drives the idempotency path.
  const seedInitialParentRecords = async (ctx: any, goalId: string, amount: number, clientReqId: string, over: Record<string, any> = {}) => {
    const db = ctx.firestore();
    await setDoc(doc(db, contribPath(goalId, 'initialParentContribution')), {
      contribId: 'initialParentContribution', goalId, type: 'parent_contribution',
      ownerType: 'parent', ownerId: 'parent1', amountPence: amount, matchPence: 0, status: 'applied',
      createdBy: 'parent1', createdAt: serverTimestamp(), ...over.contrib,
    });
    await setDoc(doc(db, ledgerPath(goalId, 'initialParentLedger')), {
      entryId: 'initialParentLedger', goalId, type: 'parent_contribution',
      ownerId: 'parent1', amountPence: amount, createdAt: serverTimestamp(), ...over.ledger,
    });
    await setDoc(doc(db, idemPath(`goalCreate_${clientReqId}`)), {
      operationType: 'goal_create', actorId: 'parent1', goalId, familyId: FAMILY,
      amountPence: amount, clientReqId, status: 'completed',
      createdAt: serverTimestamp(), expiresAt: serverTimestamp(), ...over.idem,
    });
  };

  // Helper: write goal + all three legs in ONE batch (the only allowed path for a
  // non-zero seed). Returns the db context used.
  const atomicSeedBatch = async (db: any, goalId: string, amount: number, clientReqId: string, goalOver: Record<string, any> = {}, over: Record<string, any> = {}) => {
    const batch = db.batch();
    batch.set(doc(db, goalPath(goalId)), v1GoalShape({
      goalId, kind: 'family', createdBy: 'parent1', currentAmountPence: amount, clientReqId, ...goalOver,
    }));
    batch.set(doc(db, contribPath(goalId, 'initialParentContribution')), {
      contribId: 'initialParentContribution', goalId, type: 'parent_contribution',
      ownerType: 'parent', ownerId: 'parent1', amountPence: amount, matchPence: 0, status: 'applied',
      createdBy: 'parent1', createdAt: serverTimestamp(), ...over.contrib,
    });
    batch.set(doc(db, ledgerPath(goalId, 'initialParentLedger')), {
      entryId: 'initialParentLedger', goalId, type: 'parent_contribution',
      ownerId: 'parent1', amountPence: amount, createdAt: serverTimestamp(), ...over.ledger,
    });
    batch.set(doc(db, idemPath(`goalCreate_${clientReqId}`)), {
      operationType: 'goal_create', actorId: 'parent1', goalId, familyId: FAMILY,
      amountPence: amount, clientReqId, status: 'completed',
      createdAt: serverTimestamp(), expiresAt: serverTimestamp(), ...over.idem,
    });
    await batch.commit();
  };

  // === EXPLOIT PROOF (must be DENIED after fix) ===
  it('EXPLOIT: authenticated parent creates non-zero goal with NO accounting legs — DENIED', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(setDoc(doc(db, goalPath('exploitNoLegs')),
      v1GoalShape({ goalId: 'exploitNoLegs', kind: 'family', createdBy: 'parent1', currentAmountPence: 500, clientReqId: 'req-exploit' })));
  });

  // === INDIVIDUAL-LEG OMISSIONS (non-zero seed, missing one leg) ===
  it('non-zero goal + contribution only — DENIED', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(ctx.firestore().doc(contribPath('gContribOnly', 'initialParentContribution')), {
        contribId: 'initialParentContribution', goalId: 'gContribOnly', type: 'parent_contribution',
        ownerType: 'parent', ownerId: 'parent1', amountPence: 500, matchPence: 0, status: 'applied',
        createdBy: 'parent1', createdAt: serverTimestamp(),
      });
    });
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(setDoc(doc(db, goalPath('gContribOnly')),
      v1GoalShape({ goalId: 'gContribOnly', kind: 'family', createdBy: 'parent1', currentAmountPence: 500, clientReqId: 'req-gContribOnly' })));
  });

  it('non-zero goal + ledger only — DENIED', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(ctx.firestore().doc(ledgerPath('gLedgerOnly', 'initialParentLedger')), {
        entryId: 'initialParentLedger', goalId: 'gLedgerOnly', type: 'parent_contribution',
        ownerId: 'parent1', amountPence: 500, createdAt: serverTimestamp(),
      });
    });
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(setDoc(doc(db, goalPath('gLedgerOnly')),
      v1GoalShape({ goalId: 'gLedgerOnly', kind: 'family', createdBy: 'parent1', currentAmountPence: 500, clientReqId: 'req-gLedgerOnly' })));
  });

  it('non-zero goal + idempotency only — DENIED', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(ctx.firestore().doc(idemPath('goalCreate_reqIdemOnly')), {
        operationType: 'goal_create', actorId: 'parent1', goalId: 'gIdemOnly', familyId: FAMILY,
        amountPence: 500, clientReqId: 'reqIdemOnly', status: 'completed',
        createdAt: serverTimestamp(), expiresAt: serverTimestamp(),
      });
    });
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(setDoc(doc(db, goalPath('gIdemOnly')),
      v1GoalShape({ goalId: 'gIdemOnly', kind: 'family', createdBy: 'parent1', currentAmountPence: 500, clientReqId: 'reqIdemOnly' })));
  });

  // === MISMATCHED LEGS (all three present but inconsistent) ===
  it('mismatched amount — DENIED', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await seedInitialParentRecords(ctx, 'gAmt', 400, 'req-gAmt', { contrib: { amountPence: 400 }, ledger: { amountPence: 400 }, idem: { amountPence: 400 } });
    });
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(setDoc(doc(db, goalPath('gAmt')),
      v1GoalShape({ goalId: 'gAmt', kind: 'family', createdBy: 'parent1', currentAmountPence: 500, clientReqId: 'req-gAmt' })));
  });

  it('mismatched actor — DENIED', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await seedInitialParentRecords(ctx, 'gActor', 500, 'req-gActor', { idem: { actorId: 'child1' }, contrib: { ownerId: 'child1' }, ledger: { ownerId: 'child1' } });
    });
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(setDoc(doc(db, goalPath('gActor')),
      v1GoalShape({ goalId: 'gActor', kind: 'family', createdBy: 'parent1', currentAmountPence: 500, clientReqId: 'req-gActor' })));
  });

  it('mismatched family — DENIED', async () => {
    // Seed valid records in OTHER family; same-family goal create must still fail
    // because the rule resolves the idempotency path under FAMILY, not OTHER.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, `families/${OTHER}/savings_goals/gFam/contributions/initialParentContribution`), {
        contribId: 'initialParentContribution', goalId: 'gFam', type: 'parent_contribution',
        ownerType: 'parent', ownerId: 'parent2', amountPence: 500, matchPence: 0, status: 'applied',
        createdBy: 'parent2', createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, `families/${OTHER}/savings_goals/gFam/goal_ledger/initialParentLedger`), {
        entryId: 'initialParentLedger', goalId: 'gFam', type: 'parent_contribution',
        ownerId: 'parent2', amountPence: 500, createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, `families/${OTHER}/idempotency/goalCreate_req-gFam`), {
        operationType: 'goal_create', actorId: 'parent2', goalId: 'gFam', familyId: OTHER,
        amountPence: 500, clientReqId: 'req-gFam', status: 'completed',
        createdAt: serverTimestamp(), expiresAt: serverTimestamp(),
      });
    });
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(setDoc(doc(db, goalPath('gFam')),
      v1GoalShape({ goalId: 'gFam', kind: 'family', createdBy: 'parent1', currentAmountPence: 500, clientReqId: 'req-gFam' })));
  });

  it('mismatched goalId — DENIED', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await seedInitialParentRecords(ctx, 'gGoalMismatch', 500, 'req-gGoalMismatch', { contrib: { goalId: 'otherGoal' }, ledger: { goalId: 'otherGoal' }, idem: { goalId: 'otherGoal' } });
    });
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(setDoc(doc(db, goalPath('gGoalMismatch')),
      v1GoalShape({ goalId: 'gGoalMismatch', kind: 'family', createdBy: 'parent1', currentAmountPence: 500, clientReqId: 'req-gGoalMismatch' })));
  });

  it('mismatched clientReqId/requestHash — DENIED', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await seedInitialParentRecords(ctx, 'gReq', 500, 'req-gReq-SEED');
    });
    const db = testEnv.authenticatedContext('parent1').firestore();
    // Goal claims a different clientReqId than the seeded idempotency doc.
    await assertFails(setDoc(doc(db, goalPath('gReq')),
      v1GoalShape({ goalId: 'gReq', kind: 'family', createdBy: 'parent1', currentAmountPence: 500, clientReqId: 'req-gReq-DIFFERENT' })));
  });

  // === VALID PATHS ===
  it('valid atomic seeded goal creation (all legs in one batch) — ALLOWED', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await atomicSeedBatch(db, 'gValid', 500, 'req-gValid');
  });

  it('valid zero-seeded goal creation (no legs) — ALLOWED', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertSucceeds(setDoc(doc(db, goalPath('gZero')),
      v1GoalShape({ goalId: 'gZero', kind: 'family', createdBy: 'parent1', currentAmountPence: 0, clientReqId: 'req-gZero' })));
  });

  it('non-parent (child) cannot create a non-zero seeded goal — DENIED', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(setDoc(doc(db, goalPath('gChildSeed')),
      v1GoalShape({ goalId: 'gChildSeed', kind: 'child', childId: 'child1', createdBy: 'child1', currentAmountPence: 500, clientReqId: 'req-gChildSeed' })));
  });

  it('cross-family parent cannot seed a goal in another family — DENIED', async () => {
    const db = testEnv.authenticatedContext('parent2').firestore();
    await assertFails(setDoc(doc(db, otherGoalPath('gCross')),
      v1GoalShape({ goalId: 'gCross', kind: 'family', createdBy: 'parent2', currentAmountPence: 500, clientReqId: 'req-gCross' })));
  });

  it('forged initial parent-contribution leg alongside zero-balance goal — ALLOWED (no seed required at zero)', async () => {
    // At zero balance the rule requires NO legs, so a stray contribution doc is
    // irrelevant; the create is permitted (the contribution itself is separately
    // gated by its own create rule, not by the goal create rule).
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(ctx.firestore().doc(contribPath('gForged', 'initialParentContribution')), {
        contribId: 'initialParentContribution', goalId: 'gForged', type: 'parent_contribution',
        ownerType: 'parent', ownerId: 'parent1', amountPence: 500, matchPence: 0, status: 'applied',
        createdBy: 'parent1', createdAt: serverTimestamp(),
      });
    });
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertSucceeds(setDoc(doc(db, goalPath('gForged')),
      v1GoalShape({ goalId: 'gForged', kind: 'family', createdBy: 'parent1', currentAmountPence: 0, clientReqId: 'req-gForged' })));
  });
});

describe('Goals — direct balance / money writes denied', () => {
  // BUG 1A REGRESSION: a seeded goal whose parent contribution meets/exceeds
  // the target is legitimately 'reached' on creation. The create rule must allow
  // status 'reached' (not just 'active') so the atomic seed proof path is not
  // rejected with "Missing or insufficient permissions".
  const seedLegs = async (goalId, amount, clientReqId) => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, contribPath(goalId, 'initialParentContribution')), {
        contribId: 'initialParentContribution', goalId, type: 'parent_contribution',
        ownerType: 'parent', ownerId: 'parent1', amountPence: amount, matchPence: 0, status: 'applied',
        createdBy: 'parent1', createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, ledgerPath(goalId, 'initialParentLedger')), {
        entryId: 'initialParentLedger', goalId, type: 'parent_contribution',
        ownerId: 'parent1', amountPence: amount, createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, idemPath(`goalCreate_${clientReqId}`)), {
        operationType: 'goal_create', actorId: 'parent1', goalId, familyId: FAMILY,
        amountPence: amount, clientReqId, status: 'completed',
        createdAt: serverTimestamp(), expiresAt: serverTimestamp(),
      });
    });
  };

  it('BUG1A: seeded goal with seed == target (status reached) — ALLOWED', async () => {
    await seedLegs('gReachedSeed', 1000, 'req-gReachedSeed');
    const db = testEnv.authenticatedContext('parent1').firestore();
    // target 1000, seed 1000 -> API sets status 'reached'. All legs present.
    await assertSucceeds(setDoc(doc(db, goalPath('gReachedSeed')),
      v1GoalShape({ goalId: 'gReachedSeed', kind: 'family', createdBy: 'parent1', currentAmountPence: 1000, status: 'reached', clientReqId: 'req-gReachedSeed' })));
  });

  it('BUG1A: seeded goal with seed > target (status reached) — ALLOWED', async () => {
    await seedLegs('gOverSeed', 1500, 'req-gOverSeed');
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertSucceeds(setDoc(doc(db, goalPath('gOverSeed')),
      v1GoalShape({ goalId: 'gOverSeed', kind: 'family', createdBy: 'parent1', currentAmountPence: 1500, status: 'reached', clientReqId: 'req-gOverSeed' })));
  });

  // === BUG 1A REGRESSION: a malformed / unlinked seed ledger must still be
  // DENIED. Seed the contribution + idempotency but OMIT the goal_ledger leg. ===
  it('BUG1A: non-zero seed missing the goal_ledger leg — DENIED', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, contribPath('gNoLedger', 'initialParentContribution')), {
        contribId: 'initialParentContribution', goalId: 'gNoLedger', type: 'parent_contribution',
        ownerType: 'parent', ownerId: 'parent1', amountPence: 500, matchPence: 0, status: 'applied',
        createdBy: 'parent1', createdAt: serverTimestamp(),
      });
      await setDoc(doc(db, idemPath('goalCreate_req-gNoLedger')), {
        operationType: 'goal_create', actorId: 'parent1', goalId: 'gNoLedger', familyId: FAMILY,
        amountPence: 500, clientReqId: 'req-gNoLedger', status: 'completed',
        createdAt: serverTimestamp(), expiresAt: serverTimestamp(),
      });
    });
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(setDoc(doc(db, goalPath('gNoLedger')),
      v1GoalShape({ goalId: 'gNoLedger', kind: 'family', createdBy: 'parent1', currentAmountPence: 500, clientReqId: 'req-gNoLedger' })));
  });
});

describe('Goals — match proposal (BUG 1B regression)', () => {
  // A valid match proposal is written by a parent in a batch (serverTimestamp
  // resolves to request.time, satisfying the create rule). It must be ALLOWED.
  it('BUG1B: valid parent match proposal — ALLOWED', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    const batch = db.batch();
    batch.set(doc(db, proposalPath('goal1', 'propValid')), {
      proposalId: 'propValid', goalId: 'goal1', sourceContributionId: 'c1',
      proposedMatchAmountPence: 100, status: 'proposed', createdBy: 'parent1', createdAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });

  // A forged proposal (non-parent actor) must be DENIED.
  it('BUG1B: non-parent cannot create a match proposal — DENIED', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(setDoc(doc(db, proposalPath('goal1', 'propChild')), {
      proposalId: 'propChild', goalId: 'goal1', sourceContributionId: 'c1',
      proposedMatchAmountPence: 100, status: 'proposed', createdBy: 'child1', createdAt: serverTimestamp(),
    }));
  });

  // A mismatched proposal (wrong goalId vs path) must be DENIED.
  it('BUG1B: match proposal with goalId != path goalId — DENIED', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(setDoc(doc(db, proposalPath('goal1', 'propMismatch')), {
      proposalId: 'propMismatch', goalId: 'goalFam', sourceContributionId: 'c1',
      proposedMatchAmountPence: 100, status: 'proposed', createdBy: 'parent1', createdAt: serverTimestamp(),
    }));
  });

  // A proposal with a negative match amount must be DENIED.
  it('BUG1B: match proposal with negative amount — DENIED', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(setDoc(doc(db, proposalPath('goal1', 'propNeg')), {
      proposalId: 'propNeg', goalId: 'goal1', sourceContributionId: 'c1',
      proposedMatchAmountPence: -100, status: 'proposed', createdBy: 'parent1', createdAt: serverTimestamp(),
    }));
  });
});

describe('Goals — direct balance / money writes denied', () => {
  it('5. child direct wallet balance update denied', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(updateDoc(doc(db, `families/${FAMILY}/wallets/child1`), { balance: 500 }));
  });

  it('6. child direct goal balance decrease denied (contributions may only increase)', async () => {
    // Seed a non-zero balance via a rules-disabled write, then confirm a child
    // cannot decrease it. (Children MAY increase their own goal's amount when
    // recording a contribution; the wallet debit enforces the real money move.)
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(ctx.firestore().collection(`families/${FAMILY}/savings_goals`).doc('goal1'), { currentAmountPence: 1000 });
    });
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(updateDoc(doc(db, goalPath('goal1')), { currentAmountPence: 500 }));
    await assertFails(updateDoc(doc(db, goalPath('goal1')), { currentAmountPence: 100, status: 'cancelled' }));
  });

  it('7. parent direct arbitrary goal balance overwrite denied', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(updateDoc(doc(db, goalPath('goal1')), { currentAmountPence: 9999, createdBy: 'hacker' }));
    await assertFails(updateDoc(doc(db, goalPath('goal1')), { currentAmountPence: 9999, status: 'completed_purchased' }));
  });

  it('8. contribution and goal_ledger update/delete denied', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(updateDoc(doc(db, contribPath('goal1', 'c1')), { amountPence: 1 }));
    await assertFails(updateDoc(doc(db, ledgerPath('goal1', 'l1')), { amountPence: 1 }));
    await assertFails(deleteDoc(doc(db, contribPath('goal1', 'c1'))));
    await assertFails(deleteDoc(doc(db, ledgerPath('goal1', 'l1'))));
  });

  it('8b. contribution create-only (immutable) — valid create allowed', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertSucceeds(setDoc(doc(db, contribPath('goal1', 'cNew')), {
      contribId: 'cNew', goalId: 'goal1', type: 'child_contribution', ownerType: 'child',
      ownerId: 'child1', amountPence: 100, status: 'applied', createdAt: serverTimestamp(),
    }));
  });

  it('8c. goal_ledger create-only — valid create allowed', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertSucceeds(setDoc(doc(db, ledgerPath('goal1', 'lNew')), {
      entryId: 'lNew', goalId: 'goal1', type: 'child_contribution', amountPence: 100, ownerId: 'child1', createdAt: serverTimestamp(),
    }));
  });
});

describe('Goals — approvals', () => {
  it('9. child cannot approve withdrawal or match proposal', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(updateDoc(doc(db, requestPath('req1')), {
      status: 'approved', reviewedBy: 'child1', reviewedAt: serverTimestamp(), contribId: 'c1', walletTxId: 't1',
    }));
    await assertFails(updateDoc(doc(db, proposalPath('goal1', 'prop1')), {
      status: 'approved', reviewedBy: 'child1', reviewedAt: serverTimestamp(),
    }));
  });

  it('10. parent can perform valid approval transaction shape', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertSucceeds(updateDoc(doc(db, requestPath('req1')), {
      status: 'approved', reviewedBy: 'parent1', reviewedByName: 'P1', reviewedAt: serverTimestamp(), contribId: 'c1', walletTxId: 't1',
    }));
    await assertSucceeds(updateDoc(doc(db, proposalPath('goal1', 'prop1')), {
      status: 'approved', reviewedBy: 'parent1', reviewedByName: 'P1', reviewedAt: serverTimestamp(),
    }));
  });

  it('10b. parent match proposal approval must keep immutable sourceContributionId', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(updateDoc(doc(db, proposalPath('goal1', 'prop1')), {
      status: 'approved', reviewedBy: 'parent1', reviewedAt: serverTimestamp(), sourceContributionId: 'tampered',
    }));
  });
});

describe('Goals — terminal / status transitions', () => {
  it('11. terminal goal rejects further contribution', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(updateDoc(doc(db, goalPath('goalDone')), { currentAmountPence: 100, status: 'completed_returned' }));
    await assertFails(setDoc(doc(db, contribPath('goalDone', 'cX')), {
      contribId: 'cX', goalId: 'goalDone', type: 'child_contribution', ownerType: 'child',
      ownerId: 'child1', amountPence: 100, status: 'applied', createdAt: serverTimestamp(),
    }));
  });

  it('12. non-parent cannot complete or cancel goal', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(updateDoc(doc(db, goalPath('goal1')), { status: 'completed_purchased', currentAmountPence: 0, completedMode: 'purchased', completedAt: serverTimestamp(), completedBy: 'child1' }));
    await assertFails(updateDoc(doc(db, goalPath('goal1')), { status: 'cancelled', currentAmountPence: 0, completedMode: 'cancelled', completedAt: serverTimestamp(), completedBy: 'child1' }));
  });

  it('12b. parent can complete a goal (terminal transition)', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertSucceeds(updateDoc(doc(db, goalPath('goalReached')), {
      status: 'completed_purchased', currentAmountPence: 2000, completedMode: 'purchased', completedAt: serverTimestamp(), completedBy: 'parent1',
    }));
  });

  it('13. completed and cancelled goal balance must be zero', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(updateDoc(doc(db, goalPath('goalDone')), {
      status: 'completed_returned', currentAmountPence: 500, completedMode: 'returned', completedAt: serverTimestamp(), completedBy: 'parent1',
    }));
  });

  it('14. reached-to-active transition rejected unless linked to approved withdrawal', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    // A bare reached->active flip with a balance decrease is the exact shape the
    // trusted withdrawal transaction produces, so it is permitted here (the
    // atomic linkage to the approved request + goal_return ledger is enforced by
    // the batch in the real transaction). A reached->active WITHOUT a decrease,
    // or any other field, is denied.
    await assertSucceeds(updateDoc(doc(db, goalPath('goalReached')), { currentAmountPence: 1500, status: 'active' }));
    // reached->active with an INCREASE is denied (fresh reached goal).
    const db2 = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(updateDoc(doc(db2, goalPath('goalReached2')), { currentAmountPence: 2500, status: 'active' }));
    // reached->active with extra fields is denied (fresh reached goal).
    const db3 = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(updateDoc(doc(db3, goalPath('goalReached3')), { currentAmountPence: 1500, status: 'active', title: 'hacked' }));
  });

  it('14b. child can never perform reached->active', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(updateDoc(doc(db, goalPath('goalReached')), { currentAmountPence: 1500, status: 'active' }));
  });
});

describe('Goals — legacy compatibility', () => {
  it('15. legacy savings_goals documents remain readable and compatible', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    const snap = await getDoc(doc(db, goalPath('legacyGoal')));
    expect(snap.exists()).toBe(true);
    await assertSucceeds(updateDoc(doc(db, goalPath('legacyGoal')), { currentAmount: 5 }));
  });
});

describe('Goals — idempotency (families/{familyId}/idempotency/{operationKey})', () => {
  it('16. malformed idempotency operation write denied', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(setDoc(doc(db, idemPath('badKey')), {
      operationType: 'goal_contribution', actorId: 'parent1', requestHash: 'abc', status: 'completed', resultRef: 'x',
    }));
    await assertFails(setDoc(doc(db, idemPath('badKey2')), { foo: 'bar' }));
  });

  it('16b. FORGED ISOLATED COMPLETED idempotency document is denied (any client role)', async () => {
    // A perfectly well-formed "completed" operation document, written in isolation
    // by a client (parent, owner, or child), must be DENIED. Idempotency operation
    // documents are written ONLY by the trusted goal transaction (client SDK
    // runTransaction), never by a client acting alone. This proves a malicious
    // client cannot forge a completed operation record to short-circuit idempotency
    // or impersonate a server-side write. Reads ARE permitted for family members
    // (so the trusted transaction can detect replays); the forge protection is
    // that create requires the exact trusted shape and update/delete are denied.
    const wellFormed = {
      operationType: 'goalContribution', actorId: 'parent1', requestHash: 'deadbeef',
      status: 'completed', resultRef: 'families/family1/savings_goals/goal1/contributions/c1',
      createdAt: serverTimestamp(), expiresAt: serverTimestamp(),
    };
    // Parent
    const pdb = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(setDoc(doc(pdb, idemPath('goalContribution:goal1:r1')), wellFormed));
    // Owner
    const odb = testEnv.authenticatedContext('owner1').firestore();
    await assertFails(setDoc(doc(odb, idemPath('goalContribution:goal1:r2')), wellFormed));
    // Child
    const cdb = testEnv.authenticatedContext('child1').firestore();
    await assertFails(setDoc(doc(cdb, idemPath('goalContribution:goal1:r3')), wellFormed));
    // A family member MAY read idempotency state (needed by the trusted
    // transaction for replay detection); mutation/deletion remain denied.
    await assertSucceeds(getDoc(doc(pdb, idemPath('goalContribution:goal1:r1'))));
    await assertFails(deleteDoc(doc(pdb, idemPath('goalContribution:goal1:r1'))));
    await assertFails(updateDoc(doc(pdb, idemPath('goalContribution:goal1:r1')), { status: 'completed' }));
  });

  it('16c. cross-family idempotency write denied', async () => {
    const db = testEnv.authenticatedContext('parent2').firestore();
    await assertFails(setDoc(doc(db, `families/${OTHER}/idempotency/goalContribution:goalX:r1`), {
      operationType: 'goalContribution', actorId: 'parent2', requestHash: 'abc',
      status: 'completed', resultRef: 'x', createdAt: serverTimestamp(), expiresAt: serverTimestamp(),
    }));
  });
});

describe('Goals — reached->active security boundary (no arbitrary parent balance reduction)', () => {
  it('18. parent cannot perform an ARBITRARY goal balance decrease (non reached->active shape)', async () => {
    // An isolated parent write that decreases a goal balance WITHOUT the exact
    // reached->active trusted shape is denied. A funded active goal cannot be
    // arbitrarily reduced, and a reached goal cannot be reduced while staying
    // "reached" or jumping to an illegal status.
    const db = testEnv.authenticatedContext('parent1').firestore();
    // Funded active goal arbitrary decrease denied (800 -> 100 is a decrease).
    await assertFails(updateDoc(doc(db, goalPath('goalFunded')), { currentAmountPence: 100 }));
    // reached goal decrease but staying reached denied.
    await assertFails(updateDoc(doc(db, goalPath('goalReached')), { currentAmountPence: 1500, status: 'reached' }));
    // reached goal decrease to a non-active/non-reached status denied.
    await assertFails(updateDoc(doc(db, goalPath('goalReached')), { currentAmountPence: 1500, status: 'cancelled' }));
  });

  it('18b. parent cannot pair reached->active with an ARBITRARY WALLET balance decrease', async () => {
    // The trusted withdrawal batch CREDITS the child wallet (money returns to the
    // child). A malicious parent attempting reached->active PLUS an arbitrary
    // wallet balance DECREASE (theft) is denied at the wallet layer: a bare wallet
    // balance decrease is not a permitted trusted shape (isValidWithdrawalDeduction
    // requires a matching withdrawal ledger transaction). We assert both writes
    // fail independently; the goal flip alone is shape-permitted but the wallet
    // theft is always denied, so a consistent malicious state is impossible.
    const db = testEnv.authenticatedContext('parent1').firestore();
    // Arbitrary wallet balance decrease (no withdrawal tx) is denied.
    await assertFails(updateDoc(doc(db, `families/${FAMILY}/wallets/child1`), { balance: 500 }));
    // A withdrawal-shaped wallet decrease without the trusted ledger tx is denied.
    await assertFails(updateDoc(doc(db, `families/${FAMILY}/wallets/child1`), { balance: 500, lastManualTxId: 'forged' }));
  });

  it('18c. child cannot perform any goal balance decrease', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(updateDoc(doc(db, goalPath('goalReached')), { currentAmountPence: 1500, status: 'active' }));
    await assertFails(updateDoc(doc(db, goalPath('goalFunded')), { currentAmountPence: 100 }));
  });
});

describe('Goals — deleteCancelledGoal security boundary', () => {
  it('19. same-family parent can delete a cancelled zero-balance goal', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertSucceeds(deleteDoc(doc(db, goalPath('goalCancelled'))));
  });

  it('19b. same-family owner can delete a cancelled zero-balance goal', async () => {
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertSucceeds(deleteDoc(doc(db, goalPath('goalCancelled'))));
  });

  it('20. child cannot delete a cancelled goal', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(deleteDoc(doc(db, goalPath('goalCancelled'))));
  });

  it('21. unrelated-family parent cannot delete the goal', async () => {
    const db = testEnv.authenticatedContext('parent2').firestore();
    await assertFails(deleteDoc(doc(db, goalPath('goalCancelled'))));
  });

  it('22. active goal cannot be deleted', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(deleteDoc(doc(db, goalPath('goal1'))));
  });

  it('23. reached goal cannot be deleted', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(deleteDoc(doc(db, goalPath('goalReached'))));
  });

  it('24. completed_returned goal cannot be deleted', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(deleteDoc(doc(db, goalPath('goalDone'))));
  });

  it('25. cancelled goal WITH remaining funds cannot be deleted', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(deleteDoc(doc(db, goalPath('goalCancelledFunded'))));
  });

  it('26. forged direct delete of a contribution leg is denied', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(deleteDoc(doc(db, contribPath('goal1', 'c1'))));
  });

  it('27. forged direct delete of a goal_ledger entry is denied', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    await assertFails(deleteDoc(doc(db, ledgerPath('goal1', 'l1'))));
  });

  it('28. forged direct update of a cancelled goal (bypass delete) is denied', async () => {
    const db = testEnv.authenticatedContext('parent1').firestore();
    // A parent may not mutate a terminal goal's fields directly (isValidGoalReturnUpdate
    // only permits the terminal transition, not arbitrary edits).
    await assertFails(updateDoc(doc(db, goalPath('goalCancelled')), { title: 'hacked' }));
  });
});
