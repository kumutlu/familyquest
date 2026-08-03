import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AdminGamificationRepository } from '../../functions/src/gamificationRepository'
import { AdminBehaviourRepository } from '../../functions/src/behaviourRepository'
import { processApprovedCompletion } from '../../functions/src/gamificationProcessor'
import { levelProgressForXp } from '../../src/domain/gamification/level'
import { GAMIFICATION_CONFIG_V1 } from '../../src/domain/gamification/config'

/**
 * Permanent end-to-end coverage for the shared-task award rule and the
 * server-authoritative behaviour pipeline, exercised through the real
 * trigger/repository code paths against the Firestore emulator.
 */
const PROJECT_ID = 'familyquest-shared-task-e2e'
const FAMILY = 'family-shared'
const CHILD_A = 'child-a'
const CHILD_B = 'child-b'
const DAY = '2026-07-23'
const COMPLETED_AT = Timestamp.fromMillis(Date.parse('2026-07-23T09:00:00Z'))
const APPROVED_AT = Timestamp.fromMillis(Date.parse('2026-07-23T10:00:00Z'))
const CUTOVER = Timestamp.fromMillis(APPROVED_AT.toMillis() - 1)
const CREATED_YESTERDAY = Timestamp.fromMillis(Date.parse('2026-07-22T09:00:00Z'))

let testEnv: RulesTestEnvironment | undefined

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'

function db() {
  const name = `shared-task-e2e-${PROJECT_ID}`
  const app = getApps().find(candidate => candidate.name === name)
    ?? initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID }, name)
  return getFirestore(app)
}

function repo() { return new AdminGamificationRepository(db()) }
function behaviourRepo() { return new AdminBehaviourRepository(db()) }

async function child(id: string) { return (await db().doc(`users/${id}`).get()).data()! }
async function summary(id: string) {
  return (await db().doc(`families/${FAMILY}/gamification_summaries/${id}`).get()).data()
}
async function events() {
  return (await db().collection(`families/${FAMILY}/gamification_events`).get()).docs.map(document => document.data())
}

async function seed() {
  await Promise.all([
    db().doc(`families/${FAMILY}`).set({
      name: 'Shared Family',
      timezone: 'Europe/London',
      gamification: { schemaVersion: 1, dailyGoalPercentage: 80 },
      gamificationMigration: { schemaVersion: 1, status: 'prepared', cutoverAt: CUTOVER },
    }),
    db().doc(`users/${CHILD_A}`).set({ familyId: FAMILY, role: 'child', status: 'active', rewardPoints: 0, lifetimeXP: 0 }),
    db().doc(`users/${CHILD_B}`).set({ familyId: FAMILY, role: 'child', status: 'active', rewardPoints: 0, lifetimeXP: 0 }),
  ])
}

/** A family-wide task: no `assigneeId`, so any active child may complete it. */
async function seedSharedTask(taskId = 'task-shared', pointsReward = 20) {
  await db().doc(`families/${FAMILY}/tasks/${taskId}`).set({
    title: 'Empty the dishwasher', pointsReward, requiresApproval: true,
    type: 'daily', isActive: true, createdAt: CREATED_YESTERDAY,
  })
}

async function seedAssignedTask(taskId: string, assigneeId: string, pointsReward = 20) {
  await db().doc(`families/${FAMILY}/tasks/${taskId}`).set({
    title: `Assigned ${taskId}`, assigneeId, pointsReward, requiresApproval: true,
    type: 'daily', isActive: true, createdAt: CREATED_YESTERDAY,
  })
}

async function seedCompletion(completionId: string, taskId: string, assigneeId: string) {
  await db().doc(`families/${FAMILY}/task_completions/${completionId}`).set({
    taskId, assigneeId, status: 'approved', periodKey: 'client-period',
    completedAt: COMPLETED_AT, approvedAt: APPROVED_AT, reviewedBy: 'parent-1',
  })
}

