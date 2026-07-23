import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AdminGamificationRepository } from '../../functions/src/gamificationRepository'
import { processApprovedCompletion, processTaskInvalidation } from '../../functions/src/gamificationProcessor'
import { repairGamificationPage, repairPostCutoverPage } from '../../functions/src/gamificationRepair'

const PROJECT_ID = 'familyquest-functions-gamification-test'
const FAMILY = 'family-1'
const CHILD = 'child-1'
const DAY = '2026-07-23'
const COMPLETED_AT = Timestamp.fromMillis(Date.parse('2026-07-23T09:00:00Z'))
const APPROVED_AT = Timestamp.fromMillis(Date.parse('2026-07-23T10:00:00Z'))
const CUTOVER = Timestamp.fromMillis(APPROVED_AT.toMillis() - 1)
let testEnv: RulesTestEnvironment | undefined

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'

function db() {
  const name = `functions-gamification-${PROJECT_ID}`
  const app = getApps().find(candidate => candidate.name === name)
    ?? initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID }, name)
  return getFirestore(app)
}

function repo() { return new AdminGamificationRepository(db()) }

async function seed(overrides: Record<string, unknown> = {}) {
  await Promise.all([
    db().doc(`families/${FAMILY}`).set({
      name: 'Family', timezone: 'Europe/London', gamification: { schemaVersion: 1, dailyGoalPercentage: 80 },
      gamificationMigration: { schemaVersion: 1, status: 'prepared', cutoverAt: CUTOVER },
    }),
    db().doc(`users/${CHILD}`).set({ familyId: FAMILY, role: 'child', status: 'active', rewardPoints: 5 }),
    db().doc(`families/${FAMILY}/tasks/task-1`).set({
      title: 'Tidy room', assigneeId: CHILD, pointsReward: 20, requiresApproval: true,
      type: 'daily', isActive: true, createdAt: Timestamp.fromMillis(Date.parse('2026-07-22T09:00:00Z')),
    }),
    db().doc(`families/${FAMILY}/task_completions/completion-1`).set({
      taskId: 'task-1', assigneeId: CHILD, status: 'approved', periodKey: 'forged-client-period',
      completedAt: COMPLETED_AT, approvedAt: APPROVED_AT, reviewedBy: 'parent-1', ...overrides,
    }),
  ])
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})
afterAll(async () => { await testEnv?.cleanup() })
beforeEach(async () => { await testEnv!.clearFirestore(); await seed() })

