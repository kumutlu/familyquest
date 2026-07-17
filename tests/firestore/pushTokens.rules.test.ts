import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, serverTimestamp, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'familyquest-push-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
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
    await setDoc(doc(db, 'users/owner1'), { familyId: 'family1', role: 'owner', displayName: 'Owner' });
    await setDoc(doc(db, 'users/parent1'), { familyId: 'family1', role: 'parent', displayName: 'Parent' });
    await setDoc(doc(db, 'users/child1'), { familyId: 'family1', role: 'child', displayName: 'C1' });
    await setDoc(doc(db, 'users/child2'), { familyId: 'family1', role: 'child', displayName: 'C2' });
    await setDoc(doc(db, 'users/owner2'), { familyId: 'family2', role: 'owner', displayName: 'Owner2' });
  });
});

// A well-formed push token owned by owner1 in family1.
function validToken(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'owner1',
    familyId: 'family1',
    token: 'fcm-token-abc',
    platform: 'desktop',
    browser: 'chrome',
    deviceLabel: 'chrome on desktop',
    appVersion: 'familyquest-web',
    userAgentSummary: 'Mozilla/5.0',
    enabled: true,
    permission: 'granted',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
    ...overrides,
  };
}

const tokenPath = 'families/family1/users/owner1/push_tokens/tok1';

describe('Push tokens (families/{familyId}/users/{userId}/push_tokens/{id})', () => {
  it('owner can create a valid push token for themselves', async () => {
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertSucceeds(setDoc(doc(db, tokenPath), validToken()));
  });

  it('user CANNOT create a push token for another userId', async () => {
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertFails(
      setDoc(doc(db, tokenPath), validToken({ userId: 'owner2' })),
    );
  });

  it('user CANNOT create a push token with a familyId that is not their family', async () => {
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertFails(
      setDoc(doc(db, tokenPath), validToken({ familyId: 'family2' })),
    );
  });

  it('user CANNOT create a push token with unexpected fields', async () => {
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertFails(
      setDoc(doc(db, tokenPath), validToken({ evil: 'exfiltrate' })),
    );
  });

  it('user CANNOT create a push token with enabled != true', async () => {
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertFails(
      setDoc(doc(db, tokenPath), validToken({ enabled: false })),
    );
  });

  it('user can read their own push token but another member cannot', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), tokenPath), validToken());
    });
    const ownerDb = testEnv.authenticatedContext('owner1').firestore();
    await assertSucceeds(getDoc(doc(ownerDb, tokenPath)));

    const otherDb = testEnv.authenticatedContext('child2').firestore();
    await assertFails(getDoc(doc(otherDb, tokenPath)));
  });

  it('user can update allowed fields but not immutable identity fields', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), tokenPath), validToken());
    });
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertSucceeds(
      updateDoc(doc(db, tokenPath), { enabled: false, permission: 'denied', updatedAt: serverTimestamp(), lastSeenAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(doc(db, tokenPath), { userId: 'owner2' }),
    );
    await assertFails(
      updateDoc(doc(db, tokenPath), { familyId: 'family2' }),
    );
  });

  it('user can delete their own push token but another member cannot', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), tokenPath), validToken());
    });
    const ownerDb = testEnv.authenticatedContext('owner1').firestore();
    await assertSucceeds(deleteDoc(doc(ownerDb, tokenPath)));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), tokenPath), validToken());
    });
    const otherDb = testEnv.authenticatedContext('child2').firestore();
    await assertFails(deleteDoc(doc(otherDb, tokenPath)));
  });
});

