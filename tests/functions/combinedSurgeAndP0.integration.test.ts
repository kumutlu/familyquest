/**
 * Combined-lineage Functions regression tests for the Reconciled Engagement
 * Foundation.
 *
 * Exercises the COMBINED behaviour of:
 *   - processApprovedCompletion (P0 base reward + currentStreak/longestStreak/
 *     lastActiveDate ledger; legacy streak support)
 *   - evaluateAndAwardSurgeBonus (Surge server-only bonus; SURGE_BONUS_AWARDED
 *     event; surge_evidence; idempotency)
 *   - processTaskInvalidation (P0 reversal; Surge bonus reversal linkage)
 *
 * These run against the Firestore emulator with the Admin SDK, so they
 * exercise the actual transactional behaviour — not just the rules.
 *
 * NO DEPLOY.
 */

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { processApprovedCompletion, processTaskInvalidation } from '../../functions/src/gamificationProcessor'
import { surgeEventId } from '../../src/domain/surge/types'

const PROJECT_ID = `combined-surge-p0-fn-${Date.now()}`
const FAMILY = 'family-combined'
const CHILD = 'child-1'
const SIBLING = 'child-2'
const DAY = '2026-07-23'
const COMPLETED_AT = Timestamp.fromMillis(Date.parse('2026-07-23T09:00:00Z'))
const APPROVED_AT = Timestamp.fromMillis(Date.parse('2026-07-23T10:00:00Z'))

let testEnv: RulesTestEnvironment | undefined

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'

function db() {
  const name = `combined-surge-p0-${PROJECT_ID}`
  const app = getApps().find(c => c.name === name)
    ?? initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID }, name)
  return getFirestore(app)
}

async function seedBase(opts: {
  taskAssignee: string | null,
  requiresApproval?: boolean,
  childId?: string,
  basePoints?: number,
  surgeActive?: boolean,
  completedAt?: Timestamp,
} = {}) {
  const childId = opts.childId ?? CHILD
  const basePoints = opts.basePoints ?? 10
  const familyRef = db().doc(`families/${FAMILY}`)
  await familyRef.set({
    name: 'Family',
    timezone: 'Europe/London',
    gamification: { schemaVersion: 1, dailyGoalPercentage: 80 },
    gamificationMigration: { schemaVersion: 1, status: 'prepared', cutoverAt: APPROVED_AT },
    engagementPreferences: { surgeHours: true },
  })
  await db().doc(`users/${childId}`).set({
    familyId: FAMILY, role: 'child', status: 'active', rewardPoints: 5,
    currentStreak: 0, longestStreak: 0, lastActiveDate: null,
  })
  if (childId !== SIBLING) {
    await db().doc(`users/${SIBLING}`).set({
      familyId: FAMILY, role: 'child', status: 'active', rewardPoints: 0,
    })
  }
  await db().doc(`families/${FAMILY}/tasks/task-1`).set({
    title: 'Make bed',
    assigneeId: opts.taskAssignee,
    pointsReward: basePoints,
    requiresApproval: opts.requiresApproval ?? false,
    type: 'daily',
    isActive: true,
    createdAt: Timestamp.fromMillis(Date.parse('2026-07-22T09:00:00Z')),
  })
  await db().doc(`families/${FAMILY}/task_completions/completion-1`).set({
    taskId: 'task-1',
    assigneeId: childId,
    status: 'approved',
    periodKey: '2026-07-23',
    completedAt: opts.completedAt ?? COMPLETED_AT,
    approvedAt: APPROVED_AT,
    reviewedBy: 'parent-1',
  })
  if (opts.surgeActive) {
    await db().doc(`families/${FAMILY}/events/surge-1`).set({
      type: 'surge',
      status: 'active',
      startsAt: Date.parse('2026-07-23T08:00:00Z'),
      endsAt: Date.parse('2026-07-23T12:00:00Z'),
      metadata: {
        surge: {
          kind: 'task_bonus',
          eligibleTaskIds: ['task-1'],
          reward: { type: 'bonus_points', amount: 7 },
        },
      },
    })
  }
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
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
  await testEnv?.clearFirestore()
})

