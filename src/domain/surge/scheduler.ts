/**
 * Surge scheduler — deterministic, testable, anti-gaming.
 *
 * The scheduler decides whether a Surge MAY be emitted right now. It does
 * not mint rewards. Reward authority lives in the gamification pipeline.
 *
 * Architectural rules:
 *   - Pure: no clock access, no Firestore, no Math.random. Same inputs
 *     ⇒ same outputs.
 *   - Anti-gaming defaults are pinned by tests:
 *       * maxSurgesPerDay = 3
 *       * maxSurgesPerWeek = 12
 *       * minimumGapBetweenSurges = 90 minutes
 *   - Quotas and gap are family-scoped, supplied by the caller (the
 *     caller is responsible for tracking counts — usually a per-family
 *     counter snapshot from Firestore). The scheduler only validates.
 *   - When the candidate Surge declares an `xp_multiplier` reward, the
 *     scheduler rejects it (V1 disabled). A Surge is only ever emitted
 *     when its reward type is `bonus_points`.
 */

import type { SurgeEligibilityDefinition } from './types'

/** Anti-gaming limits. Frozen so tests can pin exact values. */
export const DEFAULT_SURGE_SCHEDULER_LIMITS = Object.freeze({
  maxSurgesPerDay: 3,
  maxSurgesPerWeek: 12,
  /** Minimum gap between the END of the previous Surge and the START of
   *  the candidate. Prevents bursty / predictable schedules. */
  minimumGapBetweenSurges: 90 * 60 * 1000,
})

export interface SurgeSchedulerLimits {
  readonly maxSurgesPerDay: number
  readonly maxSurgesPerWeek: number
  readonly minimumGapBetweenSurges: number
}

export interface SurgeSchedulerInput {
  /** Stable seed (e.g. family id). Used for deterministic selection. */
  readonly seed: string
  /** Server clock in epoch ms. */
  readonly now: number
  /** Number of Surges the family has already received today. */
  readonly todaysSurges: number
  /** Number of Surges the family has already received this week. */
  readonly weeksSurges: number
  /** Epoch ms when the last Surge ended, or null if none. */
  readonly lastSurgeEndedAt: number | null
  /** Family opt-in. */
  readonly familyPreferences: { surgeHours: boolean }
  /** Candidate Surge definition (built by the operator / catalog). */
  readonly candidate: SurgeEligibilityDefinition
  /** Candidate Surge window. */
  readonly candidateWindow: { startsAt: number; endsAt: number }
  /** Optional overrides for tests. */
  readonly limits?: SurgeSchedulerLimits
}

export type SurgeSchedulerDecisionReason =
  | 'preference_disabled'
  | 'daily_quota_exhausted'
  | 'weekly_quota_exhausted'
  | 'gap_too_short'
  | 'seed_selected_none'
  | 'malformed'

export interface SurgeSchedulerDecision {
  readonly mayEmit: boolean
  readonly reason: SurgeSchedulerDecisionReason
  readonly candidateSurge?: SurgeEligibilityDefinition
}

function isMalformedWindow(window: { startsAt: number; endsAt: number }): boolean {
  if (typeof window.startsAt !== 'number' || typeof window.endsAt !== 'number') return true
  if (!Number.isFinite(window.startsAt) || !Number.isFinite(window.endsAt)) return true
  return window.endsAt <= window.startsAt
}

function isXpMultiplierReward(surge: SurgeEligibilityDefinition): boolean {
  return surge.reward.type === 'xp_multiplier'
}

/**
 * A deterministic, no-clock pseudo-random in [0, 1) derived from a seed.
 * Replaces Math.random() so the scheduler is fully testable.
 */
function deterministicUnit(seed: string, salt: string): number {
  // Tiny FNV-1a hash, sufficient for selection. Deterministic across
  // platforms, no Math.random involvement.
  const input = `${seed}::${salt}`
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  // Map to [0, 1).
  return (h >>> 0) / 0x1_0000_0000
}

export function decideSurgeEmission(input: SurgeSchedulerInput): SurgeSchedulerDecision {
  const limits = input.limits ?? DEFAULT_SURGE_SCHEDULER_LIMITS

  // Preference gate.
  if (input.familyPreferences.surgeHours !== true) {
    return { mayEmit: false, reason: 'preference_disabled' }
  }

  // Clock + window sanity.
  if (
    typeof input.now !== 'number' ||
    !Number.isFinite(input.now) ||
    isMalformedWindow(input.candidateWindow)
  ) {
    return { mayEmit: false, reason: 'malformed' }
  }

  // Quotas.
  if (input.todaysSurges >= limits.maxSurgesPerDay) {
    return { mayEmit: false, reason: 'daily_quota_exhausted' }
  }
  if (input.weeksSurges >= limits.maxSurgesPerWeek) {
    return { mayEmit: false, reason: 'weekly_quota_exhausted' }
  }

  // Minimum gap from previous Surge.
  if (input.lastSurgeEndedAt !== null) {
    const sinceLast = input.now - input.lastSurgeEndedAt
    if (sinceLast < limits.minimumGapBetweenSurges) {
      return { mayEmit: false, reason: 'gap_too_short' }
    }
  }

  // Candidate must declare at least one eligible task and a supported
  // V1 reward type.
  const ids = input.candidate.eligibleTaskIds
  if (!Array.isArray(ids) || ids.length === 0) {
    return { mayEmit: false, reason: 'seed_selected_none' }
  }
  if (isXpMultiplierReward(input.candidate)) {
    return { mayEmit: false, reason: 'seed_selected_none' }
  }

  // Deterministic selection: shrink eligibleTaskIds to a single task id
  // for the presentation layer. The eligibility resolver still verifies
  // membership against the FULL list, so this narrowing is presentation-
  // only and never weakens the reward gate.
  const idx = Math.floor(
    deterministicUnit(input.seed, 'surge-pick') * ids.length,
  )
  const safeIdx = Math.min(Math.max(idx, 0), ids.length - 1)
  const selectedId = ids[safeIdx]
  const narrowed: SurgeEligibilityDefinition = {
    ...input.candidate,
    eligibleTaskIds: [selectedId],
  }

  return {
    mayEmit: true,
    reason: 'seed_selected_none', // unused when mayEmit=true; kept for type stability
    candidateSurge: narrowed,
  }
}

/** Convenience: same inputs ⇒ same day key. Used by callers that need a
 *  deterministic per-day identifier. */
export function surgeDayKey(now: number, timezone?: string): string {
  const date = new Date(now)
  if (timezone) {
    try {
      const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
      // en-CA emits YYYY-MM-DD.
      return fmt.format(date)
    } catch {
      // Invalid timezone → fall through to UTC.
    }
  }
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}