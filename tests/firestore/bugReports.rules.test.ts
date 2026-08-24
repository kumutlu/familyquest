import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-bug-reports',
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
    // Seed families
    await setDoc(doc(db, 'families', 'family-1'), {
      name: 'Family One',
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'families', 'family-2'), {
      name: 'Family Two',
      createdAt: serverTimestamp(),
    });

    // Seed users
    await setDoc(doc(db, 'users', 'owner-1'), {
      uid: 'owner-1',
      familyId: 'family-1',
      role: 'owner',
      displayName: 'Owner One',
    });
    await setDoc(doc(db, 'users', 'parent-1'), {
      uid: 'parent-1',
      familyId: 'family-1',
      role: 'parent',
      displayName: 'Parent One',
    });
    await setDoc(doc(db, 'users', 'child-1'), {
      uid: 'child-1',
      familyId: 'family-1',
      role: 'child',
      displayName: 'Child One',
    });
    await setDoc(doc(db, 'users', 'other-user'), {
      uid: 'other-user',
      familyId: 'family-2',
      role: 'parent',
      displayName: 'Other User',
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Bug Reports — Firestore Security Rules', () => {
  const validContext = {
    releaseSha: '5e2f2b0',
    releaseVersion: '1.0.0',
    route: '/rewards',
    theme: 'dark',
    locale: 'en',
    viewport: { width: 390, height: 844 },
    standalone: false,
    online: true,
    userAgent: 'Mozilla/5.0 TestBrowser',
    swControlled: true,
  };

  it('ALLOW: owner submits own valid report', async () => {
    const db = testEnv.authenticatedContext('owner-1').firestore();
    await assertSucceeds(
      setDoc(doc(db, 'bug_reports', 'report-1'), {
        familyId: 'family-1',
        reporterUserId: 'owner-1',
        reporterRole: 'owner',
        category: 'broken',
        description: 'The tasks page is not refreshing',
        technicalContext: validContext,
        status: 'open',
        createdAt: serverTimestamp(),
      }),
    );
  });

  it('ALLOW: parent submits own valid report', async () => {
    const db = testEnv.authenticatedContext('parent-1').firestore();
    await assertSucceeds(
      setDoc(doc(db, 'bug_reports', 'report-2'), {
        familyId: 'family-1',
        reporterUserId: 'parent-1',
        reporterRole: 'parent',
        category: 'points_rewards',
        description: 'Reward redemption showed loading for too long',
        technicalContext: validContext,
        status: 'open',
        createdAt: serverTimestamp(),
      }),
    );
  });

  it('ALLOW: child submits own valid report', async () => {
    const db = testEnv.authenticatedContext('child-1').firestore();
    await assertSucceeds(
      setDoc(doc(db, 'bug_reports', 'report-3'), {
        familyId: 'family-1',
        reporterUserId: 'child-1',
        reporterRole: 'child',
        category: 'visual',
        description: 'The star was upside down',
        technicalContext: validContext,
        status: 'open',
        createdAt: serverTimestamp(),
      }),
    );
  });

  it('DENY: unauthenticated report submission', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, 'bug_reports', 'report-unauth'), {
        familyId: 'family-1',
        reporterUserId: 'owner-1',
        reporterRole: 'owner',
        category: 'broken',
        description: 'Unauth bug report',
        technicalContext: validContext,
        status: 'open',
        createdAt: serverTimestamp(),
      }),
    );
  });

  it('DENY: reporterUserId spoof (caller uses another user ID)', async () => {
    const db = testEnv.authenticatedContext('parent-1').firestore();
    await assertFails(
      setDoc(doc(db, 'bug_reports', 'report-spoof-user'), {
        familyId: 'family-1',
        reporterUserId: 'owner-1', // Spoofed user ID
        reporterRole: 'parent',
        category: 'broken',
        description: 'Trying to impersonate owner',
        technicalContext: validContext,
        status: 'open',
        createdAt: serverTimestamp(),
      }),
    );
  });

  it('DENY: familyId spoof (caller uses another family ID)', async () => {
    const db = testEnv.authenticatedContext('parent-1').firestore();
    await assertFails(
      setDoc(doc(db, 'bug_reports', 'report-spoof-family'), {
        familyId: 'family-2', // Spoofed family ID
        reporterUserId: 'parent-1',
        reporterRole: 'parent',
        category: 'broken',
        description: 'Cross family spoof attempt',
        technicalContext: validContext,
        status: 'open',
        createdAt: serverTimestamp(),
      }),
    );
  });

  it('DENY: unexpected privileged fields in payload', async () => {
    const db = testEnv.authenticatedContext('owner-1').firestore();
    await assertFails(
      setDoc(doc(db, 'bug_reports', 'report-privileged'), {
        familyId: 'family-1',
        reporterUserId: 'owner-1',
        reporterRole: 'owner',
        category: 'broken',
        description: 'Payload with privileged field',
        technicalContext: validContext,
        status: 'open',
        createdAt: serverTimestamp(),
        adminNotes: 'Should not be allowed',
        resolvedBy: 'super-admin',
      }),
    );
  });

  it('DENY: reading reports by any client (write-only security)', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, 'bug_reports', 'report-exist'), {
        familyId: 'family-1',
        reporterUserId: 'owner-1',
        reporterRole: 'owner',
        category: 'broken',
        description: 'Secret report',
        status: 'open',
        createdAt: serverTimestamp(),
      });
    });

    // Own user cannot read
    const dbOwner = testEnv.authenticatedContext('owner-1').firestore();
    await assertFails(getDoc(doc(dbOwner, 'bug_reports', 'report-exist')));

    // Other family cannot read
    const dbOther = testEnv.authenticatedContext('other-user').firestore();
    await assertFails(getDoc(doc(dbOther, 'bug_reports', 'report-exist')));
  });

  it('DENY: arbitrary update on existing reports', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, 'bug_reports', 'report-exist'), {
        familyId: 'family-1',
        reporterUserId: 'owner-1',
        reporterRole: 'owner',
        category: 'broken',
        description: 'Immutable report',
        status: 'open',
        createdAt: serverTimestamp(),
      });
    });

    const dbOwner = testEnv.authenticatedContext('owner-1').firestore();
    await assertFails(updateDoc(doc(dbOwner, 'bug_reports', 'report-exist'), { status: 'closed' }));
  });

  it('DENY: arbitrary deletion of reports', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, 'bug_reports', 'report-exist'), {
        familyId: 'family-1',
        reporterUserId: 'owner-1',
        reporterRole: 'owner',
        category: 'broken',
        description: 'Immutable report',
        status: 'open',
        createdAt: serverTimestamp(),
      });
    });

    const dbOwner = testEnv.authenticatedContext('owner-1').firestore();
    await assertFails(deleteDoc(doc(dbOwner, 'bug_reports', 'report-exist')));
  });
});
