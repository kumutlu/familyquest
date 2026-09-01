/**
 * Comeback resolver — single source of truth.
 *
 * Pure function. Same inputs ⇒ same outputs. No clock access, no
 * randomness, no Firestore, no React. Imported by the client engagement
 * resolver (for presentation) and the authoritative server evaluator
 * (for awarding).
 *
 * Architectural law:
 *   Engagement Engine creates opportunities.
 *   Gamification Engine awards value.
 *
 * This resolver ONLY decides. Awarding lives in the gamification
 * pipeline (functions/src/comeback/evaluator.ts).
 *
 * Boundary semantics — PINNED by tests:
 *   - inactivityDays uses FAMILY-LOCAL calendar-day arithmetic.
 *   - Tier mapping is whole-day. A child inactive for 1 calendar day
 *     (today vs last meaningful activity) is `return_1d`; 2 days is
 *     still `return_1d`; 3 days is `return_3d`.
 *
 * Approval semantics — PINNED by tests:
 *   - The resolver reports a mission available when the tier is
 *     non-`none` AND the tier has not yet been completed for the
 *     active local date. It does NOT itself check whether today's
 *     quest is approved — that authority lives in the gamification
 *     pipeline.
 */

import {
  familyLocalDateKey,
  inactivityDaysBetween,
  type ComebackTier,
  type ResolveComebackInput,
  type ResolveComebackResult,
} from './types'

export function resolveComeback(input: ResolveComebackInput): ResolveComebackResult {
  const localToday = familyLocalDateKey(input.now, input.timezone)
  const inactivityDays = computeInactivityDays(input, localToday)
  const tier = tierForInactivity(inactivityDays)

  // No tier → no mission.
  if (tier === 'none') {
    return { tier: 'none', inactivityDays, missionId: null, missionCompleted: false }
  }

  // Has the active tier already been completed today?
  const completed = input.completedTiersForDate ?? []
  if (completed.includes(tier)) {
    return { tier, inactivityDays, missionId: null, missionCompleted: true }
  }

  return {
    tier,
    inactivityDays,
    missionId: `mission-${localToday}-${tier}`,
    missionCompleted: false,
  }
}

function computeInactivityDays(input: ResolveComebackInput, localToday: string): number {
  if (input.lastMeaningfulActivityAt === undefined || input.lastMeaningfulActivityAt === null) {
    // Treat first evaluation as `return_7d`.
    return Number.MAX_SAFE_INTEGER
  }
  const last = familyLocalDateKey(input.lastMeaningfulActivityAt, input.timezone)
  return inactivityDaysBetween(localToday, last)
}

export function tierForInactivity(inactivityDays: number): ComebackTier {
  if (!Number.isFinite(inactivityDays) || inactivityDays < 1) return 'none'
  if (inactivityDays < 3) return 'return_1d'
  if (inactivityDays < 7) return 'return_3d'
  return 'return_7d'
}
/* -------------------------------------------------------------------------- */
/* Re-exports for callers that want a single import surface                   */
/* -------------------------------------------------------------------------- */

export {
  COMEBACK_MISSION_BY_TIER,
  DEFAULT_COMEBACK_REWARD_TABLE,
  comebackEventId,
  comebackEvidenceId,
  comebackReversalEventId,
  comebackXpReward,
  familyLocalDateKey,
  inactivityDaysBetween,
  localDateKey,
  type ComebackMissionDefinition,
  type ComebackRewardTable,
  type ComebackState,
  type ComebackTier,
  type ResolveComebackInput,
  type ResolveComebackResult,
} from './types'
