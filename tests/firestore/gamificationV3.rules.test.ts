import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

let testEnv: any;
const projectId = 'familyquest-v3-rules';
const familyId = 'v3-family';
const parentId = 'v3-parent';
const childId = 'v3-child';

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

    // Parent
    await setDoc(doc(db, 'users', parentId), {
      familyId,
      role: 'owner',
      displayName: 'Parent',
    });

    // Child
    await setDoc(doc(db, 'users', childId), {
      familyId,
      role: 'child',
      displayName: 'Child',
      rewardPoints: 100,
      lifetimeXP: 100,
    });

    // Family
    await setDoc(doc(db, `families/${familyId}`), {
      name: 'V3 Test Family',
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Gamification V3 Shadow Collection Security Rules', () => {
  // -------------------------------------------------------------------------
  // gamification_events_v3
  // -------------------------------------------------------------------------
  describe('gamification_events_v3', () => {
    it('allows parent to read for own family', async () => {
      const db = testEnv.authenticatedContext(parentId, { familyId }).firestore();
      await assertSucceeds(getDoc(doc(db, `families/${familyId}/gamification_events_v3/evt-1`)));
    });

    it('allows child to read for own family', async () => {
      const db = testEnv.authenticatedContext(childId, { familyId }).firestore();
      await assertSucceeds(getDoc(doc(db, `families/${familyId}/gamification_events_v3/evt-1`)));
    });

    it('denies client write to gamification_events_v3', async () => {
      const db = testEnv.authenticatedContext(parentId, { familyId }).firestore();
      await assertFails(setDoc(doc(db, `families/${familyId}/gamification_events_v3/evt-1`), {
        eventId: 'evt-1',
        eventType: 'TASK_APPROVED',
        familyId,
        memberId: childId,
      }));
    });

    it('denies unauthenticated read of gamification_events_v3', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, `families/${familyId}/gamification_events_v3/evt-1`)));
    });
  });

  // -------------------------------------------------------------------------
  // gamification_state_v3
  // -------------------------------------------------------------------------
  describe('gamification_state_v3', () => {
    it('allows parent to read for own family', async () => {
      const db = testEnv.authenticatedContext(parentId, { familyId }).firestore();
      await assertSucceeds(getDoc(doc(db, `families/${familyId}/gamification_state_v3/${childId}`)));
    });

    it('allows child to read for own family', async () => {
      const db = testEnv.authenticatedContext(childId, { familyId }).firestore();
      await assertSucceeds(getDoc(doc(db, `families/${familyId}/gamification_state_v3/${childId}`)));
    });

    it('denies client write to gamification_state_v3', async () => {
      const db = testEnv.authenticatedContext(parentId, { familyId }).firestore();
      await assertFails(setDoc(doc(db, `families/${familyId}/gamification_state_v3/${childId}`), {
        memberId: childId,
        familyId,
        rewardPoints: 100,
      }));
    });

    it('denies unauthenticated read of gamification_state_v3', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, `families/${familyId}/gamification_state_v3/${childId}`)));
    });
  });

  // -------------------------------------------------------------------------
  // gamification_v3_failures
  // -------------------------------------------------------------------------
  describe('gamification_v3_failures', () => {
    it('allows parent to read for own family', async () => {
      const db = testEnv.authenticatedContext(parentId, { familyId }).firestore();
      await assertSucceeds(getDoc(doc(db, `families/${familyId}/gamification_v3_failures/fail-1`)));
    });

    it('denies child to read gamification_v3_failures', async () => {
      const db = testEnv.authenticatedContext(childId, { familyId }).firestore();
      await assertFails(getDoc(doc(db, `families/${familyId}/gamification_v3_failures/fail-1`)));
    });

    it('denies client write to gamification_v3_failures', async () => {
      const db = testEnv.authenticatedContext(parentId, { familyId }).firestore();
      await assertFails(setDoc(doc(db, `families/${familyId}/gamification_v3_failures/fail-1`), {
        familyId,
        memberId: childId,
        errorMessage: 'test',
      }));
    });

    it('denies unauthenticated read of gamification_v3_failures', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, `families/${familyId}/gamification_v3_failures/fail-1`)));
    });
  });
});