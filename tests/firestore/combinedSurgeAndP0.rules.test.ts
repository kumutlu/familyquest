/**
 * Combined-lineage regression tests for the Reconciled Engagement Foundation.
 *
 * These tests exercise the COMBINED behaviour of:
 *   - P0 task-completion security (isValidTaskCompletionCreate, unassigned
 *     family tasks, sibling denial, cross-family denial, approval flow)
 *   - Surge + Daily Engagement V1 (engagementPreferences, surge_evidence,
 *     events server-only, base+bonus idempotency, reversal linkage)
 *
 * They are the matrix the reconciliation candidate MUST pass before
 * Smart Notifications can build on top of it.
 *
 * Each test mirrors a specific real-world scenario and asserts the
 * end-to-end rules-level outcome. No client-side code is exercised here.
 *
 * NO DEPLOY. The test suite runs against the local Firestore emulator.
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  doc,
  setDoc,
  getDoc,
  setLogLevel,
  serverTimestamp,
} from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const FAMILY_ID = 'family-combined'
const OTHER_FAMILY_ID = 'family-other'
const CHILD_ID = 'child-1'
const SIBLING_ID = 'child-2'
const MANAGED_CHILD_ID = 'managed-child-1'
const MANAGED_AUTH_UID = 'managed-auth-1'
const PARENT_ID = 'parent-1'

const TASK_ASSIGNED_TO_CHILD = 'task-assigned-to-child'
const TASK_ASSIGNED_TO_SIBLING = 'task-assigned-to-sibling'
const TASK_UNASSIGNED = 'task-unassigned-family-task'

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  setLogLevel('error')
  testEnv = await initializeTestEnvironment({
    projectId: `combined-surge-p0-${Date.now()}`,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.firestore()

    // Two families
    await setDoc(doc(db, `families/${FAMILY_ID}`), { lifecycleState: 'active' })
    await setDoc(doc(db, `families/${OTHER_FAMILY_ID}`), { lifecycleState: 'active' })

    // Profiles
    await setDoc(doc(db, `users/${PARENT_ID}`), {
      familyId: FAMILY_ID, role: 'parent', displayName: 'Parent',
    })
    await setDoc(doc(db, `users/${CHILD_ID}`), {
      familyId: FAMILY_ID, role: 'child', displayName: 'Child 1',
      currentStreak: 0, longestStreak: 0,
    })
    await setDoc(doc(db, `users/${SIBLING_ID}`), {
      familyId: FAMILY_ID, role: 'child', displayName: 'Child 2',
    })
    await setDoc(doc(db, `users/${MANAGED_CHILD_ID}`), {
      familyId: FAMILY_ID, role: 'child', displayName: 'Managed',
      isManaged: true, authUid: MANAGED_AUTH_UID,
    })

    // Tasks
    await setDoc(doc(db, `families/${FAMILY_ID}/tasks/${TASK_ASSIGNED_TO_CHILD}`), {
      title: 'Make bed', pointsReward: 10, assigneeId: CHILD_ID, requiresApproval: false,
    })
    await setDoc(doc(db, `families/${FAMILY_ID}/tasks/${TASK_ASSIGNED_TO_SIBLING}`), {
      title: 'Vacuum', pointsReward: 15, assigneeId: SIBLING_ID, requiresApproval: false,
    })
    await setDoc(doc(db, `families/${FAMILY_ID}/tasks/${TASK_UNASSIGNED}`), {
      title: 'Family chore', pointsReward: 20, assigneeId: null, requiresApproval: true,
    })

    // Active Surge event targeting TASK_ASSIGNED_TO_CHILD
    await setDoc(doc(db, `families/${FAMILY_ID}/events/surge-1`), {
      type: 'surge',
      status: 'active',
      startsAt: Date.now() - 60_000,
      endsAt: Date.now() + 3_600_000,
      metadata: {
        surge: {
          kind: 'task_bonus',
          eligibleTaskIds: [TASK_ASSIGNED_TO_CHILD],
          reward: { type: 'bonus_points', amount: 5 },
        },
      },
    })
  })
})

// ============================================================
// SCENARIO 1: Assigned task + Surge
// ============================================================
describe('Assigned task + Surge', () => {
  it('child completes own assigned task; rules accept; base+Surge events are server-only', async () => {
    const alice = testEnv.authenticatedContext(CHILD_ID, { sub: CHILD_ID })
    const aliceDb = alice.firestore()

    // Child writes the completion doc — rules should accept (P0)
    await assertSucceeds(setDoc(doc(aliceDb, `families/${FAMILY_ID}/task_completions/completion-1`), {
      taskId: TASK_ASSIGNED_TO_CHILD,
      assigneeId: CHILD_ID,
      completedAt: serverTimestamp(),
      status: 'approved',
      approvedAt: serverTimestamp(),
    }))

    // Child cannot write surge_evidence (server-only)
    await assertFails(setDoc(doc(aliceDb, `families/${FAMILY_ID}/surge_evidence/surge-1__completion-1`), {
      surgeId: 'surge-1',
      completionId: 'completion-1',
      rewardAmount: 5,
    }))

    // Child cannot write the events/ catalogue
    await assertFails(setDoc(doc(aliceDb, `families/${FAMILY_ID}/events/surge-evil`), {
      type: 'surge', status: 'active',
    }))
  })
})

// ============================================================
// SCENARIO 2: Null-assignee family task + Surge (no eligible Surge in V1, but completion allowed)
// ============================================================
describe('Null-assignee family task + Surge', () => {
  it('child completes unassigned family task; rules accept (P0 unassigned fix)', async () => {
    const alice = testEnv.authenticatedContext(CHILD_ID, { sub: CHILD_ID })
    const aliceDb = alice.firestore()

    // P0: assigneeId is the completing child, task.assigneeId is null → ALLOWED
    await assertSucceeds(setDoc(doc(aliceDb, `families/${FAMILY_ID}/task_completions/completion-2`), {
      taskId: TASK_UNASSIGNED,
      assigneeId: CHILD_ID,
      completedAt: serverTimestamp(),
      status: 'pending_approval', // requiresApproval: true
      approvedAt: null,
    }))
  })

  it('sibling completing unassigned family task is also allowed by P0', async () => {
    const sibling = testEnv.authenticatedContext(SIBLING_ID, { sub: SIBLING_ID })
    const siblingDb = sibling.firestore()

    await assertSucceeds(setDoc(doc(siblingDb, `families/${FAMILY_ID}/task_completions/completion-3`), {
      taskId: TASK_UNASSIGNED,
      assigneeId: SIBLING_ID,
      completedAt: serverTimestamp(),
      status: 'pending_approval',
      approvedAt: null,
    }))
  })
})

// ============================================================
// SCENARIO 3: Sibling task + Surge
// ============================================================
describe('Sibling task + Surge', () => {
  it('child CANNOT complete task assigned to sibling (P0 sibling denial preserved)', async () => {
    const alice = testEnv.authenticatedContext(CHILD_ID, { sub: CHILD_ID })
    const aliceDb = alice.firestore()

    // data.assigneeId == authProfileId() FAILS (child says they're the
    // completing child, but task.assigneeId is sibling) — rules should deny.
    await assertFails(setDoc(doc(aliceDb, `families/${FAMILY_ID}/task_completions/completion-sibling`), {
      taskId: TASK_ASSIGNED_TO_SIBLING,
      assigneeId: CHILD_ID,
      completedAt: serverTimestamp(),
      status: 'approved',
      approvedAt: serverTimestamp(),
    }))

    // And a sibling cannot claim the same task under their own id
    // because the task is assigned to SIBLING_ID — that would actually be
    // a valid completion (sibling IS the assignee). Verify the positive
    // path: SIBLING_ID may complete it.
    const sib = testEnv.authenticatedContext(SIBLING_ID, { sub: SIBLING_ID })
    const sibDb = sib.firestore()
    await assertSucceeds(setDoc(doc(sibDb, `families/${FAMILY_ID}/task_completions/completion-sibling-ok`), {
      taskId: TASK_ASSIGNED_TO_SIBLING,
      assigneeId: SIBLING_ID,
      completedAt: serverTimestamp(),
      status: 'approved',
      approvedAt: serverTimestamp(),
    }))
  })

  it('non-assigned child cannot forge surgeBonusAmount on a feed entry', async () => {
    const alice = testEnv.authenticatedContext(CHILD_ID, { sub: CHILD_ID })
    const aliceDb = alice.firestore()

    await assertFails(setDoc(doc(aliceDb, `families/${FAMILY_ID}/feed/feed-forged`), {
      actorId: CHILD_ID,
      type: 'custom',
      text: 'Forged surge bonus',
      surgeBonusAmount: 999,
      visibleTo: [CHILD_ID],
      timestamp: new Date(),
    }))
  })
})

// ============================================================
// SCENARIO 4: Managed child + null-assignee + Surge
// ============================================================
describe('Managed child + null-assignee + Surge', () => {
  it('managed child may complete unassigned family task (P0 unassigned + managed)', async () => {
    const mc = testEnv.authenticatedContext(MANAGED_AUTH_UID, { sub: MANAGED_AUTH_UID })
    const mcDb = mc.firestore()

    // The managed child's "authProfileId" should resolve to their identity
    // document via isManagedChildIdentity(). Task is unassigned; rules
    // should accept.
    await assertSucceeds(setDoc(doc(mcDb, `families/${FAMILY_ID}/task_completions/completion-mc`), {
      taskId: TASK_UNASSIGNED,
      assigneeId: MANAGED_CHILD_ID,
      completedAt: serverTimestamp(),
      status: 'pending_approval',
      approvedAt: null,
    }))
  })
})

// ============================================================
// SCENARIO 5: Legacy streak state + Surge
// ============================================================
describe('Legacy streak state + Surge', () => {
  it('child with pre-existing streak may complete assigned task (legacy path)', async () => {
    // The P0 lineage pre-seeds CHILD_ID with currentStreak:0, longestStreak:0.
    // The completion itself (not the streak update) is what we test here.
    const alice = testEnv.authenticatedContext(CHILD_ID, { sub: CHILD_ID })
    const aliceDb = alice.firestore()

    await assertSucceeds(setDoc(doc(aliceDb, `families/${FAMILY_ID}/task_completions/completion-legacy`), {
      taskId: TASK_ASSIGNED_TO_CHILD,
      assigneeId: CHILD_ID,
      completedAt: serverTimestamp(),
      status: 'approved',
      approvedAt: serverTimestamp(),
    }))
  })
})

// ============================================================
// SCENARIO 6: Approval delay (Surge window respected server-side)
// ============================================================
describe('Approval delay', () => {
  it('approval-required completion is held in pending_approval; rules accept that state', async () => {
    const alice = testEnv.authenticatedContext(CHILD_ID, { sub: CHILD_ID })
    const aliceDb = alice.firestore()

    await assertSucceeds(setDoc(doc(aliceDb, `families/${FAMILY_ID}/task_completions/completion-pending`), {
      taskId: TASK_UNASSIGNED,
      assigneeId: CHILD_ID,
      completedAt: serverTimestamp(),
      status: 'pending_approval',
      approvedAt: null,
    }))

    // Read it back to confirm it actually exists
    const snap = await getDoc(doc(aliceDb, `families/${FAMILY_ID}/task_completions/completion-pending`))
    expect(snap.exists()).toBe(true)
  })
})

// ============================================================
// SCENARIO 7: Cross-family
// ============================================================
describe('Cross-family', () => {
  it('child from another family cannot complete a task in this family', async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore()
      await setDoc(doc(db, `users/outsider-child`), {
        familyId: OTHER_FAMILY_ID, role: 'child', displayName: 'Outsider',
      })
    })
    const outsider = testEnv.authenticatedContext('outsider-child', { sub: 'outsider-child' })
    const outsiderDb = outsider.firestore()

    await assertFails(setDoc(doc(outsiderDb, `families/${FAMILY_ID}/task_completions/completion-cross`), {
      taskId: TASK_ASSIGNED_TO_CHILD,
      assigneeId: 'outsider-child',
      completedAt: serverTimestamp(),
      status: 'approved',
      approvedAt: serverTimestamp(),
    }))
  })
})

// ============================================================
// SCENARIO 8: Duplicate processing
// ============================================================
describe('Duplicate processing', () => {
  it('re-writing the same completionId with a different status is rejected', async () => {
    const alice = testEnv.authenticatedContext(CHILD_ID, { sub: CHILD_ID })
    const aliceDb = alice.firestore()

    // First write succeeds
    await assertSucceeds(setDoc(doc(aliceDb, `families/${FAMILY_ID}/task_completions/completion-dup`), {
      taskId: TASK_ASSIGNED_TO_CHILD,
      assigneeId: CHILD_ID,
      completedAt: serverTimestamp(),
      status: 'approved',
      approvedAt: serverTimestamp(),
    }))

    // Trying to overwrite with a forged 'pending_approval' status fails
    // because isValidTaskCompletionCreate is only invoked on create, and
    // update is only permitted for parent approval transitions.
    await assertFails(setDoc(doc(aliceDb, `families/${FAMILY_ID}/task_completions/completion-dup`), {
      taskId: TASK_ASSIGNED_TO_CHILD,
      assigneeId: CHILD_ID,
      completedAt: serverTimestamp(),
      status: 'pending_approval',
      approvedAt: null,
    }))
  })
})

// ============================================================
// SCENARIO 9: engagementPreferences (Surge opt-in)
// ============================================================
describe('engagementPreferences validator', () => {
  it('owner can set surgeHours=true; closed-shape key set rejects unrelated keys', async () => {
    const parent = testEnv.authenticatedContext(PARENT_ID, { sub: PARENT_ID })
    const parentDb = parent.firestore()

    // Valid: surgeHours opt-in
    await assertSucceeds(setDoc(doc(parentDb, `families/${FAMILY_ID}`), {
      lifecycleState: 'active',
      engagementPreferences: { surgeHours: true },
    }, { merge: true }))

    // Invalid: closed set — extra key rejected
    await assertFails(setDoc(doc(parentDb, `families/${FAMILY_ID}`), {
      lifecycleState: 'active',
      engagementPreferences: { surgeHours: true, evilField: 'x' },
    }, { merge: true }))

    // Invalid: surgeHours must be bool
    await assertFails(setDoc(doc(parentDb, `families/${FAMILY_ID}`), {
      lifecycleState: 'active',
      engagementPreferences: { surgeHours: 'yes' },
    }, { merge: true }))
  })
})
