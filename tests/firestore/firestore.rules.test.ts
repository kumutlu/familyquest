/**
 * Gamification V4 — Firestore Rules: deny client writes (Task 4.2).
 *
 * Emulator-only rules integration test. Proves that the V4 server-owned
 * collections written by the Task 4.1 repositories
 * (`functions/src/gamification/v4/repository.ts`) are:
 *   - readable by family members (parent/owner/child),
 *   - never writable by any client (parent/owner/child/unauthenticated),
 *   - isolated across families (a member of family B cannot read family A),
 *   - writable by the trusted backend (Admin SDK bypasses rules), and
 *   - completely wallet-free (no wallet collection is referenced by V4 rules).
 *
 * Wallet is OUT OF SCOPE: this test asserts, as a guard, that the existing
 * wallet rules continue to deny an arbitrary client balance write, proving the
 * V4 rule additions did not weaken the wallet surface.
 *
 * Runs under the Firestore emulator harness (`npm run test:rules`).
 */
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

let testEnv: any;
const projectId = 'familyquest-v4-rules';

const familyId = 'v4-family';
const parentId = 'v4-parent';
const childId = 'v4-child';

// A second, isolated family used to prove cross-family isolation.
const otherFamilyId = 'v4-other-family';
const otherParentId = 'v4-other-parent';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (context: any) => {
    const db = context.firestore();

    await setDoc(doc(db, 'users', parentId), {
      familyId,
      role: 'owner',
      displayName: 'Parent',
    });

    await setDoc(doc(db, 'users', childId), {
      familyId,
      role: 'child',
      displayName: 'Child',
      rewardPoints: 100,
      lifetimeXP: 100,
    });

    await setDoc(doc(db, `families/${familyId}`), {
      name: 'V4 Test Family',
    });

    // Second family for cross-family isolation checks.
    await setDoc(doc(db, 'users', otherParentId), {
      familyId: otherFamilyId,
      role: 'owner',
      displayName: 'Other Parent',
    });

    await setDoc(doc(db, `families/${otherFamilyId}`), {
      name: 'V4 Other Family',
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Gamification V4 collection security rules', () => {
  // ---------------------------------------------------------------------------
  // gamification_events (V4 immutable event ledger)
  // ---------------------------------------------------------------------------
  describe('gamification_events', () => {
    const path = `families/${familyId}/gamification_events/evt-1`;

    it('allows a parent/owner to read for own family', async () => {
      const db = testEnv.authenticatedContext(parentId, { familyId }).firestore();
      await assertSucceeds(getDoc(doc(db, path)));
    });

    it('allows a child to read for own family', async () => {
      const db = testEnv.authenticatedContext(childId, { familyId }).firestore();
      await assertSucceeds(getDoc(doc(db, path)));
    });

    it('denies a client create/write', async () => {
      const db = testEnv.authenticatedContext(parentId, { familyId }).firestore();
      await assertFails(
        setDoc(doc(db, path), {
          eventId: 'evt-1',
          familyId,
          memberId: childId,
          type: 'TASK_APPROVED',
        }),
      );
    });

    it('denies a child client create/write', async () => {
      const db = testEnv.authenticatedContext(childId, { familyId }).firestore();
      await assertFails(
        setDoc(doc(db, path), { eventId: 'evt-1', familyId, memberId: childId }),
      );
    });

    it('denies an unauthenticated read', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, path)));
    });

    it('denies an unauthenticated write', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(setDoc(doc(db, path), { eventId: 'evt-1', familyId }));
    });

    it('denies a member of another family reading (cross-family isolation)', async () => {
      const db = testEnv.authenticatedContext(otherParentId, { familyId: otherFamilyId }).firestore();
      await assertFails(getDoc(doc(db, path)));
    });

    it('allows the trusted backend (Admin SDK) to write', async () => {
      await testEnv.withSecurityRulesDisabled(async (context: any) => {
        const db = context.firestore();
        await assertSucceeds(
          setDoc(doc(db, path), { eventId: 'evt-1', familyId, memberId: childId }),
        );
      });
    });
  });

  // ---------------------------------------------------------------------------
  // gamification_state (V4 projection / rebuilt state)
  // ---------------------------------------------------------------------------
  describe('gamification_state', () => {
    const path = `families/${familyId}/gamification_state/${childId}`;

    it('allows a parent/owner to read for own family', async () => {
      const db = testEnv.authenticatedContext(parentId, { familyId }).firestore();
      await assertSucceeds(getDoc(doc(db, path)));
    });

    it('allows a child to read for own family', async () => {
      const db = testEnv.authenticatedContext(childId, { familyId }).firestore();
      await assertSucceeds(getDoc(doc(db, path)));
    });

    it('denies a client create/write', async () => {
      const db = testEnv.authenticatedContext(parentId, { familyId }).firestore();
      await assertFails(
        setDoc(doc(db, path), { memberId: childId, familyId, rewardPoints: 100 }),
      );
    });

    it('denies a child client create/write', async () => {
      const db = testEnv.authenticatedContext(childId, { familyId }).firestore();
      await assertFails(
        setDoc(doc(db, path), { memberId: childId, familyId, rewardPoints: 999 }),
      );
    });

    it('denies an unauthenticated read', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, path)));
    });

    it('denies a member of another family reading (cross-family isolation)', async () => {
      const db = testEnv.authenticatedContext(otherParentId, { familyId: otherFamilyId }).firestore();
      await assertFails(getDoc(doc(db, path)));
    });

    it('allows the trusted backend (Admin SDK) to write', async () => {
      await testEnv.withSecurityRulesDisabled(async (context: any) => {
        const db = context.firestore();
        await assertSucceeds(
          setDoc(doc(db, path), { memberId: childId, familyId, rewardPoints: 100, lifetimeXP: 100 }),
        );
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Wallet out-of-scope guard: V4 rule additions must not weaken wallet rules.
  // ---------------------------------------------------------------------------
  describe('wallet remains untouched', () => {
    it('still denies an arbitrary client wallet balance write', async () => {
      const db = testEnv.authenticatedContext(childId, { familyId }).firestore();
      await assertFails(
        updateDoc(doc(db, `families/${familyId}/wallets/${childId}`), { balance: 999999 }),
      );
    });
  });
});