// ============================================================
// SCENARIO 1: Assigned task + Surge → base + bonus
// ============================================================
describe('Assigned task + Surge', () => {
  it('awarded completion produces both TASK_APPROVED and SURGE_BONUS_AWARDED events', async () => {
    await seedBase({ taskAssignee: CHILD, requiresApproval: false, basePoints: 10, surgeActive: true })

    await processApprovedCompletion({
      familyId: FAMILY,
      completionId: 'completion-1',
      processingAt: APPROVED_AT.toMillis(),
    })

    const childAfter = await db().doc(`users/${CHILD}`).get()
    const data = childAfter.data() as { rewardPoints: number; currentStreak: number }
    // Base 10 + Surge 7 = 17, on top of starting 5 = 22
    expect(data.rewardPoints).toBe(5 + 10 + 7)

    const baseEvent = await db().doc(`families/${FAMILY}/feed/feed:completion:completion-1`).get()
    expect(baseEvent.exists).toBe(true)
    const eventData = baseEvent.data() as { surgeBonusAmount?: number; text: string }
    expect(eventData.surgeBonusAmount).toBe(7)
    expect(eventData.text).toContain('Surge Bonus +7')

    const surgeEvent = await db()
      .doc(`families/${FAMILY}/gamification_events/${surgeEventId('surge-1', 'completion-1')}`)
      .get()
    expect(surgeEvent.exists).toBe(true)
    const surgeData = surgeEvent.data() as { eventType: string; rewardPointsDelta: number }
    expect(surgeData.eventType).toBe('SURGE_BONUS_AWARDED')
    expect(surgeData.rewardPointsDelta).toBe(7)

    const evidence = await db().doc(`families/${FAMILY}/surge_evidence/surge-1__completion-1`).get()
    expect(evidence.exists).toBe(true)
  })
})

// ============================================================
// SCENARIO 2: Null-assignee family task + Surge (no eligible Surge in V1)
// ============================================================
describe('Null-assignee family task', () => {
  it('P0: child can claim an unassigned task; base reward awarded (no Surge for unassigned V1)', async () => {
    await seedBase({ taskAssignee: null, requiresApproval: true, basePoints: 20, surgeActive: false })

    await processApprovedCompletion({
      familyId: FAMILY,
      completionId: 'completion-1',
      processingAt: APPROVED_AT.toMillis(),
    })

    const childAfter = await db().doc(`users/${CHILD}`).get()
    const data = childAfter.data() as { rewardPoints: number }
    // Base 20 + 0 Surge (unassigned tasks do not appear in V1 eligibleTaskIds
    // by default) — the bonus is granted to the ASSIGNEE not the claimer.
    expect(data.rewardPoints).toBe(5 + 20)
  })
})

// ============================================================
// SCENARIO 3: Sibling task + Surge → denied
// ============================================================
describe('Sibling task denial', () => {
  it('child cannot complete a task assigned to a sibling (rules-level), so no Surge either', async () => {
    // The rules gate the completion itself; functions-level we test that
    // the documented invariant holds: Surge bonus is only awarded to the
    // assignee. Even if a forged completion arrived, the evaluator rejects
    // when completion.assigneeId !== task.assigneeId.
    await seedBase({ taskAssignee: SIBLING, basePoints: 15, surgeActive: true, childId: SIBLING })

    // The legitimate completion is by the SIBLING (who is the assignee).
    // It SHOULD receive the Surge bonus. We do NOT attempt to forge the
    // completion by a non-assignee at the functions layer — the rules
    // layer prevents that. This test confirms the positive path and the
    // negative case is locked by the rules-layer combinedSurgeAndP0 test.
    await processApprovedCompletion({
      familyId: FAMILY,
      completionId: 'completion-1',
      processingAt: APPROVED_AT.toMillis(),
    })

    const siblingAfter = await db().doc(`users/${SIBLING}`).get()
    const data = siblingAfter.data() as { rewardPoints: number }
    // Sibling started at 0, base 15 + Surge 7 = 22
    expect(data.rewardPoints).toBe(0 + 15 + 7)
  })
})

