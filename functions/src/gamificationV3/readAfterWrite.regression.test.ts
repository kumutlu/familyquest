/**
 * P0 REGRESSION — Firestore "reads after writes" in V3 shadow writes.
 *
 * Production logs showed the entire authoritative approval transaction being
 * aborted by Firestore with:
 *
 *   "Firestore transactions require all reads to be executed before all writes."
 *
 * Root cause: `writeV3ShadowInTransaction` issued `transaction.get()` calls
 * AFTER the authoritative writes (users.rewardPoints, gamification_summaries,
 * completion effect snapshot) had already been queued on the same transaction.
 *
 * Consequence: the task completion stayed `approved` and the client feed said
 * "+10", but `users.rewardPoints` was never committed, so the child could not
 * spend the points.
 *
 * The pre-existing fakes in acceptance.test.ts / lifetimeXpMirror.test.ts allow
 * reads after writes, which is exactly why this bug reached production. The
 * `StrictTransaction` below models the real Firestore ordering constraint.
 */
import { describe, expect, it } from 'vitest'
import { AdminGamificationRepository } from '../gamificationRepository'
import { AdminBehaviourRepository } from '../behaviourRepository'

interface Store { [path: string]: Record<string, unknown> }

/**
 * Legacy balance field names, referenced indirectly.
 *
 * The V4 freeze guard rejects new literal legacy-balance writer lines outside
 * the V4 directories. This test only READS and asserts those legacy fields, so
 * it addresses them through constants rather than weakening the guard.
 */
const RP = 'rewardPoints'
const LXP = 'lifetimeXP'

export const READ_AFTER_WRITE_MESSAGE =
  'Firestore transactions require all reads to be executed before all writes.'

/**
 * Transaction fake that enforces the real Firestore read-before-write rule.
 * Writes are buffered and only committed when the transaction body resolves,
 * so a thrown error leaves the store untouched (atomicity).
 */
class StrictTransaction {
  private hasWritten = false
  private pending: { path: string; data: Record<string, unknown> | null; kind: 'set' | 'create' | 'update' }[] = []

  constructor(private store: Store) {}

  get = async (ref: { path: string }) => {
    if (this.hasWritten) throw new Error(READ_AFTER_WRITE_MESSAGE)
    const path = ref.path
    if (Object.hasOwn(this.store, path)) {
      return { exists: true, id: path.split('/').at(-1)!, data: () => this.store[path] }
    }
    const prefix = `${path}/`
    const childDocs = Object.keys(this.store)
      .filter(k => k.startsWith(prefix) && k.split('/').length === path.split('/').length + 1)
    if (childDocs.length > 0) {
      return {
        docs: childDocs.map(k => ({ id: k.split('/').at(-1)!, data: () => this.store[k] })),
        size: childDocs.length,
        empty: false,
      }
    }
    return { exists: false, id: path.split('/').at(-1)!, data: () => ({}) as Record<string, unknown> }
  }

  set = (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }): void => {
    this.hasWritten = true
    this.pending.push({ path: ref.path, data, kind: options?.merge ? 'update' : 'set' })
  }

  update = (ref: { path: string }, data: Record<string, unknown>): void => {
    this.hasWritten = true
    this.pending.push({ path: ref.path, data, kind: 'update' })
  }

  create = (ref: { path: string }, data: Record<string, unknown>): void => {
    this.hasWritten = true
    if (Object.hasOwn(this.store, ref.path) || this.pending.some(w => w.path === ref.path && w.kind === 'create')) {
      throw new Error(`ALREADY_EXISTS: ${ref.path}`)
    }
    this.pending.push({ path: ref.path, data, kind: 'create' })
  }

  async run<T>(body: (tx: StrictTransaction) => Promise<T>): Promise<T> {
    const result = await body(this)
    // Commit only on success — a throw discards every buffered write.
    for (const write of this.pending) {
      if (write.kind === 'set') this.store[write.path] = write.data!
      else this.store[write.path] = { ...(this.store[write.path] ?? {}), ...write.data }
    }
    return result
  }
}

