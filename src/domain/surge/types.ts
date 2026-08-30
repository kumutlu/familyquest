/**
 * Surge + Daily Engagement domain — pure type contracts (V1).
 *
 * Engagement creates opportunities; Gamification awards value.
 *
 * These types are the single source of truth for the Surge model. They are
 * imported by the client-side engagement resolver, by the server-side
 * authoritative evaluator, and by the test suite. They MUST NOT import
 * from Firestore, React, or any side-effecting module.
 *
 * Boundary semantics (pinned by tests):
 *   completedAt ∈ [startsAt, endsAt)   → eligible
 *   completedAt === endsAt              → not eligible
 *   completedAt <  startsAt             → not eligible
 *
 * Approval delay MUST NOT change the result. The reward snapshot is
 * captured at evaluation time and never rebinds.
 */

/** A Surge is always a `task_bonus` in V1. Future kinds (Mystery Drop, …)
 *  belong here, not in code paths scattered across the codebase. */
export type SurgeKind = 'task_bonus'

/**
 * Reward shapes. `xp_multiplier` is modelled and parsed but DISABLED in
 * the V1 evaluator because the existing XP rebuild/projection pipeline is
 * out of scope for this package.
 */
export type SurgeReward =
  | { type: 'bonus_points'; amount: number }
  | { type: 'xp_multiplier'; multiplier: number }

/**
 * Eligibility rule: a Surge applies only to a closed list of task ids.
 * Wildcards / "all tasks" are explicitly NOT supported — closed catalog
 * forces every eligible task to be a deliberate operator choice.
 */
export interface SurgeEligibilityDefinition {
  readonly kind: SurgeKind
  readonly eligibleTaskIds: readonly string[]
  readonly reward: SurgeReward
}

/** Snapshot of a Surge at evaluation time. */
export interface SurgeSnapshot {
  readonly surgeId: string
  readonly rewardType: 'bonus_points'
  readonly rewardAmount: number
  readonly eventVersion: number
  readonly completedWithinWindow: true
  readonly completedAt: number
  readonly taskId: string
  readonly childId: string
}

/** A task as seen by the Surge evaluator. */
export interface SurgeTaskContext {
  readonly id: string
  readonly title: string
  readonly pointsReward: number
  readonly assigneeId: string | null
  readonly requiresApproval: boolean
}

/** A completion as seen by the Surge evaluator. `completedAt` is the
 *  authoritative server-stored value (Firestore rule binds it to
 *  `request.time` at create). `approvedAt` is supplied but never used
 *  for eligibility — see `window uses completedAt` invariant. */
export interface SurgeCompletionContext {
  readonly id: string
  readonly childId: string
  readonly taskId: string
  readonly completedAt: number
  readonly approvedAt?: number
}

export interface SurgeFamilyPreferences {
  /** Master opt-in. Defaults to true for new families. A disable change
   *  applies prospectively; existing bonuses are preserved by immutable
   *  evidence in `gamification_events`. */
  readonly surgeHours: boolean
}

export interface SurgeWindow {
  readonly startsAt: number
  readonly endsAt: number
}

/** Everything the resolver needs in one shape. */
export interface SurgeEligibilityInput {
  readonly surgeId: string
  readonly surge: SurgeEligibilityDefinition
  readonly surgeWindow: SurgeWindow
  readonly task: SurgeTaskContext
  readonly completion: SurgeCompletionContext
  readonly familyPreferences: SurgeFamilyPreferences
  /** Already-evaluated completion ids for THIS surge id. The resolver is
   *  told about prior awards so it can return `duplicate` cleanly without
   *  touching storage. The authoritative evaluator maintains this set by
   *  reading `gamification_events` keyed by `surge:{surgeId}:completion:*`. */
  readonly alreadyAwardedForCompletionIds?: readonly string[]
}

/** Result discriminated by reason. `eligible: true` ⇒ `reason === 'in_window'`. */
export type SurgeEligibilityReason =
  | 'in_window'
  | 'outside_window'
  | 'task_not_eligible'
  | 'sibling_assigned'
  | 'preference_disabled'
  | 'duplicate'
  | 'invalid_completion'

export interface SurgeEligibilityResult {
  readonly eligible: boolean
  readonly reason: SurgeEligibilityReason
  readonly rewardSnapshot?: SurgeSnapshot
}

/**
 * Deterministic, immutable event id for a Surge bonus.
 *
 * Format: `surge:{surgeId}:completion:{completionId}`
 *
 * Idempotency: the same pair can never mint twice because Firestore
 * `create` on the same document id fails with `alreadyExists`, and the
 * authoring reducer ignores a duplicate read.
 */
export function surgeEventId(surgeId: string, completionId: string): string {
  return `surge:${surgeId}:completion:${completionId}`
}

/** Reversal counterpart id, also deterministic and unique. */
export function surgeReversalEventId(surgeId: string, completionId: string): string {
  return `surge:${surgeId}:completion:${completionId}:reversal`
}

/** Defensive: every duration check uses `endsAt` as exclusive bound. */
export function isInWindow(now: number, window: SurgeWindow): boolean {
  if (
    typeof now !== 'number' ||
    !Number.isFinite(now) ||
    typeof window.startsAt !== 'number' ||
    typeof window.endsAt !== 'number' ||
    !Number.isFinite(window.startsAt) ||
    !Number.isFinite(window.endsAt)
  ) {
    return false
  }
  if (window.endsAt <= window.startsAt) return false
  return now >= window.startsAt && now < window.endsAt
}