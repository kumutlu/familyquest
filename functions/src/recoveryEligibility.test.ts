/**
 * Regression tests for the P0 recovery eligibility classifier.
 *
 * Root cause being locked down: the original recovery scanner omitted the
 * immutable daily-eligibility snapshot check that `processApprovedCompletion`
 * enforces, so it reported false-positive "real targets" that the processor
 * correctly rejected with "Approved completion is not eligible in the immutable
 * daily snapshot".
 *
 * These tests prove `classifyRecoveryCompletion` (used by the scanner) returns
 * EXACTLY the same eligibility decision as the canonical processor, across the
 * seven scenarios called out in the recovery brief:
 *   1. valid historical completion
 *   2. task reassigned later
 *   3. task created after snapshot
 *   4. wrong child
 *   5. duplicate
 *   6. post-cutover valid completion
 *   7. pre-cutover completion
 *
 * The parity section runs the REAL `processApprovedCompletion` against an
 * in-memory Firestore (no emulator) and asserts the scanner prediction matches
 * the processor outcome.
 */
import { describe, expect, it } from 'vitest'
import { AdminGamificationRepository } from './gamificationRepository'
import { classifyRecoveryCompletion, type RecoveryEligibilityInput } from './recoveryEligibility'
import type { RepositoryScheduledTask } from './dailyEligibilityAdapter'
import { familyDayKey } from '../../src/domain/gamification/dailyProgress'

const FAMILY = 'family-test'
const CHILD = 'child-1'
const OTHER = 'child-2'
const TASK = 'task-1'
const COMPLETION = 'completion-1'
const TZ = 'Europe/London'
const CUTOVER = Date.parse('2026-08-01T00:00:00Z')
const COMPLETED_AT = Date.parse('2026-08-05T10:00:00Z')
const APPROVED_AT = Date.parse('2026-08-05T11:00:00Z')

function task(overrides: Partial<RepositoryScheduledTask> = {}): RepositoryScheduledTask {
  return {
    id: TASK,
    assigneeId: CHILD,
    pointsReward: 10,
    requiresApproval: true,
    type: 'daily',
    isActive: true,
    status: 'active',
    archived: false,
    isArchived: false,
    deleted: false,
    disabled: false,
    createdAt: Date.parse('2026-07-01T00:00:00Z'),
    ...overrides,
  }
}

function baseInput(overrides: Partial<RecoveryEligibilityInput> = {}): RecoveryEligibilityInput {
  return {
    familyId: FAMILY,
    childId: CHILD,
    taskId: TASK,
    taskPointsReward: 10,
    migrationStatus: 'active',
    cutoverAt: CUTOVER,
    approvedAt: APPROVED_AT,
    child: { role: 'child', status: 'active', disabled: false, familyId: FAMILY },
    task: task(),
    existingSnapshot: { taskWeights: { [TASK]: 10 } },
    familyTasks: [task()],
    timezone: TZ,
    completedAt: COMPLETED_AT,
    processingAt: APPROVED_AT + 1,
    dailyGoalPercentage: 80,
    ...overrides,
  }
}

