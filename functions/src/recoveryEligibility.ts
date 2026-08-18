/**
 * Recovery eligibility — the SINGLE source of truth for whether an approved
 * task completion would be awarded by the canonical gamification processor
 * (`processApprovedCompletion` in `gamificationRepository.ts`).
 *
 * This module exists so the read-only P0 recovery scanner
 * (`scripts/p0-scan-unprocessed-approvals.cjs`) and the regression tests can
 * predict the processor's decision WITHOUT re-implementing its gating. Every
 * predicate here is a faithful, side-effect-free mirror of the processor's
 * transaction logic, including the immutable daily-eligibility snapshot check
 * that the original scanner omitted (the root cause of the P0 false positives).
 *
 * The processor's authoritative predicate (verbatim from
 * `processApprovedCompletion`):
 *   1. completion.status === 'approved'            (caller pre-filters)
 *   2. migration status in GAMIFICATION_READY_STATUSES
 *   3. cutoverAt present and approvedAt >= cutoverAt
 *   4. child active in family (role/status/disabled/familyId)
 *   5. task exists
 *   6. taskIsAwardableForChild
 *   7. valid non-negative integer reward
 *   8. the task is present in the immutable daily_eligibility snapshot for
 *      (childId, dayKey) — OR, when no snapshot exists yet, in the expected
 *      snapshot built from the current family task list. A task missing from
 *      the frozen snapshot is NOT awardable (anti-forgery / immutable history).
 *
 * Do NOT "trust" the mutable current task assignment when the historical
 * snapshot is authoritative: predicate 8 is the whole point.
 */
import {
  buildDailyEligibilitySnapshot,
  isTaskEligibleForDay,
  taskIsAwardableForChild,
  type RepositoryScheduledTask,
} from './dailyEligibilityAdapter'
import { resolveGamificationConfig } from '../../src/domain/gamification/config'
import { familyDayKey } from '../../src/domain/gamification/dailyProgress'

const READY_STATUSES: ReadonlySet<string> = new Set(['prepared', 'baseline_complete', 'active'])

/** Minimal view of a `users` document the processor gates on. */
export interface RecoveryChildView {
  readonly role?: string | null
  readonly status?: string | null
  readonly disabled?: boolean | null
  readonly familyId?: string | null
}

export interface RecoveryEligibilityInput {
  readonly familyId: string
  readonly childId: string
  readonly taskId: string
  readonly taskPointsReward: number
  readonly migrationStatus: string
  readonly cutoverAt: number | null
  readonly approvedAt: number
  readonly child: RecoveryChildView | null
  /** The completion's task, already mapped to the adapter's scheduled-task shape. */
  readonly task: RepositoryScheduledTask | null
  /**
   * The existing immutable `daily_eligibility` snapshot for `${childId}:${dayKey}`,
   * or `null` when none has been frozen yet for that day.
   */
  readonly existingSnapshot: { readonly taskWeights?: Readonly<Record<string, number>> } | null
  /** Every task in the family, used to build the expected snapshot when none exists. */
  readonly familyTasks: readonly RepositoryScheduledTask[]
  readonly timezone: string
  /** Completion `completedAt` in epoch milliseconds — used to derive `dayKey`. */
  readonly completedAt: number
  readonly processingAt: number
  /** Resolved `dailyGoalPercentage` for the family (from `resolveGamificationConfig`). */
  readonly dailyGoalPercentage: number
}

export interface RecoveryEligibilityResult {
  readonly eligible: boolean
  readonly reason: string | null
}

/**
 * Mirrors `processApprovedCompletion`'s gating exactly. Returns
 * `{ eligible: true }` only when the processor would award the completion.
 */