describe('trusted gamification orchestration (emulator)', () => {
  it('atomically credits spendable points, reservation, immutable effect/events, progress, summary and deterministic success records exactly once', async () => {
    const first = await processApprovedCompletion({ repository: repo(), now: () => APPROVED_AT.toMillis() + 10 }, { familyId: FAMILY, completionId: 'completion-1' })
    const second = await processApprovedCompletion({ repository: repo(), now: () => APPROVED_AT.toMillis() + 20 }, { familyId: FAMILY, completionId: 'completion-1' })
    expect(first.status).toBe('processed')
    expect(second.status).toBe('duplicate')
    expect((await db().doc(`users/${CHILD}`).get()).data()!.rewardPoints).toBe(25)
    const completion = (await db().doc(`families/${FAMILY}/task_completions/completion-1`).get()).data()!
    expect(completion).toMatchObject({ awardedPoints: 20, gamificationDayKey: DAY })
    expect(completion.gamificationEffectSnapshot).toMatchObject({ periodKey: DAY, rewardPointsAward: 20, dailyWeight: 20 })
    expect((await db().collection(`families/${FAMILY}/task_occurrences`).get()).size).toBe(1)
    expect((await db().collection(`families/${FAMILY}/gamification_events`).get()).docs.map(d => d.data().eventType).sort()).toEqual([
      'daily_goal_awarded', 'daily_goal_qualification_changed', 'perfect_day_awarded', 'perfect_day_qualification_changed', 'xp_awarded',
    ].sort())
    expect((await db().collection(`families/${FAMILY}/feed`).get()).size).toBe(1)
    expect((await db().collection(`families/${FAMILY}/notifications`).get()).size).toBe(1)
    expect((await db().doc(`families/${FAMILY}/daily_progress/${CHILD}:${DAY}`).get()).data()).toMatchObject({ approvedPoints: 20, dailyGoalReached: true, perfectDayReached: true })
  })

  it('normalizes two arbitrary IDs and two valid-looking client period keys to one authoritative occurrence', async () => {
    await db().doc(`families/${FAMILY}/task_completions/other-id`).set({
      taskId: 'task-1', assigneeId: CHILD, status: 'approved', periodKey: '2026-07-24',
      completedAt: COMPLETED_AT, approvedAt: APPROVED_AT, reviewedBy: 'parent-1',
    })
    await processApprovedCompletion({ repository: repo(), now: () => APPROVED_AT.toMillis() + 1 }, { familyId: FAMILY, completionId: 'completion-1' })
    await processApprovedCompletion({ repository: repo(), now: () => APPROVED_AT.toMillis() + 2 }, { familyId: FAMILY, completionId: 'other-id' })
    expect((await db().doc(`users/${CHILD}`).get()).data()!.rewardPoints).toBe(25)
    expect((await db().collection(`families/${FAMILY}/task_occurrences`).get()).size).toBe(1)
    expect((await db().collection(`families/${FAMILY}/gamification_events`).get()).size).toBe(5)
    expect((await db().collection(`families/${FAMILY}/feed`).get()).size).toBe(1)
    expect((await db().collection(`families/${FAMILY}/notifications`).get()).size).toBe(1)
  })

  it('uses identical frozen effects for manual and auto approval modes', async () => {
    await processApprovedCompletion({ repository: repo(), now: () => APPROVED_AT.toMillis() + 1 }, { familyId: FAMILY, completionId: 'completion-1' })
    const manual = (await db().doc(`families/${FAMILY}/task_completions/completion-1`).get()).data()!.gamificationEffectSnapshot
    await testEnv!.clearFirestore()
    await seed({ reviewedBy: null })
    await db().doc(`families/${FAMILY}/tasks/task-1`).update({ requiresApproval: false })
    await processApprovedCompletion({ repository: repo(), now: () => APPROVED_AT.toMillis() + 1 }, { familyId: FAMILY, completionId: 'completion-1' })
    const auto = (await db().doc(`families/${FAMILY}/task_completions/completion-1`).get()).data()!.gamificationEffectSnapshot
    expect({ ...auto, requiresApproval: true }).toEqual(manual)
  })

  it.each([
    ['invalid reward', { pointsReward: Number.NaN }, 'prepared', APPROVED_AT],
    ['pre-cutover', { pointsReward: 20 }, 'prepared', Timestamp.fromMillis(CUTOVER.toMillis() - 1)],
    ['inactive barrier', { pointsReward: 20 }, 'inactive', APPROVED_AT],
  ])('%s produces no trusted writes', async (_label, taskPatch, status, approvedAt) => {
    await db().doc(`families/${FAMILY}/tasks/task-1`).update(taskPatch)
    await db().doc(`families/${FAMILY}`).update({ 'gamificationMigration.status': status })
    await db().doc(`families/${FAMILY}/task_completions/completion-1`).update({ approvedAt })
    const beforePoints = (await db().doc(`users/${CHILD}`).get()).data()!.rewardPoints
    if (_label === 'invalid reward') {
      await expect(processApprovedCompletion({ repository: repo(), now: () => APPROVED_AT.toMillis() }, { familyId: FAMILY, completionId: 'completion-1' })).rejects.toThrow(/reward/i)
    } else {
      await processApprovedCompletion({ repository: repo(), now: () => APPROVED_AT.toMillis() }, { familyId: FAMILY, completionId: 'completion-1' })
    }
    expect((await db().doc(`users/${CHILD}`).get()).data()!.rewardPoints).toBe(beforePoints)
    expect((await db().collection(`families/${FAMILY}/task_occurrences`).get()).empty).toBe(true)
    expect((await db().collection(`families/${FAMILY}/gamification_events`).get()).empty).toBe(true)
  })

  it('reversal before or after delivery converges to one net-zero award/revoke ledger', async () => {
    const reversalId = 'task_completion__completion-1'
    await db().doc(`families/${FAMILY}/reversals/${reversalId}`).set({ sourceKind: 'task_completion', sourceId: 'completion-1', completedAt: APPROVED_AT })
    await processTaskInvalidation({ repository: repo(), now: () => APPROVED_AT.toMillis() + 5 }, { familyId: FAMILY, completionId: 'completion-1', immutableReversalId: reversalId })
    await processApprovedCompletion({ repository: repo(), now: () => APPROVED_AT.toMillis() + 6 }, { familyId: FAMILY, completionId: 'completion-1' })
    const events = (await db().collection(`families/${FAMILY}/gamification_events`).get()).docs.map(d => d.data())
    expect(events.filter(e => ['xp_awarded', 'xp_revoked'].includes(e.eventType)).reduce((sum, e) => sum + e.xpDelta, 0)).toBe(0)
    expect((await db().doc(`families/${FAMILY}/gamification_summaries/${CHILD}`).get()).data()).toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 0, perfectDayCount: 0 })
  })

  it('a later reversal removes spendable points once, unqualifies the day, and preserves a legitimate best', async () => {
    await processApprovedCompletion({ repository: repo(), now: () => APPROVED_AT.toMillis() + 1 }, { familyId: FAMILY, completionId: 'completion-1' })
    const reversalId = 'task_completion__completion-1'
    await db().doc(`families/${FAMILY}/reversals/${reversalId}`).set({ sourceKind: 'task_completion', sourceId: 'completion-1', completedAt: Timestamp.fromMillis(APPROVED_AT.toMillis() + 2) })
    await processTaskInvalidation({ repository: repo(), now: () => APPROVED_AT.toMillis() + 2 }, { familyId: FAMILY, completionId: 'completion-1', immutableReversalId: reversalId })
    await processTaskInvalidation({ repository: repo(), now: () => APPROVED_AT.toMillis() + 3 }, { familyId: FAMILY, completionId: 'completion-1', immutableReversalId: reversalId })
    expect((await db().doc(`users/${CHILD}`).get()).data()!.rewardPoints).toBe(5)
    const summary = (await db().doc(`families/${FAMILY}/gamification_summaries/${CHILD}`).get()).data()!
    expect(summary).toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 1, perfectDayCount: 0 })
    expect((await db().collection(`families/${FAMILY}/gamification_events`).get()).docs.filter(d => d.data().eventType === 'xp_revoked')).toHaveLength(1)
  })

  it('records a valid zero reward as a neutral audit event outside the denominator', async () => {
    await db().doc(`families/${FAMILY}/tasks/task-1`).update({ pointsReward: 0 })
    await processApprovedCompletion({ repository: repo(), now: () => APPROVED_AT.toMillis() + 1 }, { familyId: FAMILY, completionId: 'completion-1' })
    expect((await db().doc(`users/${CHILD}`).get()).data()!.rewardPoints).toBe(5)
    expect((await db().doc(`families/${FAMILY}/daily_eligibility/${CHILD}:${DAY}`).get()).data()).toMatchObject({ eligiblePoints: 0, taskWeights: {} })
    const events = (await db().collection(`families/${FAMILY}/gamification_events`).get()).docs.map(document => document.data())
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ eventType: 'xp_awarded', xpDelta: 0 })
  })

  it('finalizes an eligible miss, emits no unfinalized or zero-denominator inference, and permits late approval recovery', async () => {
    const repository = repo()
    const finalized = await repository.finalizeFamilyDay({ familyId: FAMILY, dayKey: DAY, processingAt: APPROVED_AT.toMillis() + 1 })
    expect(finalized.daysFinalized).toBe(1)
    let transitions = (await db().collection(`families/${FAMILY}/gamification_events`).get()).docs.map(document => document.data())
    expect(transitions.filter(event => event.eventType.endsWith('_qualification_changed')).map(event => event.qualificationState)).toEqual(['unqualified', 'unqualified'])
    await processApprovedCompletion({ repository, now: () => APPROVED_AT.toMillis() + 2 }, { familyId: FAMILY, completionId: 'completion-1' })
    transitions = (await db().collection(`families/${FAMILY}/gamification_events`).get()).docs.map(document => document.data())
    expect(transitions.filter(event => event.eventType.endsWith('_qualification_changed')).map(event => event.qualificationState).sort()).toEqual([
      'qualified', 'qualified', 'unqualified', 'unqualified',
    ].sort())

    await testEnv!.clearFirestore()
    await seed()
    await db().doc(`families/${FAMILY}/tasks/task-1`).update({ pointsReward: 0 })
    await repository.finalizeFamilyDay({ familyId: FAMILY, dayKey: DAY, processingAt: APPROVED_AT.toMillis() + 3 })
    expect((await db().collection(`families/${FAMILY}/gamification_events`).get()).empty).toBe(true)
  })

  it('marks a historical authority cursor and any running generation dirty in the same award transaction', async () => {
    const future = Timestamp.fromMillis(APPROVED_AT.toMillis() + 10_000)
    await db().doc(`families/${FAMILY}/gamification_summaries/${CHILD}`).set({
      schemaVersion: 1, familyId: FAMILY, childId: CHILD, xpTotal: 0, level: 1, currentStreak: 0, bestStreak: 0,
      perfectDayCount: 0, lastQualifiedDayKey: null, projectionRevision: 1,
      foldedThrough: { effectiveAt: future, causalGroupId: 'future', transitionRank: 0, documentId: 'future' },
      rebuildRequired: false, earliestDirtyCursor: null, projectionStatus: 'ready', updatedAt: future,
    })
    await db().doc(`families/${FAMILY}/gamification_checkpoints/${CHILD}`).set({
      schemaVersion: 1, familyId: FAMILY, childId: CHILD, generationId: 'running', watermarkAt: future,
      dirty: false, eligibilityCursor: null, eventCursor: null, pendingRecords: [], accumulatedEligibility: [], accumulatedEvents: [],
    })
    await processApprovedCompletion({ repository: repo(), now: () => APPROVED_AT.toMillis() + 1 }, { familyId: FAMILY, completionId: 'completion-1' })
    expect((await db().doc(`families/${FAMILY}/gamification_summaries/${CHILD}`).get()).data()).toMatchObject({ rebuildRequired: true, projectionStatus: 'rebuilding' })
    expect((await db().doc(`families/${FAMILY}/gamification_checkpoints/${CHILD}`).get()).data()!.dirty).toBe(true)
  })

  it('records same-day goal loss, recovery, and second loss while awarding and revoking the bonus only once', async () => {
    await db().doc(`families/${FAMILY}/tasks/task-1`).update({ pointsReward: 10 })
    for (let index = 2; index <= 5; index += 1) {
      await db().doc(`families/${FAMILY}/tasks/task-${index}`).set({
        title: `Task ${index}`, assigneeId: CHILD, pointsReward: 10, requiresApproval: true,
        type: 'daily', isActive: true, createdAt: Timestamp.fromMillis(Date.parse('2026-07-22T09:00:00Z')),
      })
      await db().doc(`families/${FAMILY}/task_completions/completion-${index}`).set({
        taskId: `task-${index}`, assigneeId: CHILD, status: 'approved', periodKey: `client-${index}`,
        completedAt: COMPLETED_AT, approvedAt: Timestamp.fromMillis(APPROVED_AT.toMillis() + index), reviewedBy: 'parent-1',
      })
    }
    const repository = repo()
    for (let index = 1; index <= 4; index += 1) {
      await processApprovedCompletion({ repository, now: () => APPROVED_AT.toMillis() + 10 + index }, { familyId: FAMILY, completionId: `completion-${index}` })
    }
    for (const index of [4, 5]) {
      if (index === 5) {
        await db().doc(`families/${FAMILY}/task_completions/completion-5`).update({ approvedAt: Timestamp.fromMillis(APPROVED_AT.toMillis() + 50) })
        await processApprovedCompletion({ repository, now: () => APPROVED_AT.toMillis() + 50 }, { familyId: FAMILY, completionId: 'completion-5' })
      }
      const reversalId = `task_completion__completion-${index}`
      const reversedAt = APPROVED_AT.toMillis() + (index === 4 ? 44 : 60)
      await db().doc(`families/${FAMILY}/reversals/${reversalId}`).set({ sourceKind: 'task_completion', sourceId: `completion-${index}`, completedAt: Timestamp.fromMillis(reversedAt) })
      await processTaskInvalidation({ repository, now: () => reversedAt }, { familyId: FAMILY, completionId: `completion-${index}`, immutableReversalId: reversalId })
    }
    const events = (await db().collection(`families/${FAMILY}/gamification_events`).get()).docs.map(document => document.data())
    expect(events.filter(event => event.eventType === 'daily_goal_awarded')).toHaveLength(1)
    expect(events.filter(event => event.eventType === 'daily_goal_revoked')).toHaveLength(1)
    expect(events.filter(event => event.eventType === 'daily_goal_qualification_changed')
      .sort((left, right) => left.effectiveAt.toMillis() - right.effectiveAt.toMillis())
      .map(event => event.qualificationState)).toEqual([
      'qualified', 'unqualified', 'qualified', 'unqualified',
    ])
    expect((await db().doc(`users/${CHILD}`).get()).data()!.rewardPoints).toBe(35)
  })

  it('creates and verifies immutable eligibility content, excluding a task created today and zero rewards', async () => {
    await db().doc(`families/${FAMILY}/tasks/zero`).set({ assigneeId: CHILD, pointsReward: 0, requiresApproval: true, type: 'daily', isActive: true, createdAt: CUTOVER })
    await db().doc(`families/${FAMILY}/tasks/today`).set({ assigneeId: CHILD, pointsReward: 99, requiresApproval: true, type: 'daily', isActive: true, createdAt: COMPLETED_AT })
    await processApprovedCompletion({ repository: repo(), now: () => APPROVED_AT.toMillis() + 1 }, { familyId: FAMILY, completionId: 'completion-1' })
    const ref = db().doc(`families/${FAMILY}/daily_eligibility/${CHILD}:${DAY}`)
    const original = (await ref.get()).data()!
    expect(original.taskWeights).toEqual({ 'task-1': 20 })
    await db().doc(`families/${FAMILY}/tasks/task-1`).update({ pointsReward: 999 })
    await expect(processApprovedCompletion({ repository: repo(), now: () => APPROVED_AT.toMillis() + 2 }, { familyId: FAMILY, completionId: 'completion-1' })).resolves.toMatchObject({ status: 'duplicate' })
    expect((await ref.get()).data()).toEqual(original)
  })

  it('rebuilds in bounded pages, resumes checkpoints, and restarts a dirty generation', async () => {
    await processApprovedCompletion({ repository: repo(), now: () => APPROVED_AT.toMillis() + 1 }, { familyId: FAMILY, completionId: 'completion-1' })
    const repository = repo()
    const first = await repairGamificationPage({ repository, now: () => APPROVED_AT.toMillis() + 100 }, { familyId: FAMILY, childId: CHILD })
    expect(first.recordsRead).toBeLessThanOrEqual(250)
    let result = first
    for (let i = 0; i < 10 && result.status !== 'published'; i += 1) {
      result = await repairGamificationPage({ repository, now: () => APPROVED_AT.toMillis() + 101 + i }, { familyId: FAMILY, childId: CHILD })
    }
    expect(result.status).toBe('published')

    await db().doc(`families/${FAMILY}/gamification_checkpoints/${CHILD}`).set({
      schemaVersion: 1, familyId: FAMILY, childId: CHILD, generationId: 'dirty-generation', watermarkAt: APPROVED_AT,
      dirty: true, eligibilityCursor: null, eventCursor: null, pendingRecords: [], accumulatedEligibility: [], accumulatedEvents: [],
    })
    const restarted = await repairGamificationPage({ repository, now: () => APPROVED_AT.toMillis() + 200 }, { familyId: FAMILY, childId: CHILD })
    expect(restarted.generationId).not.toBe('dirty-generation')
  })

  it('repairs missed post-cutover approvals and activates only from baseline_complete after draining the boundary', async () => {
    await db().doc(`families/${FAMILY}`).update({ 'gamificationMigration.status': 'baseline_complete' })
    let result = await repairPostCutoverPage({ repository: repo(), now: () => APPROVED_AT.toMillis() + 300 }, { familyId: FAMILY })
    for (let i = 0; i < 5 && result.status !== 'active'; i += 1) {
      result = await repairPostCutoverPage({ repository: repo(), now: () => APPROVED_AT.toMillis() + 301 + i }, { familyId: FAMILY })
    }
    expect(result.status).toBe('active')
    expect((await db().doc(`families/${FAMILY}`).get()).data()!.gamificationMigration.status).toBe('active')
    expect((await db().doc(`users/${CHILD}`).get()).data()!.rewardPoints).toBe(25)
  })
})
