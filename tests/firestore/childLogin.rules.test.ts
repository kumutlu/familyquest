// ---------------------------------------------------------------------------
// FOCUSED FIRESTORE RULES TESTS — Parent-Created Child Login (Phase 1)
// ---------------------------------------------------------------------------
// Verifies that the four new server-owned collections are denied to all
// clients, and that the new user-profile login fields (hasLogin, username,
// loginEnabled, requiresPasswordChange, authUid) cannot be written by any
// client. Also asserts existing parent/child profile rules are NOT weakened.
// ---------------------------------------------------------------------------

import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest';

let testEnv: any;
const projectId = 'familyquest-childlogin-rules';
const familyId = 'familyABC';
const ownerId = 'owner1';
const parentId = 'parent1';
const childId = 'child1';
const childAuthUid = 'auth-child1';
const strangerId = 'stranger1';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context: any) => {
    const db = context.firestore();
    // Rules only grant access to an existing, active family document.
    await setDoc(doc(db, 'families', familyId), { name: 'Family', currencyCode: 'GBP' });
    await setDoc(doc(db, 'users', ownerId), { familyId, role: 'owner', displayName: 'Owner' });
    await setDoc(doc(db, 'users', parentId), { familyId, role: 'parent', displayName: 'Parent' });
    await setDoc(doc(db, 'users', childId), {
      familyId,
      role: 'child',
      isManaged: true,
      authUid: childAuthUid,
      displayName: 'Alex',
    });
    await setDoc(doc(db, 'users', strangerId), { familyId: 'other', role: 'parent', displayName: 'Stranger' });
  });
});

describe('managed-child restricted identity', () => {
  const managedClaims = {
    role: 'child',
    managedChild: true,
    childId,
    familyId,
  };

  it('allows the linked Firebase Auth identity to hydrate its managed profile', async () => {
    const db = testEnv.authenticatedContext(childAuthUid, managedClaims).firestore();
    await assertSucceeds(getDoc(doc(db, 'users', childId)));
  });

  it('denies family data while requiresPasswordChange is active', async () => {
    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      await updateDoc(doc(context.firestore(), 'users', childId), { requiresPasswordChange: true });
      await setDoc(doc(context.firestore(), 'families', familyId), { name: 'Family' });
    });
    const db = testEnv.authenticatedContext(childAuthUid, managedClaims).firestore();
    await assertSucceeds(getDoc(doc(db, 'users', childId)));
    await assertFails(getDoc(doc(db, 'families', familyId)));
  });

  it('rejects forged claims when Auth UID linkage does not match', async () => {
    const db = testEnv.authenticatedContext('wrong-auth-uid', managedClaims).firestore();
    await assertFails(getDoc(doc(db, 'users', childId)));
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('server-owned child-login collections are denied to clients', () => {
  it('owner cannot read/write childLoginIndex', async () => {
    const db = testEnv.authenticatedContext(ownerId).firestore();
    await assertFails(getDoc(doc(db, `families/${familyId}/childLoginIndex/alex`)));
    await assertFails(
      setDoc(doc(db, `families/${familyId}/childLoginIndex/alex`), { childId, normalizedUsername: 'alex' }),
    );
  });

  it('parent cannot read/write childLogins', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertFails(getDoc(doc(db, `families/${familyId}/childLogins/${childId}`)));
    await assertFails(
      setDoc(doc(db, `families/${familyId}/childLogins/${childId}`), { syntheticEmail: 'x@y.z', authUid: 'u' }),
    );
  });

  it('child cannot read/write childLoginAudit', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(getDoc(doc(db, `families/${familyId}/childLoginAudit/audit1`)));
    await assertFails(
      setDoc(doc(db, `families/${familyId}/childLoginAudit/audit1`), { type: 'login_created' }),
    );
  });

  it('stranger cannot read/write childLoginIdempotency', async () => {
    const db = testEnv.authenticatedContext(strangerId).firestore();
    await assertFails(getDoc(doc(db, `families/${familyId}/childLoginIdempotency/req1`)));
    await assertFails(
      setDoc(doc(db, `families/${familyId}/childLoginIdempotency/req1`), { status: 'completed' }),
    );
  });

  it('unauthenticated caller cannot access the new collections', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `families/${familyId}/childLoginIndex/alex`)));
    await assertFails(
      setDoc(doc(db, `families/${familyId}/childLogins/${childId}`), { authUid: 'u' }),
    );
  });
});

describe('new user login fields are server-only (clients cannot write them)', () => {
  it('a child cannot set login fields on their own profile', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    await assertFails(
      updateDoc(doc(db, 'users', childId), { hasLogin: true, loginEnabled: true }),
    );
    await assertFails(updateDoc(doc(db, 'users', childId), { authUid: 'some-uid' }));
    await assertFails(updateDoc(doc(db, 'users', childId), { username: 'alex' }));
  });

  it('a parent cannot set login fields on a child profile', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertFails(
      updateDoc(doc(db, 'users', childId), { loginEnabled: false, requiresPasswordChange: true }),
    );
    await assertFails(updateDoc(doc(db, 'users', childId), { authUid: 'some-uid' }));
  });

  it('a stranger from another family cannot set login fields', async () => {
    const db = testEnv.authenticatedContext(strangerId).firestore();
    await assertFails(updateDoc(doc(db, 'users', childId), { hasLogin: true }));
  });
});

describe('existing profile rules are NOT weakened (regression)', () => {
  it('a parent may still update a child displayName', async () => {
    const db = testEnv.authenticatedContext(parentId).firestore();
    await assertSucceeds(updateDoc(doc(db, 'users', childId), { displayName: 'Alexander' }));
  });

  it('a child may still read a family member profile (which now carries login fields)', async () => {
    const db = testEnv.authenticatedContext(childId).firestore();
    // Seed server-owned fields via rules-disabled context, then confirm a child
    // can read the profile (the fields are present but client-writable only by server).
    await testEnv.withSecurityRulesDisabled(async (context: any) => {
      await setDoc(
        context.firestore().collection('users').doc(childId),
        { familyId, role: 'child', isManaged: true, displayName: 'Alex', hasLogin: true, username: 'alex', loginEnabled: true },
        { merge: true },
      );
    });
    const snap = await getDoc(doc(db, 'users', childId));
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.hasLogin).toBe(true);
  });
});