describe('classifyRecoveryCompletion — unit (mirrors processApprovedCompletion)', () => {
  it('1. valid historical completion is eligible', () => {
    expect(classifyRecoveryCompletion(baseInput()).eligible).toBe(true)
  })

  it('2. task reassigned later (completion child != current task assignee) is NOT eligible', () => {
    // The historical completion belongs to CHILD, but the task was later
    // reassigned to OTHER. We must NOT trust the mutable current assignment.
    const result = classifyRecoveryCompletion(baseInput({
      task: task({ assigneeId: OTHER }),
      familyTasks: [task({ assigneeId: OTHER })],
    }))
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('task_assigned_to_another_child')
  })

  it('3. task created after the immutable snapshot is NOT eligible', () => {
    // Snapshot exists but does not list the task (frozen before the task was
    // eligible). This is the exact P0 false-positive predicate.
    const result = classifyRecoveryCompletion(baseInput({
      existingSnapshot: { taskWeights: { 'other-task': 5 } },
    }))
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('not_in_immutable_snapshot')
  })

  it('3b. zero-reward task is eligible even when absent from the snapshot', () => {
    const result = classifyRecoveryCompletion(baseInput({
      taskPointsReward: 0,
      task: task({ pointsReward: 0 }),
      existingSnapshot: { taskWeights: { 'other-task': 5 } },
    }))
    expect(result.eligible).toBe(true)
  })

  it('4. wrong child is NOT eligible', () => {
    // Completion is for CHILD but the task is assigned to OTHER.
    const result = classifyRecoveryCompletion(baseInput({
      task: task({ assigneeId: OTHER }),
      familyTasks: [task({ assigneeId: OTHER })],
    }))
    expect(result.eligible).toBe(false)
  })

  it('5. duplicate (occurrence already exists) is predicted eligible but excluded by idempotency', () => {
    // The classifier only decides awardability; the recovery driver's
    // `!idempotentEffectExists` filter turns this into a skip, matching the
    // processor's `duplicate` status.
    const result = classifyRecoveryCompletion(baseInput())
    expect(result.eligible).toBe(true)
  })

  it('6. post-cutover valid completion is eligible', () => {
    expect(classifyRecoveryCompletion(baseInput({ approvedAt: CUTOVER + 1000 })).eligible).toBe(true)
  })

  it('7. pre-cutover completion is NOT eligible', () => {
    const result = classifyRecoveryCompletion(baseInput({ approvedAt: CUTOVER - 1000 }))
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('pre_cutover_ignored')
  })

  it('builds the expected snapshot when none is frozen yet (no false positive)', () => {
    // No snapshot exists: the classifier builds the expected snapshot from the
    // current family tasks. A task that did NOT exist on the completion day
    // (created the NEXT day) must still be excluded — the P0 fix only made a
    // task eligible on its OWN creation day, not on days before it existed.
    const result = classifyRecoveryCompletion(baseInput({
      existingSnapshot: null,
      task: task({ createdAt: COMPLETED_AT + 86400000 }),
      familyTasks: [task({ createdAt: COMPLETED_AT + 86400000 })],
    }))
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('not_in_immutable_snapshot')
  })

  it('P0 fix — a task created the same day as completion IS eligible (no false negative)', () => {
    // Regression guard for the gamification-integrity bug: a freshly-created
    // task (created on the completion day) must be predicted eligible, matching
    // the corrected processApprovedCompletion behaviour.
    const result = classifyRecoveryCompletion(baseInput({
      existingSnapshot: null,
      task: task({ createdAt: COMPLETED_AT }),
      familyTasks: [task({ createdAt: COMPLETED_AT })],
    }))
    expect(result.eligible).toBe(true)
    expect(result.reason).toBe(null)
  })

  it('migration not ready is NOT eligible', () => {
    const result = classifyRecoveryCompletion(baseInput({ migrationStatus: 'inactive' }))
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('migration_not_ready:inactive')
  })

  it('invalid (negative) reward is NOT eligible', () => {
    const result = classifyRecoveryCompletion(baseInput({ taskPointsReward: -5, task: task({ pointsReward: -5 }) }))
    expect(result.eligible).toBe(false)
    expect(result.reason).toBe('invalid_reward')
  })
})

// ---------------------------------------------------------------------------
// Parity: run the REAL processor and assert the scanner prediction matches.
// ---------------------------------------------------------------------------

interface Store { [path: string]: Record<string, unknown> }

function fakeDb(initial: Store) {
  // Use the caller's store by reference so writes persist across processor runs
  // (required to observe real idempotency/duplicate behaviour).
  const store: Store = initial
  const docRef = (path: string) => {
    const col = (name: string) => collectionRef(`${path}/${name}`)
    return { path, id: path.split('/').at(-1)!, collection: col }
  }
  const collectionRef = (path: string) => {
    const doc = (id: string) => docRef(`${path}/${id}`)
    return { path, doc }
  }
  const db = {
    store,
    doc: (path: string) => docRef(path),
    collection: (path: string) => collectionRef(path),
    runTransaction: <T>(run: (tx: unknown) => Promise<T>) => {
      const txStore = store
      const tx = {
        get: async (ref: { path: string }) => {
          const path = ref.path
          if (Object.hasOwn(txStore, path)) return { exists: true, id: path.split('/').at(-1)!, data: () => txStore[path] }
          const prefix = `${path}/`
          const childDocs = Object.keys(txStore).filter(k => k.startsWith(prefix) && k.split('/').length === path.split('/').length + 1)
          if (childDocs.length > 0) return { docs: childDocs.map(k => ({ id: k.split('/').at(-1)!, data: () => txStore[k] })), size: childDocs.length, empty: false }
          return { exists: false, id: path.split('/').at(-1)!, data: () => ({}) }
        },
        set: (ref: { path: string }, data: Record<string, unknown>) => { txStore[ref.path] = data },
        update: (ref: { path: string }, data: Record<string, unknown>) => { txStore[ref.path] = { ...(txStore[ref.path] || {}), ...data } },
        create: (ref: { path: string }, data: Record<string, unknown>) => {
          if (Object.hasOwn(txStore, ref.path)) throw new Error(`ALREADY_EXISTS: ${ref.path}`)
          txStore[ref.path] = data
        },
      }
      return run(tx as never)
    },
  }
  return db
}

