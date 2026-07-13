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

  test('child can still update an unrelated self-service field', async () => {
    await assertSucceeds(updateDoc(doc(user(CHILD_ID), 'users', CHILD_ID), { displayName: 'Casey Updated' }));
  });
});
