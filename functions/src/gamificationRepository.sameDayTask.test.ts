/**
 * P0 regression — freshly-created tasks (created the same day they are completed
 * and approved) must award points exactly like legacy tasks.
 *
 * Root-cause guard under test: `isTaskEligibleForDay` in
 * `dailyEligibilityAdapter.ts` excluded any task whose `createdAt` falls on or
 * after the completion day (`familyDayKey(task.createdAt) >= dayKey`). A task
 * created and completed on the same day was therefore omitted from the frozen
 * daily eligibility snapshot, so `processApprovedCompletion` computed
 * `frozenWeight === undefined` and threw a plain `Error` ("Approved completion
 * is not eligible in the immutable daily snapshot"). The client-side approval
 * notification reads `pointsReward` directly, so it still reported "+N points"
 * even though the authoritative award never committed.
 *
 * These tests assert the CORRECT (post-fix) behaviour and therefore FAIL on the
 * current code, proving the bug.
 */
import { describe, expect, it } from 'vitest'
import { AdminGamificationRepository } from './gamificationRepository'

// ---------------------------------------------------------------------------
// Minimal fake Firestore (copied from acceptance.test.ts harness)
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
    return { exists, id: path.split('/').at(-1)!, data: () => store[path] as Record<string, unknown> }
  }
  const queryResult = (basePath: string) => {
    const prefix = `${basePath}/`
    const docs = Object.keys(store)
      .filter(k => k.startsWith(prefix) && k.split('/').length === basePath.split('/').length + 1)
      .map(k => ({ id: k.split('/').at(-1)!, data: () => store[k] as Record<string, unknown> }))
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
  constructor(private store: Store, private created: string[]) {}
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
        docs: childDocs.map(k => ({ id: k.split('/').at(-1)!, data: () => this.store[k] as Record<string, unknown> })),
        size: childDocs.length,
        empty: childDocs.length === 0,
      }
    }
    return { exists: false, id: path.split('/').at(-1)!, data: () => ({}) as Record<string, unknown> }
  }
  set = (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }): void => {
    this.writes.push({ path: ref.path, data, kind: 'set' })
    if (options?.merge) this.store[ref.path] = { ...(this.store[ref.path] || {}), ...data }
    else this.store[ref.path] = data
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
// Fixtures
// ---------------------------------------------------------------------------
const FAMILY_ID = 'sameday-family'
const CHILD_ID = 'sameday-child'
const TASK_ID = 'sameday-task'
// For a `daily` task, authoritativePeriodKey returns the bare dayKey (no prefix).
const PERIOD_KEY = '2026-08-04'
const COMPLETION_ID = `${CHILD_ID}__${TASK_ID}__${PERIOD_KEY}`
const FAMILY_PATH = `families/${FAMILY_ID}`
const PROCESSING_AT = Date.parse('2026-08-04T12:00:00.000Z')
const DAY_KEY = '2026-08-04'
const LOGICAL_KEY = `task_v1|${CHILD_ID}|${TASK_ID}|${PERIOD_KEY}`
// A second, high-value task keeps the single 10-point task below the daily-goal
// threshold so no daily-goal/perfect-day bonus events fire (mirrors the
// acceptance-test pattern). It is always created on a PRIOR day so it never
// trips the same-day eligibility guard under test.
const OTHER_TASK_ID = 'sameday-other'

interface BuildOpts {
  /** createdAt offset from PROCESSING_AT. 0 = same day (the bug). */
  readonly taskCreatedAtOffsetMs?: number
  /** Points value for the task. */
  readonly points?: number
}

function buildStore(opts: BuildOpts = {}): Store {
  const points = opts.points ?? 10
  const createdAt = new Date(PROCESSING_AT + (opts.taskCreatedAtOffsetMs ?? 0))
  const store: Store = {
    [FAMILY_PATH]: {
      name: 'Same-day Task Family',
      timezone: 'Europe/London',
      gamificationMigration: { schemaVersion: 1, status: 'active', cutoverAt: new Date(PROCESSING_AT - 86400000) },
    },
    [`users/${CHILD_ID}`]: {
      familyId: FAMILY_ID,
      role: 'child',
      rewardPoints: 100,
      lifetimeXP: 200,
      currentStreak: 0,
      longestStreak: 0,
    },
    [`${FAMILY_PATH}/tasks/${TASK_ID}`]: {
      title: 'Fresh task',
      pointsReward: points,
      requiresApproval: true,
      isActive: true,
      type: 'daily',
      createdAt,
    },
    // High-value prior-day task: keeps the 10-point task below the daily goal.
    [`${FAMILY_PATH}/tasks/${OTHER_TASK_ID}`]: {
      title: 'Other task',
      pointsReward: 1000,
      requiresApproval: true,
      isActive: true,
      type: 'daily',
      createdAt: new Date(PROCESSING_AT - 86400000),
    },
    [`${FAMILY_PATH}/task_completions/${COMPLETION_ID}`]: {
      taskId: TASK_ID,
      assigneeId: CHILD_ID,
      status: 'approved',
      periodKey: PERIOD_KEY,
      completedAt: new Date(PROCESSING_AT - 3600000),
      approvedAt: new Date(PROCESSING_AT),
      reviewedBy: 'parent-1',
      reviewedByName: 'Parent',
    },
    [`${FAMILY_PATH}/gamification_summaries/${CHILD_ID}`]: {
      schemaVersion: 1,
      familyId: FAMILY_ID,
      childId: CHILD_ID,
      xpTotal: 200,
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
  return store
}

function childPath(): string { return `users/${CHILD_ID}` }
function summaryPath(): string { return `${FAMILY_PATH}/gamification_summaries/${CHILD_ID}` }
function occurrencePath(): string { return `${FAMILY_PATH}/task_occurrences/${LOGICAL_KEY}` }
function notificationPath(): string { return `${FAMILY_PATH}/notifications/gamification_task_approved:${encodeURIComponent(LOGICAL_KEY)}` }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('P0 — freshly-created (same-day) task approval awards points', () => {
  it('awards +10 rewardPoints and +10 xpTotal for a task created the same day', async () => {
    const db = fakeDb(buildStore({ taskCreatedAtOffsetMs: 0 }))
    const repository = new AdminGamificationRepository(db as never)
    const result = await repository.processApprovedCompletion({
      familyId: FAMILY_ID,
      completionId: COMPLETION_ID,
      processingAt: PROCESSING_AT,
    })

    expect(result.status).toBe('processed')
    expect(result.logicalCompletionKey).toBe(LOGICAL_KEY)

    // Authoritative spendable points increased by exactly the task value.
    expect(db.store[childPath()]).toMatchObject({ rewardPoints: 110 })
    // XP increased by exactly the task value.
    expect(db.store[summaryPath()]).toMatchObject({ xpTotal: 210 })
    // Idempotency / award ledger record created.
    expect(Object.hasOwn(db.store, occurrencePath())).toBe(true)
    // Notification created with the correct amount.
    expect(db.store[notificationPath()]).toMatchObject({
      type: 'task_approved',
      body: 'Fresh task was approved. +10 points',
    })
  })

  it('awards +30 rewardPoints and +30 xpTotal for a 30-point task created the same day', async () => {
    const db = fakeDb(buildStore({ taskCreatedAtOffsetMs: 0, points: 30 }))
    const repository = new AdminGamificationRepository(db as never)
    const result = await repository.processApprovedCompletion({
      familyId: FAMILY_ID,
      completionId: COMPLETION_ID,
      processingAt: PROCESSING_AT,
    })

    expect(result.status).toBe('processed')
    // Authoritative spendable points increased by exactly the task value.
    expect(db.store[childPath()]).toMatchObject({ rewardPoints: 130 })
    // XP increased by exactly the task value.
    expect(db.store[summaryPath()]).toMatchObject({ xpTotal: 230 })
    // Notification amount equals the actual awarded points.
    expect(db.store[notificationPath()]).toMatchObject({
      type: 'task_approved',
      body: 'Fresh task was approved. +30 points',
    })
  })

  it('CONTROL — a legacy task created on a prior day still awards correctly', async () => {
    const db = fakeDb(buildStore({ taskCreatedAtOffsetMs: -86400000 }))
    const repository = new AdminGamificationRepository(db as never)
    const result = await repository.processApprovedCompletion({
      familyId: FAMILY_ID,
      completionId: COMPLETION_ID,
      processingAt: PROCESSING_AT,
    })

    expect(result.status).toBe('processed')
    expect(db.store[childPath()]).toMatchObject({ rewardPoints: 110 })
    expect(db.store[summaryPath()]).toMatchObject({ xpTotal: 210 })
  })

  it('idempotency — re-approving the same completion awards no additional points', async () => {
    const db = fakeDb(buildStore({ taskCreatedAtOffsetMs: 0 }))
    const repository = new AdminGamificationRepository(db as never)
    const first = await repository.processApprovedCompletion({
      familyId: FAMILY_ID, completionId: COMPLETION_ID, processingAt: PROCESSING_AT,
    })
    expect(first.status).toBe('processed')
    expect(db.store[childPath()]).toMatchObject({ rewardPoints: 110 })

    const second = await repository.processApprovedCompletion({
      familyId: FAMILY_ID, completionId: COMPLETION_ID, processingAt: PROCESSING_AT + 1000,
    })
    expect(second.status).toBe('duplicate')
    // No additional points.
    expect(db.store[childPath()]).toMatchObject({ rewardPoints: 110 })
    expect(db.store[summaryPath()]).toMatchObject({ xpTotal: 210 })
  })
})
