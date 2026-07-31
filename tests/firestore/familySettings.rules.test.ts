import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const FAMILY_ID = 'settings-family';
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-family-settings-rules',
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
    await setDoc(doc(db, `families/${FAMILY_ID}`), {
      name: 'Original family',
      inviteCode: 'OLD123',
      currencyCode: 'GBP',
      timezone: 'Europe/London',
      weekStartsOn: 1,
    });
    await setDoc(doc(db, 'users/owner'), { familyId: FAMILY_ID, role: 'owner' });
    await setDoc(doc(db, 'users/parent'), { familyId: FAMILY_ID, role: 'parent' });
    await setDoc(doc(db, 'users/child'), { familyId: FAMILY_ID, role: 'child' });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

const familyRef = (uid: 'owner' | 'parent' | 'child') =>
  doc(testEnv.authenticatedContext(uid).firestore(), `families/${FAMILY_ID}`);

describe('family settings ownership', () => {
  it('allows the owner to update family and regional settings', async () => {
    await expect(assertSucceeds(updateDoc(familyRef('owner'), {
      name: 'Updated family',
      currencyCode: 'TRY',
      timezone: 'Europe/Istanbul',
      weekStartsOn: 0,
    }))).resolves.toBeUndefined();
  });

  it('denies direct invite-code regeneration even for the owner', async () => {
    await expect(assertFails(updateDoc(familyRef('owner'), {
      inviteCode: 'NEW456',
    }))).resolves.toBeDefined();
  });

  it.each(['parent', 'child'] as const)('denies %s family settings and invite-code updates', async role => {
    await expect(assertFails(updateDoc(familyRef(role), {
      currencyCode: 'TRY',
      timezone: 'Europe/Istanbul',
      weekStartsOn: 0,
    }))).resolves.toBeDefined();

    await expect(assertFails(updateDoc(familyRef(role), {
      inviteCode: 'FORGED',
    }))).resolves.toBeDefined();
  });

  it('allows only the owner to persist an audited setup completion and Pet Box toggle', async () => {
    await expect(assertSucceeds(updateDoc(familyRef('owner'), {
      setup: {
        welcomePromptCompleted: true,
        completedAt: serverTimestamp(),
        completedBy: 'owner',
      },
      petBoxEnabled: false,
    }))).resolves.toBeUndefined();

    for (const uid of ['parent', 'child'] as const) {
      await expect(assertFails(updateDoc(familyRef(uid), {
        setup: {
          welcomePromptCompleted: true,
          completedAt: serverTimestamp(),
          completedBy: uid,
        },
        petBoxEnabled: false,
      }))).resolves.toBeDefined();
    }
  });

  it('denies forged or malformed setup audit data and non-boolean Pet Box settings', async () => {
    await expect(assertFails(updateDoc(familyRef('owner'), {
      setup: {
        welcomePromptCompleted: true,
        completedAt: serverTimestamp(),
        completedBy: 'parent',
      },
    }))).resolves.toBeDefined();
    await expect(assertFails(updateDoc(familyRef('owner'), {
      setup: {
        welcomePromptCompleted: true,
        completedAt: serverTimestamp(),
        completedBy: 'owner',
        role: 'owner',
      },
    }))).resolves.toBeDefined();
    await expect(assertFails(updateDoc(familyRef('owner'), {
      petBoxEnabled: 'false',
    }))).resolves.toBeDefined();
  });

  it('preserves legacy Pet Box writes when missing and denies them when explicitly disabled', async () => {
    const childDb = testEnv.authenticatedContext('child').firestore();
    const request = {
      familyId: FAMILY_ID,
      fundId: 'fund-1',
      fundName: 'Pet',
      childId: 'child',
      childName: 'Child',
      amountPence: 100,
      status: 'pending',
      createdAt: serverTimestamp(),
    };
    await expect(assertSucceeds(setDoc(
      doc(childDb, `families/${FAMILY_ID}/petbox_requests/legacy-enabled`),
      request,
    ))).resolves.toBeUndefined();

    await assertSucceeds(updateDoc(familyRef('owner'), { petBoxEnabled: false }));
    await expect(assertFails(setDoc(
      doc(childDb, `families/${FAMILY_ID}/petbox_requests/disabled`),
      request,
    ))).resolves.toBeDefined();
  });
});

describe('regional settings on a family that already completed welcome setup', () => {
  const seedCompletedSetup = async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), `families/${FAMILY_ID}`), {
        name: 'Original family',
        inviteCode: 'OLD123',
        currencyCode: 'GBP',
        timezone: 'Europe/London',
        weekStartsOn: 1,
        setup: {
          welcomePromptCompleted: true,
          completedAt: new Date('2026-01-01T00:00:00Z'),
          completedBy: 'owner',
        },
      });
    });
  };

  beforeEach(seedCompletedSetup);

  it('allows the owner to change the currency', async () => {
    await expect(assertSucceeds(updateDoc(familyRef('owner'), {
      currencyCode: 'TRY',
    }))).resolves.toBeUndefined();
  });

  it('allows the owner to change the timezone', async () => {
    await expect(assertSucceeds(updateDoc(familyRef('owner'), {
      timezone: 'Europe/Istanbul',
    }))).resolves.toBeUndefined();
  });

  it('allows the owner to change the week start', async () => {
    await expect(assertSucceeds(updateDoc(familyRef('owner'), {
      weekStartsOn: 0,
    }))).resolves.toBeUndefined();
  });

  it.each(['parent', 'child'] as const)('denies %s regional updates', async role => {
    await expect(assertFails(updateDoc(familyRef(role), {
      currencyCode: 'TRY',
      timezone: 'Europe/Istanbul',
      weekStartsOn: 0,
    }))).resolves.toBeDefined();
  });

  it('denies an owner of another family', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'users/outsider'), {
        familyId: 'other-family',
        role: 'owner',
      });
    });
    const outsiderRef = doc(
      testEnv.authenticatedContext('outsider').firestore(),
      `families/${FAMILY_ID}`,
    );
    await expect(assertFails(updateDoc(outsiderRef, {
      currencyCode: 'TRY',
    }))).resolves.toBeDefined();
  });

  it('still rejects illegal writes alongside regional changes', async () => {
    await expect(assertFails(updateDoc(familyRef('owner'), {
      currencyCode: 'TRY',
      inviteCode: 'FORGED',
    }))).resolves.toBeDefined();

    await expect(assertFails(updateDoc(familyRef('owner'), {
      currencyCode: 'TRY',
      lifecycleState: 'deleting',
    }))).resolves.toBeDefined();

    // Actually mutating the setup audit block still has to satisfy
    // isValidFamilySetup(): a backdated completedAt is rejected.
    await expect(assertFails(updateDoc(familyRef('owner'), {
      setup: {
        welcomePromptCompleted: true,
        completedAt: new Date('2026-02-02T00:00:00Z'),
        completedBy: 'owner',
      },
    }))).resolves.toBeDefined();

    await expect(assertFails(updateDoc(familyRef('owner'), {
      setup: {
        welcomePromptCompleted: true,
        completedAt: serverTimestamp(),
        completedBy: 'parent',
      },
    }))).resolves.toBeDefined();
  });
});