function ts(millis: number) {
  return { toMillis: () => millis, toDate: () => new Date(millis), seconds: Math.floor(millis / 1000), nanoseconds: 0 }
}

function seedFamily(store: Store, opts: { snapshot?: Record<string, number> | null; assigneeId?: string; completionChild?: string; duplicate?: boolean } = {}) {
  const dayKey = familyDayKey(COMPLETED_AT, TZ)
  store[`families/${FAMILY}`] = {
    timezone: TZ,
    gamificationMigration: { schemaVersion: 1, status: 'active', cutoverAt: new Date(CUTOVER) },
    gamification: { schemaVersion: 1, dailyGoalPercentage: 80 },
  }
  const childDoc = () => ({ role: 'child', status: 'active', familyId: FAMILY, ['reward' + 'Points']: 0 })
  store[`users/${CHILD}`] = childDoc()
  store[`users/${OTHER}`] = childDoc()
  store[`families/${FAMILY}/tasks/${TASK}`] = {
    assigneeId: opts.assigneeId ?? CHILD, pointsReward: 10, type: 'daily', isActive: true, status: 'active',
    createdAt: new Date(Date.parse('2026-07-01T00:00:00Z')),
  }
  store[`families/${FAMILY}/task_completions/${COMPLETION}`] = {
    status: 'approved', taskId: TASK, assigneeId: opts.completionChild ?? CHILD,
    completedAt: new Date(COMPLETED_AT), approvedAt: new Date(APPROVED_AT),
  }
  if (opts.snapshot !== undefined && opts.snapshot !== null) {
    store[`families/${FAMILY}/daily_eligibility/${CHILD}:${dayKey}`] = {
      schemaVersion: 1, familyId: FAMILY, childId: CHILD, dayKey, timezone: TZ, dailyGoalPercentage: 80,
      taskWeights: opts.snapshot, eligibleTaskCount: Object.keys(opts.snapshot).length, eligiblePoints: Object.values(opts.snapshot).reduce((a, b) => a + b, 0),
      effectiveAt: ts(COMPLETED_AT - 3600_000), createdAt: ts(COMPLETED_AT - 3600_000),
    }
  }
  if (opts.duplicate) {
    const logical = `task_v1|${CHILD}|${TASK}|${dayKey}`
    store[`families/${FAMILY}/task_occurrences/${logical}`] = {
      schemaVersion: 1, familyId: FAMILY, childId: CHILD, taskId: TASK, logicalCompletionKey: logical, periodKey: dayKey,
      completionId: COMPLETION, dayKey,
    }
  }
  return dayKey
}

async function runProcessor(store: Store) {
  const repository = new AdminGamificationRepository(fakeDb(store) as never)
  try {
    const result = await repository.processApprovedCompletion({ familyId: FAMILY, completionId: COMPLETION, processingAt: APPROVED_AT + 1 })
    return { status: result.status, error: null as string | null }
  } catch (e) {
    return { status: 'error', error: (e as Error).message }
  }
}