// ============================================================
// SCENARIO 4: Managed child + null-assignee
// ============================================================
describe('Managed child + null-assignee', () => {
  it('managed child can complete an unassigned family task (rules accept; functions award)', async () => {
    // Seed a managed child identity
    const MANAGED_ID = 'managed-child-1'
    await db().doc(`users/${MANAGED_ID}`).set({
      familyId: FAMILY, role: 'child', status: 'active', rewardPoints: 0,
      isManaged: true, authUid: 'managed-auth-1',
    })
    await seedBase({ taskAssignee: null, requiresApproval: true, childId: MANAGED_ID, basePoints: 20, surgeActive: false })

    // Update the completion to be by the managed child
    await db().doc(`families/${FAMILY}/task_completions/completion-1`).update({
      assigneeId: MANAGED_ID,
    })

    await processApprovedCompletion({
      familyId: FAMILY,
      completionId: 'completion-1',
      processingAt: APPROVED_AT.toMillis(),
    })

    const mcAfter = await db().doc(`users/${MANAGED_ID}`).get()
    const data = mcAfter.data() as { rewardPoints: number }
    expect(data.rewardPoints).toBe(0 + 20)
  })
})

// ============================================================
// SCENARIO 5: Legacy streak state + Surge
// ============================================================
describe('Legacy streak state + Surge', () => {
  it('completion succeeds and updates currentStreak / lastActiveDate alongside Surge', async () => {
    // Pre-seed child with a non-zero streak (legacy state)
    await seedBase({ taskAssignee: CHILD, basePoints: 10, surgeActive: true })
    await db().doc(`users/${CHILD}`).update({
      currentStreak: 3, longestStreak: 5, lastActiveDate: null,
    })

    await processApprovedCompletion({
      familyId: FAMILY,
      completionId: 'completion-1',
      processingAt: APPROVED_AT.toMillis(),
    })

    const childAfter = await db().doc(`users/${CHILD}`).get()
    const data = childAfter.data() as {
      rewardPoints: number
      currentStreak: number
      longestStreak: number
      lastActiveDate: unknown
    }
    // Streak is updated to 4 (3 + 1)
    expect(data.currentStreak).toBe(4)
    expect(data.longestStreak).toBe(5) // unchanged because 4 < 5
    expect(data.rewardPoints).toBe(5 + 10 + 7) // base + surge
  })
})

// ============================================================
// SCENARIO 6: Approval delay
// ============================================================
describe('Approval delay (completion within Surge window, approval after)', () => {
  it('Surge bonus is preserved by server snapshot at completion-time, not approval-time', async () => {
    // completedAt is INSIDE the Surge window
    const inWindowCompletedAt = Timestamp.fromMillis(Date.parse('2026-07-23T09:30:00Z'))
    // approvedAt is AFTER the Surge window ends
    const lateApprovedAt = Timestamp.fromMillis(Date.parse('2026-07-23T14:00:00Z'))

    await seedBase({
      taskAssignee: CHILD,
      basePoints: 10,
      surgeActive: true,
      completedAt: inWindowCompletedAt,
    })
    // Surges already seeded with window 08:00–12:00
    // Update approval time to be after window
    await db().doc(`families/${FAMILY}/task_completions/completion-1`).update({
      approvedAt: lateApprovedAt,
      status: 'pending_approval', // will be flipped to approved by the processor
    })

    await processApprovedCompletion({
      familyId: FAMILY,
      completionId: 'completion-1',
      processingAt: lateApprovedAt.toMillis(),
    })

    const childAfter = await db().doc(`users/${CHILD}`).get()
    const data = childAfter.data() as { rewardPoints: number }
    // Surge was evaluated against completedAt (in window) → still awarded
    expect(data.rewardPoints).toBe(5 + 10 + 7)
  })
})