describe('Notification deliveries (families/{familyId}/notification_deliveries/{id})', () => {
  it('family member can read a delivery record', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'families/family1/notification_deliveries/d1'), {
        notificationId: 'd1',
        status: 'completed',
        tokenCount: 1,
        successCount: 1,
        failureCount: 0,
        deliveryVersion: 1,
      });
    });
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertSucceeds(getDoc(doc(db, 'families/family1/notification_deliveries/d1')));
  });

  it('cross-family user CANNOT read a delivery record', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'families/family1/notification_deliveries/d1'), {
        notificationId: 'd1',
        status: 'completed',
        tokenCount: 1,
        successCount: 1,
        failureCount: 0,
        deliveryVersion: 1,
      });
    });
    const db = testEnv.authenticatedContext('owner2').firestore();
    await assertFails(getDoc(doc(db, 'families/family1/notification_deliveries/d1')));
  });

  it('client CANNOT write a delivery record (backend-only)', async () => {
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertFails(
      setDoc(doc(db, 'families/family1/notification_deliveries/d1'), {
        notificationId: 'd1',
        status: 'completed',
        tokenCount: 1,
        successCount: 1,
        failureCount: 0,
        deliveryVersion: 1,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Focused regression coverage for the production permission-denied bug:
// registerCurrentDevice() does getDoc() FIRST (a read on a possibly
// non-existent document), then updateDoc()/setDoc(). The read rule must not
// throw on a missing document, otherwise the whole flow is denied.
// ---------------------------------------------------------------------------
describe('Push token registration flow (get-then-write)', () => {
  it('user can GET their own token document even when it does NOT exist yet', async () => {
    const db = testEnv.authenticatedContext('owner1').firestore();
    // No document has been written; this is the first-time registration pre-read.
    await assertSucceeds(getDoc(doc(db, tokenPath)));
  });

  it('user can GET their own existing token document', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), tokenPath), validToken());
    });
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertSucceeds(getDoc(doc(db, tokenPath)));
  });

  it('user CANNOT GET a sibling user\'s token document', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), tokenPath), validToken());
    });
    const db = testEnv.authenticatedContext('child2').firestore();
    await assertFails(getDoc(doc(db, 'families/family1/users/owner1/push_tokens/tok1')));
  });

  it('user CANNOT GET a token under a parent path they do not own', async () => {
    // owner1 trying to read owner2's token under family1/users/owner2.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'families/family1/users/owner2/push_tokens/tokX'), validToken({ userId: 'owner2' }));
    });
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertFails(getDoc(doc(db, 'families/family1/users/owner2/push_tokens/tokX')));
  });

  it('user can CREATE their own token (first-time registration)', async () => {
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertSucceeds(setDoc(doc(db, tokenPath), validToken()));
  });

  it('user can UPDATE their own existing token (token rotation)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), tokenPath), validToken());
    });
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertSucceeds(
      updateDoc(doc(db, tokenPath), {
        enabled: true,
        permission: 'granted',
        deviceLabel: 'chrome on desktop',
        updatedAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
      }),
    );
  });

  it('user can DELETE their own token', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), tokenPath), validToken());
    });
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertSucceeds(deleteDoc(doc(db, tokenPath)));
  });

  it('user CANNOT CREATE a token under another family', async () => {
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertFails(
      setDoc(doc(db, 'families/family2/users/owner1/push_tokens/tok1'), validToken({ familyId: 'family2' })),
    );
  });

  it('forged userId in create is rejected', async () => {
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertFails(setDoc(doc(db, tokenPath), validToken({ userId: 'owner2' })));
  });

  it('forged familyId in create is rejected', async () => {
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertFails(setDoc(doc(db, tokenPath), validToken({ familyId: 'family2' })));
  });

  it('create with permission != granted is rejected', async () => {
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertFails(setDoc(doc(db, tokenPath), validToken({ permission: 'default' })));
  });

  it('create with empty token string is rejected', async () => {
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertFails(setDoc(doc(db, tokenPath), validToken({ token: '' })));
  });

  it('create with unexpected fields is rejected', async () => {
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertFails(setDoc(doc(db, tokenPath), validToken({ evil: 'exfiltrate' })));
  });

  it('changing createdAt on update is rejected (immutable)', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), tokenPath), validToken());
    });
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertFails(
      updateDoc(doc(db, tokenPath), {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
      }),
    );
  });

  it('update without updatedAt == request.time is rejected', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), tokenPath), validToken());
    });
    const db = testEnv.authenticatedContext('owner1').firestore();
    await assertFails(
      updateDoc(doc(db, tokenPath), { enabled: false, permission: 'denied' }),
    );
  });

  it('user CANNOT update a sibling user\'s token', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), tokenPath), validToken());
    });
    const db = testEnv.authenticatedContext('child2').firestore();
    await assertFails(
      updateDoc(doc(db, 'families/family1/users/owner1/push_tokens/tok1'), {
        enabled: false,
        permission: 'denied',
        updatedAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
      }),
    );
  });

  it('user CANNOT delete a sibling user\'s token', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), tokenPath), validToken());
    });
    const db = testEnv.authenticatedContext('child2').firestore();
    await assertFails(deleteDoc(doc(db, 'families/family1/users/owner1/push_tokens/tok1')));
  });
});