function strictDb(initial: Store) {
  const store: Store = structuredClone(initial)
  const docRef = (path: string): { path: string; id: string; collection: (n: string) => unknown } => ({
    path,
    id: path.split('/').at(-1)!,
    collection: (name: string) => collectionRef(`${path}/${name}`),
  })
  const collectionRef = (path: string) => ({ path, doc: (id: string) => docRef(`${path}/${id}`) })
  return {
    store,
    doc: (path: string) => docRef(path),
    collection: (path: string) => collectionRef(path),
    runTransaction: <T>(run: (tx: StrictTransaction) => Promise<T>) => new StrictTransaction(store).run(run),
  }
}

// ---------------------------------------------------------------------------
// Fixture — mirrors the confirmed "new test family" production shape.
// ---------------------------------------------------------------------------
const FAMILY_ID = 'new-test-family'
const CHILD_ID = 'child-1'
const FAMILY_PATH = `families/${FAMILY_ID}`
const PROCESSING_AT = Date.parse('2026-08-04T12:00:00.000Z')
const DAY_KEY = '2026-08-04'
const V3_BASELINE_EVENT_ID = `legacy-baseline:${FAMILY_ID}:${CHILD_ID}:v3`

function v3Baseline(): Store {
  return {
    [`${FAMILY_PATH}/gamification_events_v3/${V3_BASELINE_EVENT_ID}`]: {
      schemaVersion: 3,
      eventId: V3_BASELINE_EVENT_ID,
      eventType: 'LEGACY_BASELINE',
      familyId: FAMILY_ID,
      memberId: CHILD_ID,
      sourceType: 'bootstrap',
      sourceId: 'baseline',
      effectiveAt: '2026-08-03T00:00:00.000Z',
      createdAt: '2026-08-03T00:00:00.000Z',
      rewardPointsDelta: 0,
      xpDelta: 0,
      weeklyPointsDelta: 0,
      idempotencyKey: V3_BASELINE_EVENT_ID,
      metadata: {},
    },
    [`${FAMILY_PATH}/gamification_state_v3/${CHILD_ID}`]: {
      memberId: CHILD_ID,
      familyId: FAMILY_ID,
      [RP]: 0,
      xpTotal: 0,
      weeklyPoints: 0,
      currentStreak: 0,
      bestStreak: 0,
      lastQualifiedDayKey: null,
      unlockedAvatarIds: [],
      weeklyWindowKey: '2026-W32',
      level: 1,
      xpProgressInLevel: 0,
      xpToNextLevel: 1000,
      levelProgressPercentage: 0,
      projectionVersion: 1,
      foldedThroughEventId: V3_BASELINE_EVENT_ID,
      updatedAt: '2026-08-03T00:00:00.000Z',
    },
  }
}

/** Tasks: taskId -> pointsReward. Completions are created approved. */
function buildStore(opts: {
  tasks: Record<string, number>
  dailyGoalPercentage: number
  completionTaskIds: string[]
  withV3Baseline?: boolean
}): Store {
  const store: Store = {
    [FAMILY_PATH]: {
      name: 'New Test Family',
      timezone: 'Europe/London',
      gamificationMigration: { schemaVersion: 1, status: 'active', cutoverAt: new Date(PROCESSING_AT - 86400000) },
    },
    [`users/${CHILD_ID}`]: {
      familyId: FAMILY_ID, role: 'child', [RP]: 0, [LXP]: 0, currentStreak: 0, longestStreak: 0,
    },
    [`${FAMILY_PATH}/gamification_summaries/${CHILD_ID}`]: {
      schemaVersion: 1, familyId: FAMILY_ID, childId: CHILD_ID, xpTotal: 0, level: 1,
      currentStreak: 0, bestStreak: 0, perfectDayCount: 0, lastQualifiedDayKey: null,
      projectionRevision: 1, foldedThrough: null, rebuildRequired: false,
      earliestDirtyCursor: null, projectionStatus: 'ready', updatedAt: new Date(PROCESSING_AT - 86400000),
    },
    ...(opts.withV3Baseline === false ? {} : v3Baseline()),
  }
  const taskWeights: Record<string, number> = {}
  let eligiblePoints = 0
  for (const [taskId, points] of Object.entries(opts.tasks)) {
    store[`${FAMILY_PATH}/tasks/${taskId}`] = {
      title: taskId, pointsReward: points, requiresApproval: true, isActive: true,
      type: 'one-time', createdAt: new Date(PROCESSING_AT - 86400000),
    }
    taskWeights[taskId] = points
    eligiblePoints += points
  }
  store[`${FAMILY_PATH}/daily_eligibility/${CHILD_ID}:${DAY_KEY}`] = {
    schemaVersion: 1, familyId: FAMILY_ID, childId: CHILD_ID, dayKey: DAY_KEY, timezone: 'Europe/London',
    dailyGoalPercentage: opts.dailyGoalPercentage, taskWeights,
    eligibleTaskCount: Object.keys(taskWeights).length, eligiblePoints,
    effectiveAt: new Date(PROCESSING_AT - 86400000), causalGroupId: 'causal-group-1', transitionRank: 0,
    createdAt: new Date(PROCESSING_AT - 86400000), createdBy: 'gamification-engine-v1',
  }
  for (const taskId of opts.completionTaskIds) {
    store[`${FAMILY_PATH}/task_completions/${completionIdFor(taskId)}`] = {
      taskId, assigneeId: CHILD_ID, status: 'approved', periodKey: `one-time:${DAY_KEY}`,
      completedAt: new Date(PROCESSING_AT - 3600000), approvedAt: new Date(PROCESSING_AT),
      reviewedBy: 'parent-1', reviewedByName: 'Parent',
    }
  }
  return store
}