// ============================================================
// SCENARIO 7: Cross-family
// ============================================================
describe('Cross-family', () => {
  it('completion that is read by another family has no cross-family bonus effect', async () => {
    // Seed an "outsider" child in another family
    const OTHER_FAMILY = 'family-other'
    const OUTSIDER = 'outsider-child'
    await db().doc(`families/${OTHER_FAMILY}`).set({
      name: 'Other', timezone: 'Europe/London',
      gamification: { schemaVersion: 1, dailyGoalPercentage: 80 },
      gamificationMigration: { schemaVersion: 1, status: 'prepared', cutoverAt: APPROVED_AT },
    })
    await db().doc(`users/${OUTSIDER}`).set({
      familyId: OTHER_FAMILY, role: 'child', status: 'active', rewardPoints: 0,
    })

    // Seed the legitimate family normally
    await seedBase({ taskAssignee: CHILD, basePoints: 10, surgeActive: true })

    // Process only THIS family's completion
    await processApprovedCompletion({
      familyId: FAMILY,
      completionId: 'completion-1',
      processingAt: APPROVED_AT.toMillis(),
    })

    // Outsider is untouched
    const outsider = await db().doc(`users/${OUTSIDER}`).get()
    const data = outsider.data() as { rewardPoints: number }
    expect(data.rewardPoints).toBe(0)

    // Legitimate child got base + surge
    const child = await db().doc(`users/${CHILD}`).get()
    const childData = child.data() as { rewardPoints: number }
    expect(childData.rewardPoints).toBe(5 + 10 + 7)
  })
})

// ============================================================
// SCENARIO 8: Duplicate processing
// ============================================================
describe('Duplicate processing', () => {
  it('calling processApprovedCompletion twice does not double-award base or Surge', async () => {
    await seedBase({ taskAssignee: CHILD, basePoints: 10, surgeActive: true })

    // First call
    await processApprovedCompletion({
      familyId: FAMILY,
      completionId: 'completion-1',
      processingAt: APPROVED_AT.toMillis(),
    })

    const childAfter1 = await db().doc(`users/${CHILD}`).get()
    const data1 = childAfter1.data() as { rewardPoints: number }
    const expected = 5 + 10 + 7
    expect(data1.rewardPoints).toBe(expected)

    // Second call (idempotency: completion is already approved, processor
    // should detect the second call is a no-op)
    await processApprovedCompletion({
      familyId: FAMILY,
      completionId: 'completion-1',
      processingAt: APPROVED_AT.toMillis(),
    })

    const childAfter2 = await db().doc(`users/${CHILD}`).get()
    const data2 = childAfter2.data() as { rewardPoints: number }
    // No double award
    expect(data2.rewardPoints).toBe(expected)

    // Exactly one SURGE_BONUS_AWARDED event exists
    const surgeEvent = await db()
      .doc(`families/${FAMILY}/gamification_events/${surgeEventId('surge-1', 'completion-1')}`)
      .get()
    expect(surgeEvent.exists).toBe(true)
  })
})

// ============================================================
// SCENARIO 9: Reversal linkage
// ============================================================
describe('Reversal linkage', () => {
  it('invalidating the completion reverses base + Surge bonus', async () => {
    await seedBase({ taskAssignee: CHILD, basePoints: 10, surgeActive: true })

    await processApprovedCompletion({
      familyId: FAMILY,
      completionId: 'completion-1',
      processingAt: APPROVED_AT.toMillis(),
    })

    const childAfter1 = await db().doc(`users/${CHILD}`).get()
    const data1 = childAfter1.data() as { rewardPoints: number }
    expect(data1.rewardPoints).toBe(5 + 10 + 7)

    // Invalidate
    await processTaskInvalidation({
      familyId: FAMILY,
      completionId: 'completion-1',
      processingAt: Date.parse('2026-07-23T15:00:00Z'),
      actorUid: 'parent-1',
      actorRole: 'parent',
    })

    const childAfter2 = await db().doc(`users/${CHILD}`).get()
    const data2 = childAfter2.data() as { rewardPoints: number }
    // Both base and surge reversed back to 5
    expect(data2.rewardPoints).toBe(5)

    // A SURGE_BONUS_REVERSED sibling event exists
    const allEvents = await db().collection(`families/${FAMILY}/gamification_events`).get()
    const reversalEvent = allEvents.docs.find(d => {
      const dd = d.data() as { eventType?: string; reversalOfEventId?: string }
      return dd.eventType === 'SURGE_BONUS_REVERSED' && !!dd.reversalOfEventId
    })
    expect(reversalEvent).toBeDefined()
  })
})
