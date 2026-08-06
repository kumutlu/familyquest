import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, beforeAll, afterAll, beforeEach, it } from 'vitest';

/**
 * Reward inventory rules.
 *
 * A child redeems inside a client transaction that must decrement the reward's
 * remaining `inventory` by exactly one. Rules therefore allow a family member to
 * update ONLY that field, only by -1, only from a positive integer stock — and
 * nothing else.
 */

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-reward-inventory-rules-test',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'families/family1'), { name: 'Family 1' });
    await setDoc(doc(db, 'families/family2'), { name: 'Family 2' });
    await setDoc(doc(db, 'users/child1'), { familyId: 'family1', role: 'child' });
    await setDoc(doc(db, 'users/child3'), { familyId: 'family2', role: 'child' });
    await setDoc(doc(db, 'families/family1/rewards/limited'), { title: 'Movie', cost: 10, isActive: true, inventory: 3 });
    await setDoc(doc(db, 'families/family1/rewards/last'), { title: 'Cake', cost: 10, isActive: true, inventory: 1 });
    await setDoc(doc(db, 'families/family1/rewards/empty'), { title: 'Toy', cost: 10, isActive: true, inventory: 0 });
    await setDoc(doc(db, 'families/family1/rewards/unlimited'), { title: 'Hug', cost: 10, isActive: true, inventory: null });
  });
});

describe('Reward inventory rules', () => {
  it('allows a child to decrement stock by exactly one', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertSucceeds(updateDoc(doc(db, 'families/family1/rewards/limited'), { inventory: 2 }));
  });

  it('allows the final unit to go 1 -> 0', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertSucceeds(updateDoc(doc(db, 'families/family1/rewards/last'), { inventory: 0 }));
  });

  it('never allows inventory to go negative', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(updateDoc(doc(db, 'families/family1/rewards/empty'), { inventory: -1 }));
  });

  it('denies decrementing by more than one', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(updateDoc(doc(db, 'families/family1/rewards/limited'), { inventory: 1 }));
  });

  it('denies a child increasing stock', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(updateDoc(doc(db, 'families/family1/rewards/limited'), { inventory: 4 }));
  });

  it('denies a child editing any other reward field alongside inventory', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(updateDoc(doc(db, 'families/family1/rewards/limited'), { inventory: 2, cost: 1 }));
    await assertFails(updateDoc(doc(db, 'families/family1/rewards/limited'), { cost: 1 }));
  });

  it('denies writing inventory on an unlimited reward', async () => {
    const db = testEnv.authenticatedContext('child1').firestore();
    await assertFails(updateDoc(doc(db, 'families/family1/rewards/unlimited'), { inventory: 5 }));
  });

  it('denies cross-family inventory writes', async () => {
    const db = testEnv.authenticatedContext('child3').firestore();
    await assertFails(updateDoc(doc(db, 'families/family1/rewards/limited'), { inventory: 2 }));
  });
});
