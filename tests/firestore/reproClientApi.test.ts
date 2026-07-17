import { describe, it, beforeAll } from 'vitest';
import { connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator } from 'firebase/firestore';
import { auth, db } from '../../src/lib/firebase';
import { submitProfileUpdateRequest } from '../../src/lib/api';

describe('repro client api', () => {
  beforeAll(async () => {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    await signInWithEmailAndPassword(auth, 'child@test.com', 'password123');
  });

  it('submit display-name-only', async () => {
    try {
      await submitProfileUpdateRequest('test-fam', 'Leo Debug', null, {
        ownedAvatarIds: [],
        legacyAvatarUrl: null,
      });
      console.log('SUBMIT OK');
    } catch (e: any) {
      console.log('FULL ERROR:', JSON.stringify({ code: e?.code, message: e?.message, stack: e?.stack }, null, 2));
    }
  });
});
