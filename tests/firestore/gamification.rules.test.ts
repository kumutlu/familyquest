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

    it('denies unauthenticated reads on daily_progress', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, `families/${familyId}/daily_progress`, `${childId}:2024-01-01`)));
    });

    it('denies all client writes on daily_progress', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(setDoc(doc(db, `families/${familyId}/daily_progress`, `${childId}:2024-01-01`), {
        familyId,
        childId,
        dayKey: '2024-01-01',
        progressPercentage: 50
      }));
    });

    it('denies unauthenticated reads on gamification_summaries', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, `families/${familyId}/gamification_summaries`, childId)));
    });

    it('denies all client writes on gamification_summaries', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(setDoc(doc(db, `families/${familyId}/gamification_summaries`, childId), {
        familyId,
        childId,
        xpTotal: 1000,
        level: 1
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

  describe('Role-scoped gamification read access', () => {
    // Setup: create gamification documents for testing
    beforeEach(async () => {
      await testEnv.withSecurityRulesDisabled(async (context: any) => {
        const db = context.firestore();
        // Create a summary for the child
        await setDoc(doc(db, `families/${familyId}/gamification_summaries`, childId), {
          familyId,
          childId,
          xpTotal: 1000,
          level: 1,
          currentStreak: 5,
          bestStreak: 10,
          perfectDayCount: 3,
          lastQualifiedDayKey: '2024-01-01',
          projectionRevision: 1,
          foldedThrough: null,
          rebuildRequired: false,
          earliestDirtyCursor: null,
          projectionStatus: 'ready',
          updatedAt: serverTimestamp()
        });
        // Create a daily progress for the child
        await setDoc(doc(db, `families/${familyId}/daily_progress`, `${childId}:2024-01-01`), {
          familyId,
          childId,
          dayKey: '2024-01-01',
          timezone: 'Europe/London',
          eligibilitySnapshotId: 'snapshot123',
          dailyGoalPercentage: 80,
          eligiblePoints: 100,
          approvedPoints: 80,
          eligibleTaskCount: 5,
          approvedTaskCount: 4,
          progressPercentage: 80,
          dailyGoalReached: true,
          perfectDayReached: false,
          finalized: true,
          contributingLogicalCompletionKeys: [],
          invalidatedLogicalCompletionKeys: [],
          calculatedAt: serverTimestamp()
        });
      });
    });

    it('allows parent to read any family child summary', async () => {
      const db = testEnv.authenticatedContext(parentId).firestore();
      await assertSucceeds(getDoc(doc(db, `families/${familyId}/gamification_summaries`, childId)));
    });

    it('allows parent to read any family child daily progress', async () => {
      const db = testEnv.authenticatedContext(parentId).firestore();
      await assertSucceeds(getDoc(doc(db, `families/${familyId}/daily_progress`, `${childId}:2024-01-01`)));
    });

    it('allows child to read own summary', async () => {
      const db = testEnv.authenticatedContext(childId).firestore();
      await assertSucceeds(getDoc(doc(db, `families/${familyId}/gamification_summaries`, childId)));
    });

    it('allows child to read own daily progress', async () => {
      const db = testEnv.authenticatedContext(childId).firestore();
      await assertSucceeds(getDoc(doc(db, `families/${familyId}/daily_progress`, `${childId}:2024-01-01`)));
    });

    it('denies child from reading another child summary', async () => {
      const otherChildId = 'otherChild999';
      await testEnv.withSecurityRulesDisabled(async (context: any) => {
        const db = context.firestore();
        await setDoc(doc(db, 'users', otherChildId), {
          familyId,
          role: 'child',
          displayName: 'Other Child'
        });
        await setDoc(doc(db, `families/${familyId}/gamification_summaries`, otherChildId), {
          familyId,
          childId: otherChildId,
          xpTotal: 500,
          level: 1
        });
      });
      const db = testEnv.authenticatedContext(childId).firestore();
      await assertFails(getDoc(doc(db, `families/${familyId}/gamification_summaries`, otherChildId)));
    });

    it('denies child from reading another child daily progress', async () => {
      const otherChildId = 'otherChild999';
      await testEnv.withSecurityRulesDisabled(async (context: any) => {
        const db = context.firestore();
        await setDoc(doc(db, 'users', otherChildId), {
          familyId,
          role: 'child',
          displayName: 'Other Child'
        });
        await setDoc(doc(db, `families/${familyId}/daily_progress`, `${otherChildId}:2024-01-01`), {
          familyId,
          childId: otherChildId,
          dayKey: '2024-01-01',
          progressPercentage: 50
        });
      });
      const db = testEnv.authenticatedContext(childId).firestore();
      await assertFails(getDoc(doc(db, `families/${familyId}/daily_progress`, `${otherChildId}:2024-01-01`)));
    });

    it('denies all clients write access to gamification_summaries', async () => {
      const db = testEnv.authenticatedContext(parentId).firestore();
      await assertFails(setDoc(doc(db, `families/${familyId}/gamification_summaries`, childId), {
        familyId,
        childId,
        xpTotal: 2000,
        level: 2
      }));
    });

    it('denies all clients write access to daily_progress', async () => {
      const db = testEnv.authenticatedContext(parentId).firestore();
      await assertFails(setDoc(doc(db, `families/${familyId}/daily_progress`, `${childId}:2024-01-02`), {
        familyId,
        childId,
        dayKey: '2024-01-02',
        progressPercentage: 100
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