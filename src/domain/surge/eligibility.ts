/**
 * Surge eligibility resolver — single source of truth.
 *
 * Pure function: same inputs ⇒ same outputs. No clock access, no
 * randomness, no Firestore, no React. Imported by the client-side
 * engagement resolver (for presentation) and the server-side
 * authoritative evaluator (for awarding).
 *
 * Architectural law:
 *   Engagement Engine creates opportunities.
 *   Gamification Engine awards value.
 *
 * This resolver ONLY decides. Awarding lives in the gamification
 * pipeline (functions/src/gamificationRepository.processApprovedCompletion).
 *
 * Boundary semantics — PINNED by tests:
 *   completedAt ∈ [startsAt, endsAt)   → eligible
 *   completedAt === endsAt              → not eligible
 *
 * The half-open window is deliberate. It mirrors the existing
 * `EventDefinition` resolver convention (see `isEventLive` in
 * `src/domain/experience/resolver.ts`) so the same window semantics
 * govern both theme eligibility and Surge eligibility.
 *
 * Check order (each step short-circuits with a specific reason so
 * audit logs can distinguish):
 *   1. Reward shape       → invalid_completion (xp_multiplier rejected, V1)
 *   2. Family opt-in      → preference_disabled
 *   3. Completion identity → invalid_completion
 *   4. Sibling denial      → sibling_assigned
 *   5. Idempotency         → duplicate (BEFORE task eligibility — if the
 *                            same completionId has already been awarded
 *                            for this surge, we never look at task list)
 *   6. Task on list        → task_not_eligible
 *   7. Window              → outside_window
 *   8. Eligible            → in_window (+ rewardSnapshot)
 */

import {
  isInWindow,
  type SurgeEligibilityInput,
  type SurgeEligibilityResult,
  type SurgeReward,
  type SurgeSnapshot,
} from './types'

/** Returns a frozen, deterministic snapshot for the immutable ledger. */
export function buildSurgeSnapshot(input: SurgeEligibilityInput): SurgeSnapshot {
  const reward = input.surge.reward
  if (reward.type !== 'bonus_points') {
    // Defensive — the eligibility gate rejects xp_multiplier; this
    // should never be reached for a valid call.
    throw new Error('buildSurgeSnapshot only supports bonus_points rewards in V1')
  }
  return Object.freeze({
    surgeId: input.surgeId,
    rewardType: 'bonus_points',
    rewardAmount: reward.amount,
    eventVersion: 1,
    completedWithinWindow: true,
    completedAt: input.completion.completedAt,
    taskId: input.completion.taskId,
    childId: input.completion.childId,
  }) as SurgeSnapshot
}

function invalidCompletion(): SurgeEligibilityResult {
  return Object.freeze({ eligible: false, reason: 'invalid_completion' }) as SurgeEligibilityResult
}

function siblingAssigned(): SurgeEligibilityResult {
  return Object.freeze({ eligible: false, reason: 'sibling_assigned' }) as SurgeEligibilityResult
}

function taskNotEligible(): SurgeEligibilityResult {
  return Object.freeze({ eligible: false, reason: 'task_not_eligible' }) as SurgeEligibilityResult
}

function duplicate(): SurgeEligibilityResult {
  return Object.freeze({ eligible: false, reason: 'duplicate' }) as SurgeEligibilityResult
}

function preferenceDisabled(): SurgeEligibilityResult {
  return Object.freeze({ eligible: false, reason: 'preference_disabled' }) as SurgeEligibilityResult
}

function outsideWindow(): SurgeEligibilityResult {
  return Object.freeze({ eligible: false, reason: 'outside_window' }) as SurgeEligibilityResult
}

function isCompleteContext(input: SurgeEligibilityInput): boolean {
  const { completion, task } = input
  if (typeof completion.id !== 'string' || completion.id.length === 0) return false
  if (typeof completion.childId !== 'string' || completion.childId.length === 0) return false
  if (typeof completion.taskId !== 'string' || completion.taskId.length === 0) return false
  if (typeof completion.completedAt !== 'number' || !Number.isFinite(completion.completedAt)) {
    return false
  }
  if (typeof task.id !== 'string' || task.id.length === 0) return false
  if (completion.taskId !== task.id) return false
  return true
}

function isSiblingAssigned(input: SurgeEligibilityInput): boolean {
  if (input.task.assigneeId === null) return false
  return input.task.assigneeId !== input.completion.childId
}

function isEligibleTaskId(input: SurgeEligibilityInput): boolean {
  const ids = input.surge.eligibleTaskIds
  if (!Array.isArray(ids) || ids.length === 0) return false
  return ids.includes(input.completion.taskId)
}

function isDisabledReward(reward: SurgeReward): boolean {
  // xp_multiplier is modelled but disabled in V1 to avoid destabilising
  // the XP rebuild/projection pipeline. The type stays so fixtures can
  // declare it for parsing/validation tests.
  return reward.type === 'xp_multiplier'
}

/**
 * Decide whether a single completion qualifies for a Surge bonus.
 *
 * The caller (client OR server) supplies all inputs. The resolver is
 * stateless and deterministic.
 */
export function evaluateSurgeEligibility(
  input: SurgeEligibilityInput,
): SurgeEligibilityResult {
  // 1. Reward shape must be a supported V1 type.
  if (isDisabledReward(input.surge.reward)) return invalidCompletion()

  // 2. Family opt-in.
  if (input.familyPreferences.surgeHours !== true) return preferenceDisabled()

  // 3. Completion identity must be self-consistent.
  if (!isCompleteContext(input)) return invalidCompletion()

  // 4. Sibling denial — task assigned to a different child.
  if (isSiblingAssigned(input)) return siblingAssigned()

  // 5. Idempotency BEFORE task-eligibility: a previously-awarded pair is
  //    a no-op regardless of whether the task is currently on the list.
  //    This protects the audit log from spurious "task_not_eligible"
  //    entries for bonuses that already exist.
  const prior = input.alreadyAwardedForCompletionIds ?? []
  if (prior.includes(input.completion.id)) return duplicate()

  // 6. Task must be on the Surge's eligible list.
  if (!isEligibleTaskId(input)) return taskNotEligible()

  // 7. Window half-open check using the AUTHORITATIVE completion time.
  if (!isInWindow(input.completion.completedAt, input.surgeWindow)) return outsideWindow()

  // 8. Eligible — capture the snapshot now.
  return Object.freeze({
    eligible: true,
    reason: 'in_window',
    rewardSnapshot: buildSurgeSnapshot(input),
  }) as SurgeEligibilityResult
}

/**
 * Build the idempotency anchor for a Surge bonus.
 *
 * Format: `surge:{surgeId}:completion:{completionId}` — see types.ts.
 */
export function surgeIdempotencyKey(surgeId: string, completionId: string): string {
  return `surge:${surgeId}:completion:${completionId}`
}