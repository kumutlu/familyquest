import { type GamificationEventV3 } from './event'
import { reduceGamificationEventsV3, type ReducerContextV3 } from './reducer'
import { type GamificationStateV3 } from './state'

/**
 * Read-only shadow comparison.
 *
 * Pure function: it accepts already-read snapshots and never performs or
 * schedules a write of any kind.
 */
export type ShadowClassification =
  | 'exact_match'
  | 'reward_points_mismatch'
  | 'xp_mismatch'
  | 'weekly_points_mismatch'
  | 'streak_mismatch'
  | 'insufficient_ledger_history'
  | 'malformed_data'

export interface LegacyProjectionSnapshot {
  readonly familyId: string
  readonly memberId: string
  readonly rewardPoints: number
  readonly xpTotal: number
  readonly weeklyPoints: number
  readonly currentStreak: number
}

export interface ShadowComparisonInput {
  readonly legacy: LegacyProjectionSnapshot
  readonly events: readonly GamificationEventV3[]
  /**
   * True only when the caller can prove the ledger contains every historical
   * fact for this member (for example a LEGACY_BASELINE event is present).
   */
  readonly ledgerComplete: boolean
}

export interface ShadowDifference {
  readonly field: string
  readonly legacy: number
  readonly projected: number
}

export interface ShadowComparisonResult {
  readonly familyId: string
  readonly memberId: string
  readonly classification: ShadowClassification
  readonly differences: readonly ShadowDifference[]
  readonly projected: GamificationStateV3 | null
  readonly error: string | null
}

/** Classification precedence when several metrics drift at once. */
const PRECEDENCE: readonly {
  readonly field: keyof LegacyProjectionSnapshot & keyof GamificationStateV3
  readonly classification: ShadowClassification
}[] = [
  { field: 'rewardPoints', classification: 'reward_points_mismatch' },
  { field: 'xpTotal', classification: 'xp_mismatch' },
  { field: 'weeklyPoints', classification: 'weekly_points_mismatch' },
  { field: 'currentStreak', classification: 'streak_mismatch' },
]

export function compareMemberShadow(
  input: ShadowComparisonInput,
  context: ReducerContextV3,
): ShadowComparisonResult {
  const { legacy, events, ledgerComplete } = input

  let projected: GamificationStateV3
  try {
    projected = reduceGamificationEventsV3(events, {
      ...context,
      familyId: legacy.familyId,
      memberId: legacy.memberId,
    })
  } catch (error) {
    return {
      familyId: legacy.familyId,
      memberId: legacy.memberId,
      classification: 'malformed_data',
      differences: [],
      projected: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  if (!ledgerComplete) {
    // An incomplete ledger can never prove a mismatch.
    return {
      familyId: legacy.familyId,
      memberId: legacy.memberId,
      classification: 'insufficient_ledger_history',
      differences: [],
      projected,
      error: null,
    }
  }

  const differences: ShadowDifference[] = []
  for (const { field } of PRECEDENCE) {
    if (legacy[field] !== projected[field]) {
      differences.push({
        field,
        legacy: legacy[field] as number,
        projected: projected[field] as number,
      })
    }
  }

  const firstDrift = PRECEDENCE.find((entry) => differences.some((diff) => diff.field === entry.field))

  return {
    familyId: legacy.familyId,
    memberId: legacy.memberId,
    classification: firstDrift?.classification ?? 'exact_match',
    differences,
    projected,
    error: null,
  }
}
