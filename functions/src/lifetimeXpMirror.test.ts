/**
 * Regression tests for BUG 2 — lifetimeXP mirror drift.
 *
 * The authoritative gamification XP lives in `gamification_summaries.xpTotal`.
 * `users.lifetimeXP` is a legacy compatibility mirror that MUST be updated in the
 * SAME transaction whenever `xpTotal` changes, in the two server authoritative
 * writers:
 *   1. processApprovedCompletion (task approval + threshold bonuses)
 *   2. finalizeChildDay          (idempotent threshold finalization)
 *
 * These tests prove the mirror can never drift: after each writer runs,
 * `users.lifetimeXP === gamification_summaries.xpTotal`.
 *
 * Note: the gamification engine awards daily-goal (+25) and perfect-day (+50)
 * threshold bonuses inside `planApprovedTask`, so `processApprovedCompletion`
 * is where those XP deltas are first applied; `finalizeChildDay` re-applies them
 * idempotently. Both writers must mirror `lifetimeXP`.
 */
import { describe, expect, it } from 'vitest'
import { AdminGamificationRepository } from './gamificationRepository'

// ---------------------------------------------------------------------------
// Minimal fake Firestore (mirrors acceptance.test.ts) — covers the Admin API
// surface used by the processors and the V3 shadow writer.
// ---------------------------------------------------------------------------

interface Store { [path: string]: Record<string, unknown> }

function fakeDb(initial: Store) {
  const store: Store = { ...initial }
  const created: string[] = []

  const docRef = (path: string) => {
    const col = (name: string) => collectionRef(`${path}/${name}`)
    return { path, id: path.split('/').at(-1)!, collection: col }
  }

  const collectionRef = (path: string) => {
    const doc = (id: string) => docRef(`${path}/${id}`)
    return { path, doc }
  }

  const snapshot = (path: string) => {
    const exists = Object.hasOwn(store, path)
    return {
      exists,
      id: path.split('/').at(-1)!,
      data: () => store[path] as Record<string, unknown>,
    }
  }

  const queryResult = (basePath: string) => {
    const prefix = `${basePath}/`
    const docs = Object.keys(store)
      .filter(k => k.startsWith(prefix) && k.split('/').length === basePath.split('/').length + 1)
      .map(k => ({
        id: k.split('/').at(-1)!,
        data: () => store[k] as Record<string, unknown>,
      }))
    return { docs, size: docs.length, empty: docs.length === 0 }
  }

  const db = {
    store,
    created,
    doc: (path: string) => docRef(path),
    collection: (path: string) => collectionRef(path),
    runTransaction: <T>(run: (tx: Transaction) => Promise<T>) => {
      const tx = new Transaction(store, created)
      return tx.run(run)
    },
  }

  return db
}

class Transaction {
  private reads: { path: string; kind: 'doc' | 'collection' }[] = []
  private writes: { path: string; data: Record<string, unknown>; kind: 'set' | 'create' | 'update' }[] = []

  constructor(
    private store: Store,
    private created: string[],
  ) {}

  get = async (ref: { path: string }): Promise<ReturnType<typeof snapshot> | ReturnType<typeof queryResult>> => {
    const path = ref.path
    this.reads.push({ path, kind: 'doc' })
    const exists = Object.hasOwn(this.store, path)
    if (exists) {
      return { exists: true, id: path.split('/').at(-1)!, data: () => this.store[path] as Record<string, unknown> }
    }
    const prefix = `${path}/`
    const childDocs = Object.keys(this.store).filter(k => k.startsWith(prefix) && k.split('/').length === path.split('/').length + 1)
    if (childDocs.length > 0) {
      return {
        docs: childDocs.map(k => ({
          id: k.split('/').at(-1)!,
          data: () => this.store[k] as Record<string, unknown>,
        })),
        size: childDocs.length,
        empty: childDocs.length === 0,
      }
    }
    return { exists: false, id: path.split('/').at(-1)!, data: () => ({}) as Record<string, unknown> }
  }

