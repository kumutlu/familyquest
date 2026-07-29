import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import { createChildLoginImpl } from './childLogin';

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const describeWithEmulator = emulatorAvailable ? describe : describe.skip;

describeWithEmulator('createChildLogin Firestore emulator integration', () => {
  let app: App;
  let db: Firestore;

  beforeAll(async () => {
    app = initializeApp({ projectId: 'familyquest-child-login-integration' }, 'child-login-integration');
    db = getFirestore(app);
    await db.doc('users/owner-1').set({
      uid: 'owner-1',
      familyId: 'family-1',
      role: 'owner',
      displayName: 'Owner',
    });
    await db.doc('users/profile-only-child').set({
      uid: 'profile-only-child',
      familyId: 'family-1',
      role: 'child',
      isManaged: true,
      displayName: 'Profile Only',
    });
  });

  afterAll(async () => {
    if (app) await deleteApp(app);
  });

  it('provisions a profile-only child without a Firestore read-after-write error', async () => {
    const authUsers = new Map<string, Record<string, unknown>>();
    const auth = {
      createUser: vi.fn(async (input: Record<string, unknown>) => {
        const uid = 'managed-auth-1';
        authUsers.set(uid, { ...input, uid });
        return { uid };
      }),
      setCustomUserClaims: vi.fn(async () => undefined),
      deleteUser: vi.fn(async (uid: string) => {
        authUsers.delete(uid);
      }),
    };

    await expect(createChildLoginImpl(
      { db, auth: auth as any },
      'owner-1',
      {
        childId: 'profile-only-child',
        username: 'profile_only',
        password: 'SafePass123!',
        clientReqId: 'emulator-profile-only',
      },
    )).resolves.toEqual({
      childId: 'profile-only-child',
      username: 'profile_only',
      loginEnabled: true,
    });

    const [profile, privateLogin, usernameIndex] = await Promise.all([
      db.doc('users/profile-only-child').get(),
      db.doc('families/family-1/childLogins/profile-only-child').get(),
      db.doc('families/family-1/childLoginIndex/profile_only').get(),
    ]);
    expect(profile.data()).toMatchObject({
      hasLogin: true,
      loginEnabled: true,
      authUid: 'managed-auth-1',
    });
    expect(privateLogin.exists).toBe(true);
    expect(usernameIndex.data()?.childId).toBe('profile-only-child');
    expect(authUsers.size).toBe(1);
  });
});