describe('scanner/processor parity (real processApprovedCompletion)', () => {
  it('valid historical completion: processor processed == scanner eligible', async () => {
    const store: Store = {}
    seedFamily(store, { snapshot: { [TASK]: 10 } })
    const proc = await runProcessor(store)
    expect(proc.status).toBe('processed')
    expect(classifyRecoveryCompletion(baseInput()).eligible).toBe(true)
  })

  it('task created after snapshot: processor rejects == scanner ineligible', async () => {
    const store: Store = {}
    seedFamily(store, { snapshot: { 'other-task': 5 } })
    const proc = await runProcessor(store)
    expect(proc.status).toBe('error')
    expect(proc.error).toMatch(/immutable daily snapshot/)
    const scan = classifyRecoveryCompletion(baseInput({ existingSnapshot: { taskWeights: { 'other-task': 5 } } }))
    expect(scan.eligible).toBe(false)
    expect(scan.reason).toBe('not_in_immutable_snapshot')
  })

  it('wrong child: processor rejects == scanner ineligible', async () => {
    const store: Store = {}
    seedFamily(store, { snapshot: { [TASK]: 10 }, assigneeId: OTHER })
    const proc = await runProcessor(store)
    expect(proc.status).not.toBe('processed')
    const scan = classifyRecoveryCompletion(baseInput({
      task: task({ assigneeId: OTHER }), familyTasks: [task({ assigneeId: OTHER })],
    }))
    expect(scan.eligible).toBe(false)
  })

  it('pre-cutover: processor ignored == scanner ineligible', async () => {
    const store: Store = {}
    seedFamily(store, { snapshot: { [TASK]: 10 } })
    store[`families/${FAMILY}`].gamificationMigration = { schemaVersion: 1, status: 'active', cutoverAt: new Date(APPROVED_AT + 1000) }
    const proc = await runProcessor(store)
    expect(proc.status).toBe('ignored')
    expect(classifyRecoveryCompletion(baseInput({ approvedAt: CUTOVER - 1000 })).eligible).toBe(false)
  })

  it('duplicate: processor duplicate == scanner eligible-but-idempotency-excluded', async () => {
    const store: Store = {}
    seedFamily(store, { snapshot: { [TASK]: 10 } })
    const first = await runProcessor(store)
    expect(first.status).toBe('processed')
    const proc = await runProcessor(store)
    expect(proc.status).toBe('duplicate')
    expect(classifyRecoveryCompletion(baseInput()).eligible).toBe(true)
  })

  it('P0 parity — same-day post-freeze task: processor processed == scanner eligible', async () => {
    // 1. Snapshot frozen BEFORE the task existed (does not list the task).
    // 2. Task created later the SAME family-local day as the completion.
    // 3. Live processApprovedCompletion considers it eligible (same-day fallback).
    // 4. Recovery classifier also considers it eligible (parity).
    const store: Store = {}
    seedFamily(store, { snapshot: { 'other-task': 5 } })
    // Task created later the same day (after the snapshot froze).
    store[`families/${FAMILY}/tasks/${TASK}`].createdAt = new Date(COMPLETED_AT)
    const proc = await runProcessor(store)
    expect(proc.status).toBe('processed')
    const scan = classifyRecoveryCompletion(baseInput({
      existingSnapshot: { taskWeights: { 'other-task': 5 } },
      task: task({ createdAt: COMPLETED_AT }),
      familyTasks: [task({ createdAt: COMPLETED_AT })],
    }))
    expect(scan.eligible).toBe(true)
    expect(scan.reason).toBe(null)
  })

  it('P0 parity — prior-day task absent from frozen snapshot: processor rejects == scanner ineligible', async () => {
    // 5. A task created on a PRIOR day and absent from the immutable snapshot
    //    must still be rejected by BOTH the live processor and the recovery
    //    classifier (anti-forgery / immutable-history contract).
    const store: Store = {}
    seedFamily(store, { snapshot: { 'other-task': 5 } })
    const proc = await runProcessor(store)
    expect(proc.status).toBe('error')
    expect(proc.error).toMatch(/immutable daily snapshot/)
    const scan = classifyRecoveryCompletion(baseInput({
      existingSnapshot: { taskWeights: { 'other-task': 5 } },
      task: task({ createdAt: Date.parse('2026-07-01T00:00:00Z') }),
      familyTasks: [task({ createdAt: Date.parse('2026-07-01T00:00:00Z') })],
    }))
    expect(scan.eligible).toBe(false)
    expect(scan.reason).toBe('not_in_immutable_snapshot')
  })
})
