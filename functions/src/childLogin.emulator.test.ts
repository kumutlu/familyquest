import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

import {
  createChildLoginImpl,
  resetChildPasswordImpl,
  signInChildImpl,
} from './childLogin';

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const describeWithEmulator = emulatorAvailable ? describe : describe.skip;

describeWithEmulator('createChildLogin Firestore emulator integration', () => {
  let app: App;
  let db: Firestore;

  beforeAll(async () => {
    app = initializeApp({ projectId: 'familyquest-beta-402cb' }, 'child-login-integration');
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

const authEmulatorAvailable = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
const describeWithFirestoreAndAuth =
  emulatorAvailable && authEmulatorAvailable ? describe : describe.skip;

describeWithFirestoreAndAuth('managed child sign-in emulator integration', () => {
  let app: App;
  let db: Firestore;

  beforeAll(async () => {
    app = initializeApp(
      { projectId: 'familyquest-beta-402cb' },
      'child-signin-integration',
    );
    db = getFirestore(app);
    await Promise.all([
      db.doc('families/firestore-family-id').set({
        name: 'Integration Family',
        inviteCode: 'ABC123',
      }),
      db.doc('users/owner-signin').set({
        uid: 'owner-signin',
        familyId: 'firestore-family-id',
        role: 'owner',
        displayName: 'Owner',
      }),
      db.doc('users/profile-only-signin-child').set({
        uid: 'profile-only-signin-child',
        familyId: 'firestore-family-id',
        role: 'child',
        isManaged: true,
        displayName: 'Sign-in Child',
      }),
    ]);
  });

  afterAll(async () => {
    if (app) await deleteApp(app);
  });

  it('provisioning, reset, and sign-in share one Auth UID and one username index', async () => {
    const auth = getAuth(app);
    const context = { db, auth };
    await createChildLoginImpl(context, 'owner-signin', {
      childId: 'profile-only-signin-child',
      username: 'test_child',
      password: 'Initial123!',
      clientReqId: 'emulator-signin-create',
    });
    const privateRef = db.doc(
      'families/firestore-family-id/childLogins/profile-only-signin-child',
    );
    const provisioned = (await privateRef.get()).data();
    const provisionedAuthUid = String(provisioned?.authUid);

    await resetChildPasswordImpl(context, 'owner-signin', {
      childId: 'profile-only-signin-child',
      newPassword: 'Temporary456!',
      clientReqId: 'emulator-signin-reset',
    });
    const reset = (await privateRef.get()).data();

    await expect(signInChildImpl(context, {
      familyCode: ' abc123 ',
      username: ' TEST_CHILD ',
      password: 'Temporary456!',
    })).resolves.toMatchObject({ customToken: expect.any(String) });

    const [profile, usernameIndex, authUsers] = await Promise.all([
      db.doc('users/profile-only-signin-child').get(),
      db.doc('families/firestore-family-id/childLoginIndex/test_child').get(),
      auth.listUsers(),
    ]);
    expect(reset?.authUid).toBe(provisionedAuthUid);
    expect(usernameIndex.data()?.childId).toBe('profile-only-signin-child');
    expect(profile.data()?.lastLogin).toBeTruthy();
    expect(authUsers.users.filter(user => user.uid === provisionedAuthUid)).toHaveLength(1);
  });

  it('upgrades a QR-created child preserving Auth UID, claims, wallet, and enabling re-login', async () => {
    const auth = getAuth(app);
    const context = { db, auth };

    // 1. Seed family & owner
    await Promise.all([
      db.doc('families/firestore-qr-family').set({
        name: 'QR Family',
        inviteCode: 'QR1234',
      }),
      db.doc('users/owner-qr').set({
        uid: 'owner-qr',
        familyId: 'firestore-qr-family',
        role: 'owner',
        displayName: 'QR Owner',
      }),
    ]);

    // 2. Create real Firebase Auth user as created during QR onboarding
    const initialAuthUser = await auth.createUser({
      displayName: 'Alex',
    });
    const qrAuthUid = initialAuthUser.uid;

    await auth.setCustomUserClaims(qrAuthUid, {
      familyId: 'firestore-qr-family',
      role: 'child',
      childId: 'qr-child-1',
      managedChild: true,
    });

    // 3. Seed exact QR onboarding Firestore state
    await Promise.all([
      db.doc('users/qr-child-1').set({
        uid: 'qr-child-1',
        id: 'qr-child-1',
        familyId: 'firestore-qr-family',
        role: 'child',
        isManaged: true,
        displayName: 'Alex',
        authUid: qrAuthUid,
        hasLogin: false,
        loginEnabled: false,
      }),
      db.doc('families/firestore-qr-family/wallets/qr-child-1').set({
        balance: 100,
      }),
      db.doc('families/firestore-qr-family/childLogins/qr-child-1').set({
        childId: 'qr-child-1',
        authUid: qrAuthUid,
        familyId: 'firestore-qr-family',
        status: 'enabled',
      }),
    ]);

    const usersBeforeUpgrade = (await auth.listUsers()).users;
    const initialCount = usersBeforeUpgrade.length;

    // 4. Call createChildLogin to upgrade child to username/password
    const upgradeResult = await createChildLoginImpl(context, 'owner-qr', {
      childId: 'qr-child-1',
      username: 'alex_the_great',
      password: 'NewPassword123!',
      clientReqId: 'qr-upgrade-req-1',
    });

    expect(upgradeResult).toEqual({
      childId: 'qr-child-1',
      username: 'alex_the_great',
      loginEnabled: true,
    });

    // 5. Verify NO new Auth user was created (count unchanged, UID unchanged)
    const usersAfterUpgrade = (await auth.listUsers()).users;
    expect(usersAfterUpgrade.length).toBe(initialCount);

    const updatedAuthUser = await auth.getUser(qrAuthUid);
    expect(updatedAuthUser.uid).toBe(qrAuthUid);
    expect(updatedAuthUser.email).toBe('child-firestore-qr-family-alex_the_great@managed.familyquest.app');
    expect(updatedAuthUser.customClaims).toMatchObject({
      familyId: 'firestore-qr-family',
      role: 'child',
      childId: 'qr-child-1',
      managedChild: true,
    });

    // 6. Verify wallet preserved
    const walletSnap = await db.doc('families/firestore-qr-family/wallets/qr-child-1').get();
    expect(walletSnap.data()?.balance).toBe(100);

    // 7. Verify profile and indexes updated
    const [profileSnap, indexSnap, privateSnap] = await Promise.all([
      db.doc('users/qr-child-1').get(),
      db.doc('families/firestore-qr-family/childLoginIndex/alex_the_great').get(),
      db.doc('families/firestore-qr-family/childLogins/qr-child-1').get(),
    ]);

    expect(profileSnap.data()).toMatchObject({
      hasLogin: true,
      loginEnabled: true,
      authUid: qrAuthUid,
      username: 'alex_the_great',
    });
    expect(indexSnap.data()?.childId).toBe('qr-child-1');
    expect(privateSnap.data()).toMatchObject({
      authUid: qrAuthUid,
      normalizedUsername: 'alex_the_great',
      syntheticEmail: 'child-firestore-qr-family-alex_the_great@managed.familyquest.app',
      status: 'enabled',
    });

    // 8. Re-login test with username and password
    const signinResult = await signInChildImpl(context, {
      familyCode: ' qr1234 ',
      username: ' ALEX_THE_GREAT ',
      password: 'NewPassword123!',
    });
    expect(signinResult).toMatchObject({ customToken: expect.any(String) });

    // 9. Verify subsequent creation throws LOGIN_ALREADY_EXISTS
    await expect(
      createChildLoginImpl(context, 'owner-qr', {
        childId: 'qr-child-1',
        username: 'alex_different',
        password: 'AnotherPassword123!',
        clientReqId: 'qr-upgrade-req-2',
      }),
    ).rejects.toMatchObject({
      code: 'already-exists',
      message: 'LOGIN_ALREADY_EXISTS',
    });
  });
});