export function classifyRecoveryCompletion(input: RecoveryEligibilityInput): RecoveryEligibilityResult {
  const {
    familyId, childId, taskId, taskPointsReward, migrationStatus, cutoverAt, approvedAt,
    child, task, existingSnapshot, familyTasks, timezone, completedAt, processingAt, dailyGoalPercentage,
  } = input

  // 2. Migration readiness (matches GAMIFICATION_READY_STATUSES).
  if (!READY_STATUSES.has(migrationStatus)) {
    return { eligible: false, reason: `migration_not_ready:${migrationStatus}` }
  }
  // 3. Cutover gate.
  if (cutoverAt === null) return { eligible: false, reason: 'missing_cutoverAt' }
  if (approvedAt < cutoverAt) return { eligible: false, reason: 'pre_cutover_ignored' }
  // 4. Child active in family.
  if (!child || child.role !== 'child' || child.status === 'deleted' || child.status === 'disabled'
    || child.disabled === true || child.familyId !== familyId) {
    return { eligible: false, reason: 'child_not_active_in_family' }
  }
  // 5. Task exists.
  if (!task) return { eligible: false, reason: 'task_missing' }
  // 6. Task ownership.
  if (!taskIsAwardableForChild(task, childId)) return { eligible: false, reason: 'task_assigned_to_another_child' }
  // 7. Valid reward.
  if (typeof taskPointsReward !== 'number' || !Number.isSafeInteger(taskPointsReward) || taskPointsReward < 0) {
    return { eligible: false, reason: 'invalid_reward' }
  }

  // 8. Immutable daily-eligibility snapshot (the predicate the original scanner dropped).
  const dayKey = familyDayKey(completedAt, timezone)
  let frozenWeight: number | undefined
  const existingWeights = existingSnapshot?.taskWeights
  if (existingWeights && Object.prototype.hasOwnProperty.call(existingWeights, taskId)) {
    frozenWeight = existingWeights[taskId]
  } else if (existingWeights) {
    // Snapshot exists but does not list this task → not eligible by default
    // (frozen history). The one legitimate exception — a task created AFTER the
    // snapshot was frozen, later the SAME family-local day — is handled by the
    // same-day fallback below, mirroring processApprovedCompletion.
    frozenWeight = undefined
  } else {
    // No snapshot frozen yet: build the expected snapshot from current family tasks,
    // exactly as the processor does when eligibilityDocument does not exist.
    const expected = buildDailyEligibilitySnapshot({
      familyId,
      childId,
      dayKey,
      timezone,
      dailyGoalPercentage,
      tasks: familyTasks.filter((t) => taskIsAwardableForChild(t, childId)),
      effectiveAt: completedAt,
      createdAt: processingAt,
    })
    frozenWeight = expected.taskWeights[taskId]
  }

  // Same-day fallback (mirrors processApprovedCompletion EXACTLY). A task absent
  // from the frozen snapshot is still awardable ONLY when it was created on the
  // same family-local day as the completion/approval day AND passes
  // isTaskEligibleForDay. This covers the case where the daily snapshot froze
  // first and a parent created a new task later the same day, the child completed
  // it, and the parent approved it. We use the task's authoritative points reward
  // (taskPointsReward). Prior-day tasks missing from the immutable snapshot remain
  // rejected — they cannot be a legitimate same-day creation, so allowing them
  // would be a backdated forgery (anti-forgery / immutable-history contract).
  if (frozenWeight === undefined && taskPointsReward !== 0) {
    if (
      task !== null
      && task.createdAt !== undefined
      && familyDayKey(task.createdAt, timezone) === dayKey
      && isTaskEligibleForDay(task, childId, dayKey, timezone)
    ) {
      frozenWeight = taskPointsReward
    }
  }

  if (frozenWeight === undefined && taskPointsReward !== 0) {
    return { eligible: false, reason: 'not_in_immutable_snapshot' }
  }
  return { eligible: true, reason: null }
}

/** Convenience: does the task pass `isTaskEligibleForDay` for the given day? (test helper) */
export function taskEligibleOnDay(task: RepositoryScheduledTask, childId: string, dayKey: string, timezone: string): boolean {
  return isTaskEligibleForDay(task, childId, dayKey, timezone)
}
