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
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
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
  type: 'financial_penalty',
  behaviourEventId: 'event-financial',
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
  ])('rejects malformed event: %s', async (_label, overrides) => {
    const event = validEvent(overrides);
    if (overrides.walletDelta === undefined) delete event.walletDelta;
    await assertFails(setDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/behaviour_events/malformed`), event));
  });

  test('events are append-only', async () => {
    await assertSucceeds(setDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/behaviour_events/immutable`), validEvent()));
    await assertFails(updateDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/behaviour_events/immutable`), { reason: 'Changed later' }));
    await assertFails(deleteDoc(doc(user(OWNER_ID), `families/${FAMILY_ID}/behaviour_events/immutable`)));
  });
});

describe('wallet ledger and direct balance writes', () => {
  test('valid financial penalty ledger entry can be created by a parent', async () => {
    await assertSucceeds(setDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/wallet_transactions/penalty`), validPenalty()));
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
    if (overrides.behaviourEventId === undefined) delete entry.behaviourEventId;
    await assertFails(setDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/wallet_transactions/bad-penalty`), entry));
  });

  test('wallet ledger is immutable after creation', async () => {
    await assertSucceeds(setDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/wallet_transactions/immutable`), validPenalty()));
    await assertFails(updateDoc(doc(user(PARENT_ID), `families/${FAMILY_ID}/wallet_transactions/immutable`), { amount: 1 }));
    await assertFails(deleteDoc(doc(user(OWNER_ID), `families/${FAMILY_ID}/wallet_transactions/immutable`)));
  });

  test.each(['rewardPoints', 'lifetimeXP', 'walletBalance'])('child cannot directly change %s', async (field) => {
    await assertFails(updateDoc(doc(user(CHILD_ID), 'users', CHILD_ID), { [field]: 999 }));
  });

  test('child can still update an unrelated self-service field', async () => {
    await assertSucceeds(updateDoc(doc(user(CHILD_ID), 'users', CHILD_ID), { displayName: 'Casey Updated' }));
  });
});
