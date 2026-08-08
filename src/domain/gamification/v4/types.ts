/**
 * Gamification V4 — authoritative type contracts (Task 1.1).
 *
 * Pure domain module: no Firestore, no Cloud Functions, no clock access.
 * Every ledger fact in V4 is one immutable event; every projection is one
 * derived state. See docs/gamification-v4-design.md §2.1–§2.4.
 */

export const GAMIFICATION_V4_SCHEMA_VERSION = 4 as const

export const GAMIFICATION_V4_EVENT_TYPES = [
  'TASK_APPROVED',
  'TASK_REVERSED',
  'BEHAVIOUR_POSITIVE',
  'BEHAVIOUR_NEGATIVE',
  'DAILY_GOAL_AWARDED',
  'PERFECT_DAY_AWARDED',
  'REWARD_REDEEMED',
  'REWARD_REFUNDED',
  'AVATAR_UNLOCKED',
  'MANUAL_ADJUSTMENT',
  'MIGRATION_BASELINE',
] as const

export type GamificationEventTypeV4 = (typeof GAMIFICATION_V4_EVENT_TYPES)[number]

/** Known source domains for a V4 event (design §2.1). */
export const SOURCE_TYPE = {
  TASK_COMPLETION: 'task_completion',
  BEHAVIOUR: 'behaviour',
  REWARD_REDEMPTION: 'reward_redemption',
  REVERSAL: 'reversal',
  DAILY_GOAL: 'daily_goal',
  PERFECT_DAY: 'perfect_day',
  AVATAR: 'avatar',
  MANUAL: 'manual',
} as const

export type SourceTypeV4 = (typeof SOURCE_TYPE)[keyof typeof SOURCE_TYPE]

/** Field name carrying the "fallback reward selection used" flag (design §2.1). */
export const ESTIMATED_FLAG = 'estimated' as const

export type EventMetadataV4 = Readonly<Record<string, unknown>>

/** Authoritative V4 projection (design §2.4). */
export interface GamificationStateV4 {
  // -- ledger-derived ------------------------------------------------------
  /** Spendable balance. Never negative. */
  readonly rewardPoints: number
  /** Sole authoritative lifetime progression total. */
  readonly xpTotal: number
  /** Derived exclusively from xpTotal via canonical levelForXp(). */
  readonly level: number
  readonly xpProgressInLevel: number
  readonly xpToNextLevel: number
  readonly levelProgressPercentage: number
  readonly currentStreak: number
  readonly bestStreak: number
  readonly lastQualifiedDayKey: string | null
  readonly unlockedAchievementIds: readonly string[]
  readonly unlockedAvatarIds: readonly string[]

  // -- metadata ------------------------------------------------------------
  readonly projectionVersion: number
  readonly foldedThroughEventId: string | null
  readonly updatedAt: string
}

/** Authoritative business fields compared for rebuild equality (design §2.4). */
export type BusinessFieldsV4 = Pick<
  GamificationStateV4,
  | 'rewardPoints'
  | 'xpTotal'
  | 'level'
  | 'xpProgressInLevel'
  | 'xpToNextLevel'
  | 'levelProgressPercentage'
  | 'currentStreak'
  | 'bestStreak'
  | 'lastQualifiedDayKey'
  | 'unlockedAchievementIds'
  | 'unlockedAvatarIds'
>

/** Ordered list of business field names (design §2.4, no metadata). */
export const BUSINESS_FIELD_NAMES_V4: readonly (keyof BusinessFieldsV4)[] = [
  'rewardPoints',
  'xpTotal',
  'level',
  'xpProgressInLevel',
  'xpToNextLevel',
  'levelProgressPercentage',
  'currentStreak',
  'bestStreak',
  'lastQualifiedDayKey',
  'unlockedAchievementIds',
  'unlockedAvatarIds',
]

/**
 * Return only the authoritative business fields of a V4 state. Metadata
 * (projectionVersion, foldedThroughEventId, updatedAt) is excluded so that two
 * states with identical business fields are byte-identical for rebuild
 * equality.
 */
export function businessFields(state: GamificationStateV4): BusinessFieldsV4 {
  return {
    rewardPoints: state.rewardPoints,
    xpTotal: state.xpTotal,
    level: state.level,
    xpProgressInLevel: state.xpProgressInLevel,
    xpToNextLevel: state.xpToNextLevel,
    levelProgressPercentage: state.levelProgressPercentage,
    currentStreak: state.currentStreak,
    bestStreak: state.bestStreak,
    lastQualifiedDayKey: state.lastQualifiedDayKey,
    unlockedAchievementIds: state.unlockedAchievementIds,
    unlockedAvatarIds: state.unlockedAvatarIds,
  }
}