/** Mirrors the client contract: only the behaviour event document is written. */
async function createBehaviourEvent(id: string, childId: string, type: 'positive' | 'negative', pointsDelta: number) {
  await db().doc(`families/${FAMILY}/behaviour_events/${id}`).set({
    childId, type, pointsDelta, reason: 'e2e', createdAt: APPROVED_AT, createdBy: 'parent-1',
  })
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})
afterAll(async () => { await testEnv?.cleanup() })
beforeEach(async () => { await testEnv!.clearFirestore(); await seed() })

describe('shared-task awarding (emulator e2e)', () => {
  it('awards an unassigned task to the completing child exactly once and is a no-op on retry', async () => {
    await seedSharedTask()
    await seedCompletion('completion-shared', 'task-shared', CHILD_A)

    const first = await processApprovedCompletion(
      { repository: repo(), now: () => APPROVED_AT.toMillis() + 1 },
      { familyId: FAMILY, completionId: 'completion-shared' },
    )
    const second = await processApprovedCompletion(
      { repository: repo(), now: () => APPROVED_AT.toMillis() + 2 },
      { familyId: FAMILY, completionId: 'completion-shared' },
    )

    expect(first.status).toBe('processed')
    expect(second.status).toBe('duplicate')
    expect((await child(CHILD_A)).rewardPoints).toBe(20)

    // XP is the single task award plus the day bonuses it unlocked; the
    // authoritative projection must equal the immutable ledger exactly.
    const projection = (await summary(CHILD_A))!
    const ledger = await events()
    const ledgerXp = ledger.reduce((total, event) => total + (event.xpDelta ?? 0), 0)
    expect(projection.xpTotal).toBe(ledgerXp)
    expect(levelProgressForXp(projection.xpTotal, GAMIFICATION_CONFIG_V1.xpPerLevel))
      .toMatchObject({ level: projection.level })

    const taskXp = ledger.filter(event => event.eventType === 'xp_awarded')
    expect(taskXp).toHaveLength(1)
    expect(taskXp[0].xpDelta).toBe(20)
    expect((await db().collection(`families/${FAMILY}/task_occurrences`).get()).size).toBe(1)
    expect((await db().doc(`families/${FAMILY}/task_completions/completion-shared`).get()).data())
      .toMatchObject({ awardedPoints: 20, gamificationDayKey: DAY })

    // The non-completing sibling is untouched.
    expect((await child(CHILD_B)).rewardPoints).toBe(0)
    expect(await summary(CHILD_B)).toBeUndefined()
  })

  it('awards an explicitly assigned task to its assignee and dead-letters a mismatched child', async () => {
    await seedAssignedTask('task-a', CHILD_A)
    await seedCompletion('completion-a', 'task-a', CHILD_A)
    await seedCompletion('completion-wrong', 'task-a', CHILD_B)

    const matching = await processApprovedCompletion(
      { repository: repo(), now: () => APPROVED_AT.toMillis() + 1 },
      { familyId: FAMILY, completionId: 'completion-a' },
    )
    expect(matching.status).toBe('processed')
    expect((await child(CHILD_A)).rewardPoints).toBe(20)

    const rejected = await processApprovedCompletion(
      { repository: repo(), now: () => APPROVED_AT.toMillis() + 2 },
      { familyId: FAMILY, completionId: 'completion-wrong' },
    )
    expect(rejected).toMatchObject({ status: 'failed', reason: 'task_assigned_to_another_child' })
    expect((await child(CHILD_B)).rewardPoints).toBe(0)

    const failure = (await db()
      .doc(`families/${FAMILY}/gamification_processor_failures/completion-wrong`).get()).data()!
    expect(failure).toMatchObject({
      familyId: FAMILY, completionId: 'completion-wrong', childId: CHILD_B,
      taskId: 'task-a', reason: 'task_assigned_to_another_child',
    })
    expect(typeof failure.processorVersion).toBe('string')
  })

  it('includes shared tasks and excludes another child\'s assigned task in daily eligibility', async () => {
    await seedSharedTask('task-shared', 20)
    await seedAssignedTask('task-mine', CHILD_A, 10)
    await seedAssignedTask('task-theirs', CHILD_B, 50)
    await seedCompletion('completion-shared', 'task-shared', CHILD_A)

    await processApprovedCompletion(
      { repository: repo(), now: () => APPROVED_AT.toMillis() + 1 },
      { familyId: FAMILY, completionId: 'completion-shared' },
    )

    const eligibility = (await db().doc(`families/${FAMILY}/daily_eligibility/${CHILD_A}:${DAY}`).get()).data()!
    expect(eligibility.taskWeights).toEqual({ 'task-shared': 20, 'task-mine': 10 })
    expect(eligibility.eligiblePoints).toBe(30)
  })
})

