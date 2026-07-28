import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-user-language',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'users', 'user-a'), {
      uid: 'user-a',
      familyId: 'family-1',
      role: 'parent',
      displayName: 'User A',
      rewardPoints: 10,
      lifetimeXP: 20,
    });
    await setDoc(doc(db, 'users', 'user-b'), {
      uid: 'user-b',
      familyId: 'family-1',
      role: 'child',
      displayName: 'User B',
      rewardPoints: 30,
      lifetimeXP: 40,
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('user language preference rules', () => {
  it.each(['en', 'tr'])('allows a user to set their own supported language %s', async language => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertSucceeds(updateDoc(doc(db, 'users', 'user-a'), { language }));
  });

  it('rejects an unsupported language', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'user-a'), { language: 'de' }));
  });

  it('rejects changing another user language', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'user-b'), { language: 'tr' }));
  });

  it('does not permit a language update to carry protected-field changes', async () => {
    const db = testEnv.authenticatedContext('user-a').firestore();
    await assertFails(updateDoc(doc(db, 'users', 'user-a'), {
      language: 'tr',
      rewardPoints: 999,
      lifetimeXP: 999,
      role: 'owner',
      familyId: 'other-family',
    }));
  });
});
