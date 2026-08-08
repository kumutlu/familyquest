import { familyDayKey } from '../../src/domain/gamification/dailyProgress'
import type { DailyEligibilitySnapshotV1 } from '../../src/domain/gamification/types'

export interface RepositoryScheduledTask {
  readonly id: string
  readonly assigneeId?: string
  readonly pointsReward: unknown
  readonly requiresApproval?: boolean
  readonly type?: string
  readonly isActive?: boolean
  readonly status?: string
  readonly archived?: boolean
  readonly isArchived?: boolean
  readonly deleted?: boolean
  readonly disabled?: boolean
  readonly archivedAt?: number
  readonly deletedAt?: number
  readonly disabledAt?: number
  readonly createdAt?: number
  readonly effectiveFrom?: string
  readonly effectiveTo?: string
  readonly effectiveFromAt?: number
  readonly effectiveToAt?: number
  readonly dueDate?: string
  /** ISO weekday, Monday=1 through Sunday=7. */
  readonly dueWeekday?: number
  readonly customDays?: readonly (number | string)[]
}

export interface BuildDailyEligibilitySnapshotInput {
  readonly familyId: string
  readonly childId: string
  readonly dayKey: string
  readonly timezone: string
  readonly dailyGoalPercentage: number
  readonly tasks: readonly RepositoryScheduledTask[]
  readonly effectiveAt: number
  readonly createdAt: number
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

function assertDayKey(value: string): void {
  if (!DAY_KEY.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new Error('dayKey must be a valid YYYY-MM-DD date')
}

function isoWeekday(dayKey: string): number {
  const day = new Date(`${dayKey}T12:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}

function addDays(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function mondayOf(dayKey: string): string {
  return addDays(dayKey, 1 - isoWeekday(dayKey))
}

function dueOnDay(task: RepositoryScheduledTask, dayKey: string): boolean {
  const weekday = isoWeekday(dayKey)
  switch (task.type ?? 'one-time') {
    case 'daily': return true
    case 'weekdays': return weekday <= 5
    case 'weekends': return weekday >= 6
    case 'weekly': return weekday === (task.dueWeekday ?? 1)
    case 'custom': return (task.customDays ?? []).some(value => value === weekday || String(value).toLowerCase() === ['','monday','tuesday','wednesday','thursday','friday','saturday','sunday'][weekday])
    case 'one-time': {
      if (task.dueDate !== undefined) return task.dueDate === dayKey
      if (task.createdAt === undefined) return false
      return addDays(familyDayKey(task.createdAt, 'UTC'), 1) === dayKey
    }
    default: return false
  }
}

/**
 * Approved shared-task rule.
 *
 * - An assigned task (`assigneeId` present) may only be awarded to that child.
 * - A task without `assigneeId` is shared/family-wide: any active child in the
 *   same family may complete it.
 *
 * Family membership and child activity are enforced by the caller; this
 * predicate only decides task ownership.
 */
export function taskIsAwardableForChild(task: RepositoryScheduledTask, childId: string): boolean {
  return task.assigneeId === undefined || task.assigneeId === childId
}

/** Product Gate A eligibility policy. A frozen snapshot is never recomputed from later task edits. */
export function isTaskEligibleForDay(
  task: RepositoryScheduledTask,
  childId: string,
  dayKey: string,
  timezone: string,
): boolean {
  assertDayKey(dayKey)
  if (!taskIsAwardableForChild(task, childId) || task.isActive !== true) return false
  if (task.archived === true || task.isArchived === true || task.deleted === true || task.disabled === true
    || task.archivedAt !== undefined || task.deletedAt !== undefined || task.disabledAt !== undefined) return false
  if (['archived', 'deleted', 'disabled', 'inactive'].includes(task.status ?? '')) return false
  if (task.effectiveFrom !== undefined && dayKey < task.effectiveFrom) return false
  if (task.effectiveTo !== undefined && dayKey > task.effectiveTo) return false
  if (task.effectiveFromAt !== undefined && dayKey < familyDayKey(task.effectiveFromAt, timezone)) return false
  if (task.effectiveToAt !== undefined && dayKey > familyDayKey(task.effectiveToAt, timezone)) return false
  if (task.createdAt !== undefined && familyDayKey(task.createdAt, timezone) >= dayKey) return false
  return dueOnDay(task, dayKey)
}

/** Server-derived recurrence identity; client periodKey is intentionally absent. */
export function authoritativePeriodKey(task: RepositoryScheduledTask, dayKey: string): string {
  assertDayKey(dayKey)
  switch (task.type ?? 'one-time') {
    case 'daily':
    case 'weekdays':
    case 'weekends':
    case 'custom':
      return dayKey
    case 'weekly':
      return `week:${mondayOf(dayKey)}`
    case 'one-time':
      return `one-time:${task.dueDate ?? dayKey}`
    default:
      throw new Error(`Unsupported task schedule type: ${String(task.type)}`)
  }
}

function assertIdentity(value: string, label: string): void {
  if (value.length === 0 || value.includes('/')) throw new Error(`${label} must be a non-empty Firestore identity`)
}

export function buildDailyEligibilitySnapshot(input: BuildDailyEligibilitySnapshotInput): Readonly<DailyEligibilitySnapshotV1> {
  assertIdentity(input.familyId, 'familyId')
  assertIdentity(input.childId, 'childId')
  assertDayKey(input.dayKey)
  if (!Number.isInteger(input.dailyGoalPercentage) || input.dailyGoalPercentage < 50 || input.dailyGoalPercentage > 100) {
    throw new Error('dailyGoalPercentage must be an integer from 50 through 100')
  }
  if (!Number.isSafeInteger(input.effectiveAt) || input.effectiveAt < 0 || !Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
    throw new Error('snapshot timestamps must be non-negative safe integers')
  }

  const taskWeights: Record<string, number> = {}
  let total = 0n
  for (const task of [...input.tasks].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (typeof task.pointsReward !== 'number' || !Number.isSafeInteger(task.pointsReward) || task.pointsReward < 0) {
      throw new Error(`Task ${task.id} has an invalid reward`)
    }
    if (task.pointsReward === 0 || !isTaskEligibleForDay(task, input.childId, input.dayKey, input.timezone)) continue
    assertIdentity(task.id, 'taskId')
    if (Object.hasOwn(taskWeights, task.id)) throw new Error(`Duplicate task identity ${task.id}`)
    taskWeights[task.id] = task.pointsReward
    total += BigInt(task.pointsReward)
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('eligible reward total exceeds the safe integer range')
  Object.freeze(taskWeights)
  return Object.freeze({
    schemaVersion: 1,
    familyId: input.familyId,
    childId: input.childId,
    dayKey: input.dayKey,
    timezone: input.timezone,
    dailyGoalPercentage: input.dailyGoalPercentage,
    taskWeights,
    eligibleTaskCount: Object.keys(taskWeights).length,
    eligiblePoints: Number(total),
    effectiveAt: input.effectiveAt,
    causalGroupId: `eligibility_v1|${input.familyId}|${input.childId}|${input.dayKey}`,
    transitionRank: 0,
    createdAt: input.createdAt,
    createdBy: 'gamification-engine-v1',
  })
}