describe('server-authoritative behaviour pipeline (emulator e2e)', () => {
  it('awards a positive behaviour once, mirroring lifetimeXP, with no client balance writes', async () => {
    await createBehaviourEvent('behaviour-1', CHILD_A, 'positive', 20)

    // The client wrote nothing but the event document.
    expect((await child(CHILD_A)).rewardPoints).toBe(0)

    const first = await behaviourRepo().processBehaviourEvent({
      familyId: FAMILY, behaviourEventId: 'behaviour-1', processingAt: APPROVED_AT.toMillis() + 1,
    })
    const second = await behaviourRepo().processBehaviourEvent({
      familyId: FAMILY, behaviourEventId: 'behaviour-1', processingAt: APPROVED_AT.toMillis() + 2,
    })

    expect(first.status).toBe('processed')
    expect(second.status).toBe('duplicate')

    const member = await child(CHILD_A)
    expect(member.rewardPoints).toBe(20)
    expect(member.lifetimeXP).toBe(20)
    expect((await summary(CHILD_A))!.xpTotal).toBe(20)

    const behaviourEvents = (await events()).filter(event => event.eventType === 'behaviour_positive')
    expect(behaviourEvents).toHaveLength(1)
    expect(behaviourEvents[0]).toMatchObject({ rewardPointsDelta: 20, xpDelta: 20, sourceBehaviourEventId: 'behaviour-1' })
  })

  it('applies the spendable-points rule for a negative behaviour without reducing any XP', async () => {
    await createBehaviourEvent('behaviour-pos', CHILD_A, 'positive', 20)
    await behaviourRepo().processBehaviourEvent({
      familyId: FAMILY, behaviourEventId: 'behaviour-pos', processingAt: APPROVED_AT.toMillis() + 1,
    })

    await createBehaviourEvent('behaviour-neg', CHILD_A, 'negative', -5)
    const result = await behaviourRepo().processBehaviourEvent({
      familyId: FAMILY, behaviourEventId: 'behaviour-neg', processingAt: APPROVED_AT.toMillis() + 2,
    })
    expect(result.status).toBe('processed')

    const member = await child(CHILD_A)
    expect(member.rewardPoints).toBe(15)
    expect(member.lifetimeXP).toBe(20)
    expect((await summary(CHILD_A))!.xpTotal).toBe(20)

    // Spendable points clamp at zero and XP still never decreases.
    await createBehaviourEvent('behaviour-neg-2', CHILD_A, 'negative', -100)
    await behaviourRepo().processBehaviourEvent({
      familyId: FAMILY, behaviourEventId: 'behaviour-neg-2', processingAt: APPROVED_AT.toMillis() + 3,
    })
    const after = await child(CHILD_A)
    expect(after.rewardPoints).toBe(0)
    expect(after.lifetimeXP).toBe(20)
    expect((await summary(CHILD_A))!.xpTotal).toBe(20)
    expect((await events()).filter(event => event.eventType === 'behaviour_negative')
      .every(event => event.xpDelta === 0)).toBe(true)
  })
})
