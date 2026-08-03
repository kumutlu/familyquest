import { GAMIFICATION_V3_SCHEMA_VERSION } from './event'

/**
 * Canonical Gamification V3 projection.
 *
 * Field groups are deliberate and must not be blurred:
 *
 *  1. Identity            — memberId, familyId
 *  2. Ledger-derived      — rewardPoints, xpTotal, weeklyPoints, currentStreak,
 *                           bestStreak, lastQualifiedDayKey, unlockedAvatarIds
 *  3. Deterministic derived — level, xpProgressInLevel, xpToNextLevel,
 *                           levelProgressPercentage, weeklyWindowKey
 *  4. Metadata            — projectionVersion, foldedThroughEventId, updatedAt
 *
 * There is exactly one authoritative lifetime XP field: `xpTotal`.
 * `lifetimeXP` is deliberately absent — it is a legacy alias, not a second value.
 */
export interface GamificationStateV3 {
  // -- identity ------------------------------------------------------------
  readonly memberId: string
  readonly familyId: string

  // -- ledger-derived ------------------------------------------------------
  /** Spendable balance. Never negative. */
  readonly rewardPoints: number
  /** Sole authoritative lifetime progression total. */
  readonly xpTotal: number
  /** Earnings inside `weeklyWindowKey` only. */
  readonly weeklyPoints: number
  readonly currentStreak: number
  readonly bestStreak: number
  readonly lastQualifiedDayKey: string | null
  readonly unlockedAvatarIds: readonly string[]

  // -- deterministic derived ----------------------------------------------
  readonly weeklyWindowKey: string
  readonly level: number
  readonly xpProgressInLevel: number
  readonly xpToNextLevel: number
  readonly levelProgressPercentage: number

  // -- metadata ------------------------------------------------------------
  readonly projectionVersion: number
  readonly foldedThroughEventId: string | null
  readonly updatedAt: string
}

export const STATE_V3_FIELDS = [
  'memberId',
  'familyId',
  'rewardPoints',
  'xpTotal',
  'weeklyPoints',
  'currentStreak',
  'bestStreak',
  'lastQualifiedDayKey',
  'unlockedAvatarIds',
  'weeklyWindowKey',
  'level',
  'xpProgressInLevel',
  'xpToNextLevel',
  'levelProgressPercentage',
  'projectionVersion',
  'foldedThroughEventId',
  'updatedAt',
] as const

/** Business fields compared for rebuild equality (metadata excluded). */
export const STATE_V3_BUSINESS_FIELDS = [
  'rewardPoints',
  'xpTotal',
  'weeklyPoints',
  'weeklyWindowKey',
  'level',
  'xpProgressInLevel',
  'xpToNextLevel',
  'levelProgressPercentage',
  'currentStreak',
  'bestStreak',
  'lastQualifiedDayKey',
  'unlockedAvatarIds',
] as const

export const PROJECTION_VERSION_V3 = GAMIFICATION_V3_SCHEMA_VERSION