  set = (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }): void => {
    this.writes.push({ path: ref.path, data, kind: 'set' })
    if (options?.merge) {
      this.store[ref.path] = { ...(this.store[ref.path] || {}), ...data }
    } else {
      this.store[ref.path] = data
    }
  }

  update = (ref: { path: string }, data: Record<string, unknown>): void => {
    this.writes.push({ path: ref.path, data, kind: 'update' })
    this.store[ref.path] = { ...(this.store[ref.path] || {}), ...data }
  }

  create = (ref: { path: string }, data: Record<string, unknown>): void => {
    if (Object.hasOwn(this.store, ref.path)) throw new Error(`ALREADY_EXISTS: ${ref.path}`)
    this.writes.push({ path: ref.path, data, kind: 'create' })
    this.created.push(ref.path)
    this.store[ref.path] = data
  }

  async run<T>(run: (tx: Transaction) => Promise<T>): Promise<T> {
    return run(this)
  }
}

// ---------------------------------------------------------------------------
// Shared constants + V3 baseline (required by writeV3ShadowInTransaction)
// ---------------------------------------------------------------------------
const FAMILY_ID = 'mirror-family'
const CHILD_ID = 'mirror-child'
const FAMILY_PATH = `families/${FAMILY_ID}`
const PROCESSING_AT = Date.parse('2026-08-04T12:00:00.000Z')
const DAY_KEY = '2026-08-04'
const AUTH_PERIOD_KEY = 'one-time:2026-08-04'
const V3_BASELINE_EVENT_ID = `legacy-baseline:${FAMILY_ID}:${CHILD_ID}:v3`

function v3BaselineStore(): Store {
  const baseline = {
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
  }
  const state = {
    memberId: CHILD_ID,
    familyId: FAMILY_ID,
    rewardPoints: 0,
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
  }
  return {
    [`${FAMILY_PATH}/gamification_events_v3/${V3_BASELINE_EVENT_ID}`]: baseline,
    [`${FAMILY_PATH}/gamification_state_v3/${CHILD_ID}`]: state,
  }
}

function commonStore(): Store {
  return {
    [FAMILY_PATH]: {
      name: 'Mirror Test Family',
      timezone: 'Europe/London',
      gamificationMigration: { schemaVersion: 1, status: 'active', cutoverAt: new Date(PROCESSING_AT - 86400000) },
    },
    [`users/${CHILD_ID}`]: {
      familyId: FAMILY_ID,
      role: 'child',
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
    },
    [`${FAMILY_PATH}/gamification_summaries/${CHILD_ID}`]: {
      schemaVersion: 1,
      familyId: FAMILY_ID,
      childId: CHILD_ID,
      xpTotal: 0,
      level: 1,
      currentStreak: 0,
      bestStreak: 0,
      perfectDayCount: 0,
      lastQualifiedDayKey: null,
      projectionRevision: 1,
      foldedThrough: null,
      rebuildRequired: false,
      earliestDirtyCursor: null,
      projectionStatus: 'ready',
      updatedAt: new Date(PROCESSING_AT - 86400000),
    },
  }
}

interface StoreOptions {
  tasks: Record<string, number> // taskId -> pointsReward
  dailyGoalPercentage: number
  completionTaskId?: string
}

function buildStore(opts: StoreOptions): Store {
  const store: Store = {
    ...commonStore(),
    ...v3BaselineStore(),
  }
  const taskWeights: Record<string, number> = {}
  let eligiblePoints = 0
  for (const [taskId, points] of Object.entries(opts.tasks)) {
    store[`${FAMILY_PATH}/tasks/${taskId}`] = {
      title: taskId,
      pointsReward: points,
      requiresApproval: true,
      isActive: true,
      type: 'one-time',
      createdAt: new Date(PROCESSING_AT - 86400000),
    }
    taskWeights[taskId] = points
    eligiblePoints += points
  }
  store[`${FAMILY_PATH}/daily_eligibility/${CHILD_ID}:${DAY_KEY}`] = {
    schemaVersion: 1,
    familyId: FAMILY_ID,
    childId: CHILD_ID,
    dayKey: DAY_KEY,
    timezone: 'Europe/London',
    dailyGoalPercentage: opts.dailyGoalPercentage,
    taskWeights,
    eligibleTaskCount: Object.keys(taskWeights).length,
    eligiblePoints,
    effectiveAt: new Date(PROCESSING_AT - 86400000),
    causalGroupId: 'causal-group-1',
    transitionRank: 0,
    createdAt: new Date(PROCESSING_AT - 86400000),
    createdBy: 'gamification-engine-v1',
  }
  if (opts.completionTaskId) {
    const completionId = `${CHILD_ID}__${opts.completionTaskId}__one-time:${DAY_KEY}`
    store[`${FAMILY_PATH}/task_completions/${completionId}`] = {
      taskId: opts.completionTaskId,
      assigneeId: CHILD_ID,
      status: 'approved',
      periodKey: AUTH_PERIOD_KEY,
      completedAt: new Date(PROCESSING_AT - 3600000),
      approvedAt: new Date(PROCESSING_AT),
      reviewedBy: 'parent-1',
      reviewedByName: 'Parent',
    }
  }
  return store
}

