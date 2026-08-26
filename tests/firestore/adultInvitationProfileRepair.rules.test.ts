import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, describe, it } from 'vitest';

describe('adult invitation profile repair rules boundary', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: `adult-invite-profile-repair-${Date.now()}`,
      firestore: {
        rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
      },
    });
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'users', 'blank-user'), {
        uid: 'blank-user',
        displayName: '   ',
      });
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('continues to deny the invite page minimal client write for a missing profile', async () => {
    const db = testEnv.authenticatedContext('missing-user').firestore();
    await assertFails(setDoc(doc(db, 'users', 'missing-user'), {
      displayName: 'Missing User',
    }, { merge: true }));
  });

  it('continues to deny a direct display-name repair for an incomplete profile', async () => {
    const db = testEnv.authenticatedContext('blank-user').firestore();
    await assertFails(setDoc(doc(db, 'users', 'blank-user'), {
      displayName: 'Blank User',
    }, { merge: true }));
  });

  it('keeps profile-repair idempotency records server-only', async () => {
    const db = testEnv.authenticatedContext('blank-user').firestore();
    await assertFails(setDoc(
      doc(db, 'adultInvitationProfileCompletionIdempotency', 'blank-user_request-1'),
      { phase: 'complete' },
    ));
  });
});