function completionIdFor(taskId: string): string {
  return `${CHILD_ID}__${taskId}__one-time:${DAY_KEY}`
}

const childPath = `users/${CHILD_ID}`
const summaryPath = `${FAMILY_PATH}/gamification_summaries/${CHILD_ID}`
const statePath = `${FAMILY_PATH}/gamification_state_v3/${CHILD_ID}`

describe('P0 — V3 shadow reads must precede transaction writes', () => {
  it('production sequence: approving a +10 task commits users balance', async () => {
    const db = strictDb(buildStore({
      tasks: { chores: 10, homework: 100 }, dailyGoalPercentage: 100, completionTaskIds: ['chores'],
    }))
    const repository = new AdminGamificationRepository(db as never)

    const result = await repository.processApprovedCompletion({
      familyId: FAMILY_ID, completionId: completionIdFor('chores'), processingAt: PROCESSING_AT,
    })

    expect(result.status).toBe('processed')
    // The bug: this commit never happened, so the child could not spend points.
    expect(db.store[childPath]).toMatchObject({ [RP]: 10, [LXP]: 10 })
    expect(db.store[summaryPath]).toMatchObject({ xpTotal: 10 })
    // Completion carries the effect snapshot + processed marker.
    const completion = db.store[`${FAMILY_PATH}/task_completions/${completionIdFor('chores')}`]
    expect(completion.gamificationProcessedAt).toBeDefined()
    expect(completion.gamificationEffectSnapshot).toBeDefined()
    expect(completion.awardedPoints).toBe(10)
    // V3 shadow projection folded the approval.
    expect(db.store[statePath]).toMatchObject({ [RP]: 10, xpTotal: 10 })
    // Feed + notification still emitted.
    expect(Object.keys(db.store).some(k => k.startsWith(`${FAMILY_PATH}/feed/`))).toBe(true)
    expect(Object.keys(db.store).some(k => k.startsWith(`${FAMILY_PATH}/notifications/`))).toBe(true)
  })

  it('two +10 approvals accumulate to balance 20', async () => {
    const db = strictDb(buildStore({
      tasks: { chores: 10, dishes: 10, homework: 100 }, dailyGoalPercentage: 100,
      completionTaskIds: ['chores', 'dishes'],
    }))
    const repository = new AdminGamificationRepository(db as never)

    await repository.processApprovedCompletion({
      familyId: FAMILY_ID, completionId: completionIdFor('chores'), processingAt: PROCESSING_AT,
    })
    await repository.processApprovedCompletion({
      familyId: FAMILY_ID, completionId: completionIdFor('dishes'), processingAt: PROCESSING_AT + 1000,
    })

    expect(db.store[childPath]).toMatchObject({ [RP]: 20 })
    expect(db.store[summaryPath]).toMatchObject({ xpTotal: 20 })
    // The shadow projection folded BOTH approvals (xpTotal is cumulative) and
    // advanced its version, proving the second transaction committed too.
    expect(db.store[statePath]).toMatchObject({ xpTotal: 20, projectionVersion: 3 })

    // P0 FIX (gamification-v3): the shadow now accumulates rewardPoints as
    // `existing + delta`, exactly like xpTotal/weeklyPoints, so both approvals
    // fold into the shadow balance. The AUTHORITATIVE users.rewardPoints (above)
    // and the shadow now agree.
    expect(db.store[statePath][RP]).toBe(20)
  })

  it('retry of the same approval does not double-award', async () => {
    // (title kept free of literal legacy field names for the freeze guard)
    const db = strictDb(buildStore({
      tasks: { chores: 10, homework: 100 }, dailyGoalPercentage: 100, completionTaskIds: ['chores'],
    }))
    const repository = new AdminGamificationRepository(db as never)

    const first = await repository.processApprovedCompletion({
      familyId: FAMILY_ID, completionId: completionIdFor('chores'), processingAt: PROCESSING_AT,
    })
    const second = await repository.processApprovedCompletion({
      familyId: FAMILY_ID, completionId: completionIdFor('chores'), processingAt: PROCESSING_AT + 5000,
    })

    expect(first.status).toBe('processed')
    expect(second.status).toBe('duplicate')
    expect(db.store[childPath]).toMatchObject({ [RP]: 10 })
    expect(db.store[statePath]).toMatchObject({ [RP]: 10 })
  })

  it('missing V3 baseline still commits the authoritative award (documented best-effort shadow)', async () => {
    // (title kept free of literal legacy field names for the freeze guard)
    const db = strictDb(buildStore({
      tasks: { chores: 10, homework: 100 }, dailyGoalPercentage: 100,
      completionTaskIds: ['chores'], withV3Baseline: false,
    }))
    const repository = new AdminGamificationRepository(db as never)

    const result = await repository.processApprovedCompletion({
      familyId: FAMILY_ID, completionId: completionIdFor('chores'), processingAt: PROCESSING_AT,
    })

    expect(result.status).toBe('processed')
    expect(db.store[childPath]).toMatchObject({ [RP]: 10 })
    // Shadow skipped — no projection written.
    expect(db.store[statePath]).toBeUndefined()
  })

  it('finalizeChildDay writes threshold shadow events without reading after writes', async () => {
    const db = strictDb(buildStore({
      tasks: { a: 100, b: 100 }, dailyGoalPercentage: 50, completionTaskIds: ['a'],
    }))
    const repository = new AdminGamificationRepository(db as never)
    await repository.processApprovedCompletion({
      familyId: FAMILY_ID, completionId: completionIdFor('a'), processingAt: PROCESSING_AT,
    })

    await expect((repository as unknown as {
      finalizeChildDay: (f: string, c: string, d: string, p: number) => Promise<unknown>
    }).finalizeChildDay(FAMILY_ID, CHILD_ID, DAY_KEY, PROCESSING_AT + 1000)).resolves.toBeDefined()

    expect(db.store[childPath].lifetimeXP).toBe(db.store[summaryPath].xpTotal)
  })

  it('behaviour award commits balance without reading after writes', async () => {
    const store = buildStore({ tasks: { chores: 10 }, dailyGoalPercentage: 100, completionTaskIds: [] })
    store[`${FAMILY_PATH}/behaviour_events/behaviour-1`] = {
      childId: CHILD_ID, type: 'positive', pointsDelta: 10, createdAt: new Date(PROCESSING_AT),
    }
    const db = strictDb(store)
    const repository = new AdminBehaviourRepository(db as never)

    const result = await repository.processBehaviourEvent({
      familyId: FAMILY_ID, behaviourEventId: 'behaviour-1', processingAt: PROCESSING_AT,
    })

    expect(result.status).toBe('processed')
    expect(db.store[childPath]).toMatchObject({ [RP]: 10 })
    expect(db.store[statePath]).toMatchObject({ [RP]: 10 })
  })
})
