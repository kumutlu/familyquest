import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

let testEnv: any;
const projectId = 'familyquest-beta-402cb';
const familyId = 'family123';
const parentId = 'parent456';
const childId = 'child789';

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

    // Owner (for family settings tests)
    await setDoc(doc(db, 'users', parentId), {
      familyId,
      role: 'owner',
      displayName: 'Kemal'
    });

    // Child
    await setDoc(doc(db, 'users', childId), {
      familyId,
      role: 'child',
      displayName: 'Alin Asya',
      rewardPoints: 100,
      lifetimeXP: 100
    });

    // Family
    await setDoc(doc(db, `families/${familyId}`), {
      name: 'Test Family'
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Gamification Phase 1 Security Rules', () => {

  describe('Server-only collections', () => {
    it('denies all client reads on task_occurrences', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, 'task_occurrences', 'occurrence123')));
    });

    it('denies all client writes on task_occurrences', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(setDoc(doc(db, 'task_occurrences', 'occurrence123'), {
        familyId,
        taskId: 'task1',
        childId
      }));
    });

    it('denies all client reads on gamification_events', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, 'gamification_events', 'event123')));
    });

    it('denies all client writes on gamification_events', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(setDoc(doc(db, 'gamification_events', 'event123'), {
        familyId,
        childId,
        type: 'task_approval'
      }));
    });

    it('denies all client reads on daily_eligibility', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, 'daily_eligibility', 'eligibility123')));
    });

    it('denies all client writes on daily_eligibility', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(setDoc(doc(db, 'daily_eligibility', 'eligibility123'), {
        familyId,
        childId,
        date: '2024-01-01'
      }));
    });

    it('denies all client reads on daily_progress', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, 'daily_progress', 'progress123')));
    });

    it('denies all client writes on daily_progress', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(setDoc(doc(db, 'daily_progress', 'progress123'), {
        familyId,
        childId,
        date: '2024-01-01',
        progress: 50
      }));
    });

    it('denies all client reads on gamification_summaries', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, 'gamification_summaries', 'summary123')));
    });

    it('denies all client writes on gamification_summaries', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(setDoc(doc(db, 'gamification_summaries', 'summary123'), {
        familyId,
        childId,
        totalXP: 1000
      }));
    });

    it('denies all client reads on gamification_checkpoints', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, 'gamification_checkpoints', 'checkpoint123')));
    });

    it('denies all client writes on gamification_checkpoints', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(setDoc(doc(db, 'gamification_checkpoints', 'checkpoint123'), {
        familyId,
        lastProcessed: serverTimestamp()
      }));
    });
  });

  describe('Family gamificationConfig validation', () => {
    it('allows owner to set valid gamificationConfig', async () => {
      const db = testEnv.authenticatedContext(parentId).firestore();
      await assertSucceeds(updateDoc(doc(db, `families/${familyId}`), {
        gamificationConfig: {
          schemaVersion: 1,
          dailyGoalPercentage: 80
        }
      }));
    });

    it('allows owner to update gamificationConfig with valid percentage', async () => {
      const db = testEnv.authenticatedContext(parentId).firestore();
      // First set a valid config
      await updateDoc(doc(db, `families/${familyId}`), {
        gamificationConfig: {
          schemaVersion: 1,
          dailyGoalPercentage: 80
        }
      });
      // Then update to another valid value
      await assertSucceeds(updateDoc(doc(db, `families/${familyId}`), {
        'gamificationConfig.dailyGoalPercentage': 75
      }));
    });

    it('denies owner with invalid dailyGoalPercentage (below 50)', async () => {
      const db = testEnv.authenticatedContext(parentId).firestore();
      await assertFails(updateDoc(doc(db, `families/${familyId}`), {
        gamificationConfig: {
          schemaVersion: 1,
          dailyGoalPercentage: 49
        }
      }));
    });

    it('denies owner with invalid dailyGoalPercentage (above 100)', async () => {
      const db = testEnv.authenticatedContext(parentId).firestore();
      await assertFails(updateDoc(doc(db, `families/${familyId}`), {
        gamificationConfig: {
          schemaVersion: 1,
          dailyGoalPercentage: 101
        }
      }));
    });

    it('denies owner with non-integer dailyGoalPercentage', async () => {
      const db = testEnv.authenticatedContext(parentId).firestore();
      await assertFails(updateDoc(doc(db, `families/${familyId}`), {
        gamificationConfig: {
          schemaVersion: 1,
          dailyGoalPercentage: 75.5
        }
      }));
    });

    it('denies owner with missing schemaVersion', async () => {
      const db = testEnv.authenticatedContext(parentId).firestore();
      await assertFails(updateDoc(doc(db, `families/${familyId}`), {
        gamificationConfig: {
          dailyGoalPercentage: 80
        }
      }));
    });

    it('denies owner with wrong schemaVersion', async () => {
      const db = testEnv.authenticatedContext(parentId).firestore();
      await assertFails(updateDoc(doc(db, `families/${familyId}`), {
        gamificationConfig: {
          schemaVersion: 2,
          dailyGoalPercentage: 80
        }
      }));
    });

    it('denies owner with extra fields in gamificationConfig', async () => {
      const db = testEnv.authenticatedContext(parentId).firestore();
      await assertFails(updateDoc(doc(db, `families/${familyId}`), {
        gamificationConfig: {
          schemaVersion: 1,
          dailyGoalPercentage: 80,
          extraField: 'not-allowed'
        }
      }));
    });

    it('allows owner to update family without gamificationConfig', async () => {
      const db = testEnv.authenticatedContext(parentId).firestore();
      await assertSucceeds(updateDoc(doc(db, `families/${familyId}`), {
        name: 'Updated Family Name'
      }));
    });

    it('denies non-owner from setting gamificationConfig', async () => {
      const db = testEnv.authenticatedContext(childId).firestore();
      await assertFails(updateDoc(doc(db, `families/${familyId}`), {
        gamificationConfig: {
          schemaVersion: 1,
          dailyGoalPercentage: 80
        }
      }));
    });
  });
});