function completionIdFor(taskId: string): string {
  return `${CHILD_ID}__${taskId}__one-time:${DAY_KEY}`
}

function childPath(): string {
  return `users/${CHILD_ID}`
}

function summaryPath(): string {
  return `${FAMILY_PATH}/gamification_summaries/${CHILD_ID}`
}

function finalize(repository: AdminGamificationRepository): Promise<unknown> {
  return (repository as unknown as {
    finalizeChildDay: (f: string, c: string, d: string, p: number) => Promise<unknown>
  }).finalizeChildDay(FAMILY_ID, CHILD_ID, DAY_KEY, PROCESSING_AT)
}

describe('BUG 2 — lifetimeXP mirror', () => {
  it('finalizes a legacy summary with missing streak fields without serializing undefined', async () => {
    const db = fakeDb(buildStore({ tasks: { a: 100, b: 100 }, dailyGoalPercentage: 100, completionTaskId: 'a' }))
    const legacySummary = { ...db.store[summaryPath()] }
    delete legacySummary.currentStreak
    delete legacySummary.bestStreak
    db.store[summaryPath()] = legacySummary

    await finalize(new AdminGamificationRepository(db as never))

    expect(db.store[summaryPath()].currentStreak).toBe(0)
    expect(db.store[summaryPath()].bestStreak).toBe(0)
    expect(Object.values(db.store[summaryPath()])).not.toContain(undefined)
  })

  it('task approval: rewardPoints +10, xpTotal +10, lifetimeXP +10 (same transaction)', async () => {
    // A 10-point task plus an unapproved 100-point task keeps the daily goal
    // (100% of 110 eligible points) unreachable, so only the +10 task XP lands.
    const db = fakeDb(buildStore({ tasks: { small: 10, big: 100 }, dailyGoalPercentage: 100, completionTaskId: 'small' }))
    const repository = new AdminGamificationRepository(db as never)

    const result = await repository.processApprovedCompletion({
      familyId: FAMILY_ID,
      completionId: completionIdFor('small'),
      processingAt: PROCESSING_AT,
    })

    expect(result.status).toBe('processed')
    expect(db.store[summaryPath()]).toMatchObject({ xpTotal: 10 })
    expect(db.store[childPath()]).toMatchObject({ rewardPoints: 10, lifetimeXP: 10 })
    // Mirror invariant: lifetimeXP === xpTotal.
    expect(db.store[childPath()].lifetimeXP).toBe(db.store[summaryPath()].xpTotal)
  })

  it('daily goal: xpTotal +25, lifetimeXP +25 (mirrored by processApprovedCompletion and finalizeChildDay)', async () => {
    // Approving the first 100-point task (of two) reaches the 50% daily goal.
    const db = fakeDb(buildStore({ tasks: { a: 100, b: 100 }, dailyGoalPercentage: 50, completionTaskId: 'a' }))
    const repository = new AdminGamificationRepository(db as never)

    const approval = await repository.processApprovedCompletion({
      familyId: FAMILY_ID,
      completionId: completionIdFor('a'),
      processingAt: PROCESSING_AT,
    })
    expect(approval.status).toBe('processed')

    // Task XP (100) + daily-goal bonus (25) = 125, mirrored into lifetimeXP.
    expect(db.store[summaryPath()]).toMatchObject({ xpTotal: 125 })
    expect(db.store[childPath()]).toMatchObject({ lifetimeXP: 125 })
    const dailyGoalEvent = Object.entries(db.store).find(([, doc]) =>
      (doc as Record<string, unknown>)?.eventType === 'daily_goal_awarded')
    expect(dailyGoalEvent).toBeDefined()
    expect((dailyGoalEvent![1] as Record<string, unknown>).xpDelta).toBe(25)

    // finalizeChildDay must keep the mirror consistent (no drift).
    await finalize(repository)
    expect(db.store[childPath()].lifetimeXP).toBe(db.store[summaryPath()].xpTotal)
  })

  it('perfect day: xpTotal +50 (perfect-day bonus), lifetimeXP mirrored (same transaction)', async () => {
    // A single 100-point task at 50% daily goal reaches both the daily goal
    // and the perfect day on approval.
    const db = fakeDb(buildStore({ tasks: { t: 100 }, dailyGoalPercentage: 50, completionTaskId: 't' }))
    const repository = new AdminGamificationRepository(db as never)

    const approval = await repository.processApprovedCompletion({
      familyId: FAMILY_ID,
      completionId: completionIdFor('t'),
      processingAt: PROCESSING_AT,
    })
    expect(approval.status).toBe('processed')

    // Task XP (100) + daily-goal bonus (25) + perfect-day bonus (50) = 175.
    expect(db.store[summaryPath()]).toMatchObject({ xpTotal: 175 })
    expect(db.store[childPath()]).toMatchObject({ lifetimeXP: 175 })
    const perfectDayEvent = Object.entries(db.store).find(([, doc]) =>
      (doc as Record<string, unknown>)?.eventType === 'perfect_day_awarded')
    expect(perfectDayEvent).toBeDefined()
    expect((perfectDayEvent![1] as Record<string, unknown>).xpDelta).toBe(50)

    // finalizeChildDay must keep the mirror consistent (no drift).
    await finalize(repository)
    expect(db.store[childPath()].lifetimeXP).toBe(db.store[summaryPath()].xpTotal)
  })

  it('already-drifted user: new task +10 makes lifetimeXP = new xpTotal (430), not an increment from old lifetimeXP', async () => {
    // An extra large unapproved eligible task keeps the daily goal (100%) forever
    // out of reach, so no threshold bonuses interfere and the projection XP is
    // exactly the sum of approved task XP (420 + 10 = 430).
    const db = fakeDb(buildStore({ tasks: { base: 420, small: 10, extra: 1000 }, dailyGoalPercentage: 100, completionTaskId: 'base' }))
    const repository = new AdminGamificationRepository(db as never)

    // Approve the 420-XP base task -> projection xpTotal 420, mirror 420.
    const base = await repository.processApprovedCompletion({
      familyId: FAMILY_ID,
      completionId: completionIdFor('base'),
      processingAt: PROCESSING_AT,
    })
    expect(base.status).toBe('processed')
    expect(db.store[summaryPath()]).toMatchObject({ xpTotal: 420 })
    expect(db.store[childPath()]).toMatchObject({ lifetimeXP: 420 })

    // Simulate drift: the legacy mirror lags the projection (400 vs 420).
    db.store[childPath()] = { ...db.store[childPath()], lifetimeXP: 400 }

    // Add the not-yet-approved +10 task completion, then approve it.
    db.store[`${FAMILY_PATH}/task_completions/${completionIdFor('small')}`] = {
      taskId: 'small',
      assigneeId: CHILD_ID,
      status: 'approved',
      periodKey: AUTH_PERIOD_KEY,
      completedAt: new Date(PROCESSING_AT - 3600000),
      approvedAt: new Date(PROCESSING_AT),
      reviewedBy: 'parent-1',
      reviewedByName: 'Parent',
    }
    const small = await repository.processApprovedCompletion({
      familyId: FAMILY_ID,
      completionId: completionIdFor('small'),
      processingAt: PROCESSING_AT,
    })
    expect(small.status).toBe('processed')

    // New task +10 -> projection xpTotal 430.
    expect(db.store[summaryPath()]).toMatchObject({ xpTotal: 430 })
    // Mirror is ASSIGNED from the new summary total (430), NOT 400 + 10 = 410.
    expect(db.store[childPath()].lifetimeXP).toBe(430)
    expect(db.store[childPath()].lifetimeXP).not.toBe(410)
  })
})
