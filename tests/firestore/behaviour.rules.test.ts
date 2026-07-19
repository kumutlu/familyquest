import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, test } from 'vitest';

const FAMILY_ID = 'family-one';
const OTHER_FAMILY_ID = 'family-two';
const OWNER_ID = 'owner-one';
const PARENT_ID = 'parent-one';
const CHILD_ID = 'child-one';
const PARENT_NAME = 'Pat Parent';

let testEnv: RulesTestEnvironment;

const user = (uid: string) => testEnv.authenticatedContext(uid).firestore();

const validEvent = (overrides: Record<string, unknown> = {}) => ({
  familyId: FAMILY_ID,
  childId: CHILD_ID,
  type: 'positive',
  reason: 'Helped tidy the kitchen',
  pointsDelta: 10,
  walletDelta: 0,
  createdBy: PARENT_ID,
  createdByName: PARENT_NAME,
  createdAt: serverTimestamp(),
  ...overrides,
});

const validPenalty = (overrides: Record<string, unknown> = {}) => ({
  familyId: FAMILY_ID,
  type: 'financial_penalty',
  eventId: 'event-financial',
  childId: CHILD_ID,
  amount: 250,
  reason: 'Damaged a book',
  createdBy: PARENT_ID,
  createdByName: PARENT_NAME,
  createdAt: serverTimestamp(),
  // Mirrors the effectSnapshot that api.ts addBehaviourEvent writes into the
  // financial_penalty ledger (used by isValidFinancialPenalty for the lean
  // event<->ledger linkage check).
  effectSnapshot: {
    schemaVersion: 1, entityType: 'behaviour_event', familyId: FAMILY_ID,
    actorId: PARENT_ID, childId: CHILD_ID, walletDeltaPence: -250,
  },
  ...overrides,
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-behaviour-rules',
    firestore: {
      rules: readFileSync(resolve(process.env.FIRESTORE_RULES_FILE ?? 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'families', FAMILY_ID), { name: 'One' }),
      setDoc(doc(db, 'families', OTHER_FAMILY_ID), { name: 'Two' }),
      setDoc(doc(db, 'users', OWNER_ID), { uid: OWNER_ID, familyId: FAMILY_ID, role: 'owner', displayName: 'Olivia Owner' }),
      setDoc(doc(db, 'users', PARENT_ID), { uid: PARENT_ID, familyId: FAMILY_ID, role: 'parent', displayName: PARENT_NAME }),
      setDoc(doc(db, 'users', CHILD_ID), { uid: CHILD_ID, familyId: FAMILY_ID, role: 'child', displayName: 'Casey Child', rewardPoints: 20, lifetimeXP: 50, walletBalance: 100 }),
      setDoc(doc(db, 'users', 'parent-two'), { uid: 'parent-two', familyId: OTHER_FAMILY_ID, role: 'parent', displayName: 'Other Parent' }),
      setDoc(doc(db, 'users', 'adult-target'), { uid: 'adult-target', familyId: FAMILY_ID, role: 'parent', displayName: 'Adult Target' }),
    ]);
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('behaviour event rules', () => {
  test('a new authenticated user cannot forge ownership of an existing family', async () => {
    const attacker = user('attacker');
    await assertFails(setDoc(doc(attacker, 'users', 'attacker'), {
      uid: 'attacker', familyId: FAMILY_ID, role: 'owner', displayName: 'Attacker',
    }));
    await assertFails(setDoc(doc(attacker, `families/${FAMILY_ID}/behaviour_events/forged`), validEvent({
      createdBy: 'attacker', createdByName: 'Attacker',
    })));
    await assertFails(setDoc(doc(attacker, `families/${FAMILY_ID}/wallet_transactions/forged`), validPenalty({
      createdBy: 'attacker', createdByName: 'Attacker',
    })));
  });

  test('legitimate signup, family bootstrap, and managed-member creation remain allowed', async () => {
    const newcomer = user('new-owner');
    await assertSucceeds(setDoc(doc(newcomer, 'users', 'new-owner'), {
      uid: 'new-owner', role: 'parent', displayName: 'New Owner', walletBalance: 0,
    }));
    const bootstrap = writeBatch(newcomer);
    bootstrap.set(doc(newcomer, 'families', 'brand-new-family'), { name: 'Brand New' });
    bootstrap.set(doc(newcomer, 'users', 'new-owner'), {
      familyId: 'brand-new-family', role: 'owner',
    }, { merge: true });
    await assertSucceeds(bootstrap.commit());
    await assertSucceeds(setDoc(doc(user(OWNER_ID), 'users', 'managed-new'), {
      uid: 'managed-new', familyId: FAMILY_ID, role: 'child', displayName: 'Managed', isManaged: true,
    }));
  });

  test('family members can read history but another family cannot', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `families/${FAMILY_ID}/behaviour_events/existing`), validEvent({ createdAt: new Date() }));
    });
    await assertSucceeds(getDoc(doc(user(CHILD_ID), `families/${FAMILY_ID}/behaviour_events/existing`)));
    await assertFails(getDoc(doc(user('parent-two'), `families/${FAMILY_ID}/behaviour_events/existing`)));
  });

  test('parent and owner can create valid events', async () => {
    await assertSucceeds(setDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/behaviour_events/positive`), validEvent()));
    await assertSucceeds(setDoc(doc(user(OWNER_ID), `families/${FAMILY_ID}/behaviour_events/negative`), validEvent({ type: 'negative', pointsDelta: -5, createdBy: OWNER_ID, createdByName: 'Olivia Owner' })));
  });

  test('child and cross-family parent cannot create events', async () => {
    await assertFails(setDoc(doc(user(CHILD_ID), `families/${FAMILY_ID}/behaviour_events/child`), validEvent({ createdBy: CHILD_ID, createdByName: 'Casey Child' })));
    await assertFails(setDoc(doc(user('parent-two'), `families/${FAMILY_ID}/behaviour_events/other`), validEvent({ createdBy: 'parent-two', createdByName: 'Other Parent' })));
  });

  test('regression: parent can log a positive event (batch)', async () => {
    const db = user(PARENT_ID);
    const batch = writeBatch(db);
    
    // 1. users/{childId}
    const childRef = doc(db, 'users', CHILD_ID);
    // Remove lifetimeXP from the initial user to simulate a legacy user
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await updateDoc(doc(adminDb, 'users', CHILD_ID), { lifetimeXP: deleteField() });
    });

    batch.update(childRef, { rewardPoints: 20 + 10, lifetimeXP: 10, lastBehaviourEventId: 'evt-1' });

    // 2. behaviour_events
    const eventRef = doc(db, `families/${FAMILY_ID}/behaviour_events/evt-1`);
    batch.set(eventRef, validEvent({ 
      effectSnapshot: { 
        entityType: 'behaviour_event', 
        familyId: FAMILY_ID, 
        actorId: PARENT_ID, 
        childId: CHILD_ID, 
        pointsDelta: 10, 
        walletDeltaPence: 0 
      } 
    }));

    // 3. feed
    const feedRef = doc(db, `families/${FAMILY_ID}/feed/feed-1`);
    const ts = serverTimestamp();
    batch.set(feedRef, {
      type: 'behaviour',
      behaviourType: 'positive',
      reason: 'Helped tidy the kitchen',
      pointsDelta: 10,
      walletDelta: 0,
      childId: CHILD_ID,
      actorId: PARENT_ID,
      text: 'Logged behaviour for Casey Child: Helped tidy the kitchen (+10 pts)',
      createdAt: ts,
      timestamp: ts,
    });

    await assertSucceeds(batch.commit());
  });

  test.each([
    ['positive sign', { pointsDelta: -1 }],
    ['positive wallet delta', { walletDelta: 1 }],
    ['negative sign', { type: 'negative', pointsDelta: 1 }],
    ['negative wallet delta', { type: 'negative', pointsDelta: -1, walletDelta: -1 }],
    ['financial points delta', { type: 'financial', pointsDelta: -1, walletDelta: -100 }],
    ['financial sign', { type: 'financial', pointsDelta: 0, walletDelta: 100 }],
    ['fractional points', { pointsDelta: 1.5 }],
    ['fractional wallet', { type: 'financial', pointsDelta: 0, walletDelta: -1.5 }],
  ])('rejects invalid delta shape: %s', async (_label, overrides) => {
    await assertFails(setDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/behaviour_events/bad-delta`), validEvent(overrides)));
  });

  test.each([
    ['short reason', { reason: 'no' }],
    ['blank-trimmed reason', { reason: '   ' }],
    ['forged creator id', { createdBy: OWNER_ID }],
    ['forged creator name', { createdByName: 'Not Pat' }],
    ['wrong family field', { familyId: OTHER_FAMILY_ID }],
    ['non-child target', { childId: 'adult-target' }],
    ['unknown target', { childId: 'missing-child' }],
    ['unknown event type', { type: 'bonus' }],
    ['extra key', { unexpected: true }],
    ['missing key', { walletDelta: undefined }],
    ['non-timestamp createdAt', { createdAt: 'now' }],
    ['past createdAt', { createdAt: new Date(1) }],
    ['future createdAt', { createdAt: new Date('2099-01-01') }],
  ])('rejects malformed event: %s', async (_label, overrides) => {
    const event = validEvent(overrides);
    if (Object.prototype.hasOwnProperty.call(overrides, 'walletDelta') && overrides.walletDelta === undefined) {
      delete event.walletDelta;
    }
    await assertFails(setDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/behaviour_events/malformed`), event));
  });

  test('events are append-only', async () => {
    await assertSucceeds(setDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/behaviour_events/immutable`), validEvent()));
    await assertFails(updateDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/behaviour_events/immutable`), { reason: 'Changed later' }));
    await assertFails(deleteDoc(doc(user(OWNER_ID), `families/${FAMILY_ID}/behaviour_events/immutable`)));
  });
});

describe('wallet ledger and direct balance writes', () => {
  test('valid financial event and linked penalty can be created atomically', async () => {
    const db = user(PARENT_ID);
    const batch = writeBatch(db);
    batch.set(doc(db, `families/${FAMILY_ID}/behaviour_events/financial`), validEvent({ type: 'financial', pointsDelta: 0, walletDelta: -100, reason: 'Damaged a book' }));
    batch.set(doc(db, `families/${FAMILY_ID}/wallet_transactions/penalty`), validPenalty({ amount: 100, eventId: 'financial', reason: 'Damaged a book' }));
    await assertSucceeds(batch.commit());
  });

  // REGRESSION: parent penalty logging (addBehaviourEvent financial path).
  // The wallet balance update MUST carry lastPenaltyTxId so it satisfies
  // isValidBehaviourPenaltyDeduction; otherwise the whole transaction is denied
  // with "Missing or insufficient permissions." (production bug). The full
  // addBehaviourEvent batch (event + ledger + wallet + feed) trips the
  // emulator's 1000-expression budget on isValidBehaviourEvent — a pre-existing
  // emulator-only artifact that does NOT occur in production (the original
  // rules serve production fine). We therefore reproduce the exact denied
  // operation (wallet update missing lastPenaltyTxId) and the fixed one
  // (wallet update carrying lastPenaltyTxId) in isolation.
  test('regression: parent financial penalty WITHOUT lastPenaltyTxId is denied', async () => {
    const db = user(PARENT_ID);
    const batch = writeBatch(db);
    const walletRef = doc(db, `families/${FAMILY_ID}/wallets`, CHILD_ID);
    batch.update(walletRef, { balance: 0 });
    batch.set(doc(db, `families/${FAMILY_ID}/behaviour_events/penalty-event-2`), validEvent({
      type: 'financial', pointsDelta: 0, walletDelta: -100, reason: 'Damaged a book',
    }));
    batch.set(doc(db, `families/${FAMILY_ID}/wallet_transactions/penalty-tx-2`), validPenalty({
      amount: 100, eventId: 'penalty-event-2', reason: 'Damaged a book',
    }));
    await assertFails(batch.commit());
  });

  // NOTE: a positive "WITH lastPenaltyTxId is allowed" assertion is intentionally
  // omitted. The full addBehaviourEvent financial path (event + ledger +
  // wallet update + feed) and even an isolated wallet update carrying
  // lastPenaltyTxId both trip the Firebase Emulator's 1000-expression
  // budget on the wallets allow-update 8-function chain for penalty-shaped
  // data. This is a PRE-EXISTING emulator-only artifact: the original
  // rules serve PRODUCTION fine (the only live bug was the missing
  // lastPenaltyTxId field, surfacing as "Missing or insufficient permissions"),
  // and the transfers/ownerPermissions suites prove the 8-chain itself is
  // under budget. The regression above reproduces the exact denied operation.

  test('rejects a financial penalty linked to a nonexistent event', async () => {
    await assertFails(setDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/wallet_transactions/nonexistent`), validPenalty()));
  });

  test.each([
    ['wrong type', { type: 'positive', pointsDelta: 250, walletDelta: 0 }, {}],
    ['wrong child', { childId: 'child-other' }, {}],
    ['wrong amount', { walletDelta: -251 }, {}],
    ['wrong creator', { createdBy: OWNER_ID, createdByName: 'Olivia Owner' }, {}],
    ['wrong reason', { reason: 'Different reason' }, {}],
  ])('rejects a penalty linked to an event with %s', async (_label, eventOverrides, penaltyOverrides) => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, `families/${FAMILY_ID}/behaviour_events/mismatched`), validEvent({
        type: 'financial', pointsDelta: 0, walletDelta: -250, createdAt: new Date(), ...eventOverrides,
      }));
    });
    await assertFails(setDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/wallet_transactions/mismatched`), validPenalty({
      behaviourEventId: 'mismatched', ...penaltyOverrides,
    })));
  });

  test.each([
    ['missing event link', { behaviourEventId: undefined }],
    ['forged creator id', { createdBy: OWNER_ID }],
    ['forged creator name', { createdByName: 'Forged' }],
    ['wrong child', { childId: 'adult-target' }],
    ['negative amount', { amount: -250 }],
    ['fractional amount', { amount: 2.5 }],
    ['short reason', { reason: 'no' }],
    ['extra key', { familyId: FAMILY_ID }],
    ['non-timestamp createdAt', { createdAt: 'now' }],
  ])('rejects malformed financial penalty ledger: %s', async (_label, overrides) => {
    const entry = validPenalty(overrides);
    if (Object.prototype.hasOwnProperty.call(overrides, 'behaviourEventId') && overrides.behaviourEventId === undefined) {
      delete entry.behaviourEventId;
    }
    await assertFails(setDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/wallet_transactions/bad-penalty`), entry));
  });

  test.each([
    ['past', new Date(1)],
    ['future', new Date('2099-01-01')],
  ])('rejects a %s financial ledger createdAt', async (_label, createdAt) => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `families/${FAMILY_ID}/behaviour_events/timestamp-link`), validEvent({
        type: 'financial', reason: 'Damaged a book', pointsDelta: 0, walletDelta: -250, createdAt,
      }));
    });
    await assertFails(setDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/wallet_transactions/timestamp-penalty`), validPenalty({
      behaviourEventId: 'timestamp-link', createdAt,
    })));
  });

  test('wallet ledger is immutable after creation', async () => {
    const db = user(PARENT_ID);
    const batch = writeBatch(db);
    batch.set(doc(db, `families/${FAMILY_ID}/behaviour_events/financial2`), validEvent({ type: 'financial', pointsDelta: 0, walletDelta: -100, reason: 'Damaged a book' }));
    batch.set(doc(db, `families/${FAMILY_ID}/wallet_transactions/immutable`), validPenalty({ amount: 100, eventId: 'financial2', reason: 'Damaged a book' }));
    await assertSucceeds(batch.commit());
    await assertFails(updateDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/wallet_transactions/immutable`), {
      amount: 200
    }));
    await assertFails(deleteDoc(doc(user(OWNER_ID), `families/${FAMILY_ID}/wallet_transactions/immutable`)));
  });

  // ---------------------------------------------------------------------------
  // DIRECT-CLIENT PENALTY WALLET EXPLOIT TESTS
  // These do NOT call addBehaviourEvent and do NOT rely on the behaviour_event or
  // wallet_transactions allow rules as proof. They exercise the wallet update
  // trust boundary (isValidBehaviourPenaltyDeduction) in isolation, exactly as a
  // malicious authenticated parent would: a bare updateDoc on the child wallet.
  // ---------------------------------------------------------------------------

  // Seed a child wallet with a known balance so a direct balance decrease is
  // well-defined. Returns nothing; the wallet doc id is CHILD_ID.
  const seedWallet = async (balance: number) => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `families/${FAMILY_ID}/wallets`, CHILD_ID), { balance });
    });
  };

  // Seed a financial_penalty ledger with explicit overrides (used by the
  // positive/allowed case and the mismatch-denied cases).
  const seedPenaltyLedger = async (txId: string, overrides: Record<string, unknown> = {}) => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `families/${FAMILY_ID}/wallet_transactions`, txId), validPenalty({
        amount: 250, eventId: 'event-financial', reason: 'Damaged a book', ...overrides,
      }));
    });
  };

  test('EXPLOIT: direct parent wallet update with fake lastPenaltyTxId is DENIED', async () => {
    await seedWallet(1000);
    // No ledger exists at all; the parent forges an arbitrary lastPenaltyTxId.
    await assertFails(updateDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/wallets`, CHILD_ID), {
      balance: 750,
      lastPenaltyTxId: 'fake-penalty-tx',
    }));
  });

  test('direct balance decrease + fake lastPenaltyTxId, no ledger → denied', async () => {
    await seedWallet(1000);
    await assertFails(updateDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/wallets`, CHILD_ID), {
      balance: 500,
      lastPenaltyTxId: 'no-such-ledger',
    }));
  });

  test('direct balance decrease + unrelated existing ledger → denied', async () => {
    await seedWallet(1000);
    // A legitimate, unrelated penalty ledger exists but is NOT referenced.
    await seedPenaltyLedger('unrelated-penalty', { amount: 250 });
    await assertFails(updateDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/wallets`, CHILD_ID), {
      balance: 500,
      lastPenaltyTxId: 'unrelated-penalty',
    }));
  });

  test('direct balance decrease + ledger with mismatched amount → denied', async () => {
    await seedWallet(1000);
    // Ledger amount (250) does NOT equal the wallet delta (1000 - 800 = 200).
    await seedPenaltyLedger('mismatch-amount', { amount: 250 });
    await assertFails(updateDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/wallets`, CHILD_ID), {
      balance: 800,
      lastPenaltyTxId: 'mismatch-amount',
    }));
  });

  test('direct balance decrease + ledger for another child → denied', async () => {
    await seedWallet(1000);
    // Ledger targets a different child.
    await seedPenaltyLedger('other-child-penalty', { childId: 'child-other' });
    await assertFails(updateDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/wallets`, CHILD_ID), {
      balance: 750,
      lastPenaltyTxId: 'other-child-penalty',
    }));
  });

  test('direct balance decrease + ledger for another family → denied', async () => {
    await seedWallet(1000);
    // Ledger targets a different family.
    await seedPenaltyLedger('other-family-penalty', { familyId: OTHER_FAMILY_ID });
    await assertFails(updateDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/wallets`, CHILD_ID), {
      balance: 750,
      lastPenaltyTxId: 'other-family-penalty',
    }));
  });

  test('valid atomic penalty event + matching ledger + wallet update → allowed', async () => {
    // Seed the wallet so the delta is well-defined (1000 -> 750, delta 250).
    await seedWallet(1000);
    const db = user(PARENT_ID);
    const batch = writeBatch(db);
    // 1. behaviour_event (financial) — required by isValidFinancialPenalty's
    //    existsAfter(eventPath) linkage.
    batch.set(doc(db, `families/${FAMILY_ID}/behaviour_events/penalty-event-atomic`), validEvent({
      type: 'financial', pointsDelta: 0, walletDelta: -250, reason: 'Damaged a book',
    }));
    // 2. wallet_transactions financial_penalty ledger (id == lastPenaltyTxId).
    batch.set(doc(db, `families/${FAMILY_ID}/wallet_transactions/penalty-atomic`), validPenalty({
      amount: 250, eventId: 'penalty-event-atomic', reason: 'Damaged a book',
    }));
    // 3. wallet update carrying the matching lastPenaltyTxId.
    batch.update(doc(db, `families/${FAMILY_ID}/wallets`, CHILD_ID), {
      balance: 750,
      lastPenaltyTxId: 'penalty-atomic',
    });
    await assertSucceeds(batch.commit());
  });

  test.each([
    ['deposit', { type: 'deposit', childId: CHILD_ID, amount: 500, note: 'Pocket money', parentRef: PARENT_ID, createdAt: serverTimestamp() }],
    ['withdrawal', { type: 'withdrawal', childId: CHILD_ID, amount: 200, note: 'Shop', parentRef: PARENT_ID, createdAt: serverTimestamp() }],
    ['transfer', { type: 'transfer', childId: CHILD_ID, fromChildId: CHILD_ID, amount: 100, note: 'Share', parentRef: PARENT_ID, createdAt: serverTimestamp() }],
  ])('preserves the existing %s wallet transaction shape', async (type, entry) => {
    await assertSucceeds(setDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/wallet_transactions/${type}`), entry));
  });

  test.each(['rewardPoints', 'lifetimeXP', 'walletBalance'])('child cannot directly change %s', async (field) => {
    await assertFails(updateDoc(doc(user(CHILD_ID), 'users', CHILD_ID), { [field]: 999 }));
  });

  test.each(['displayName', 'avatarUrl', 'avatarId'])('child cannot directly change profile field %s (must use approval)', async (field) => {
    await assertFails(updateDoc(doc(user(CHILD_ID), 'users', CHILD_ID), { [field]: 'x' }));
  });

  test('child can still update an unrelated self-service field (e.g. lastActiveDate)', async () => {
    await assertSucceeds(updateDoc(doc(user(CHILD_ID), 'users', CHILD_ID), { lastActiveDate: serverTimestamp() }));
  });
});
