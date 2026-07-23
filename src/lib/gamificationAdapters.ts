import type { GamificationSummaryV1, DailyProgressV1 } from '../domain/gamification/types'

/**
 * View model for gamification summary display.
 * Combines summary data with current day's progress for UI consumption.
 */
export interface GamificationSummaryView {
  readonly xpTotal: number
  readonly level: number
  readonly xpToNextLevel: number
  readonly xpProgressInLevel: number
  readonly currentStreak: number
  readonly bestStreak: number
  readonly perfectDayCount: number
  readonly todayProgress: number | null
  readonly todayGoalReached: boolean | null
  readonly todayPerfectDay: boolean | null
  readonly isAvailable: boolean
}

/**
 * XP per level constant (from GAMIFICATION_CONFIG_V1)
 */
const XP_PER_LEVEL = 1000

/**
 * Adapts a GamificationSummaryV1 and optional DailyProgressV1 into a view model
 * for UI consumption.
 *
 * - Returns isAvailable: false if summary is null or rebuildRequired is true
 * - Computes level progress and XP to next level from xpTotal
 * - Merges today's progress if provided
 */
export function adaptGamificationSummary(
  summary: GamificationSummaryV1 | null | undefined,
  todayProgress: DailyProgressV1 | null | undefined,
): GamificationSummaryView {
  // Handle missing or rebuilding summary
  if (!summary || summary.rebuildRequired || summary.projectionStatus === 'rebuilding') {
    return {
      xpTotal: 0,
      level: 1,
      xpToNextLevel: XP_PER_LEVEL,
      xpProgressInLevel: 0,
      currentStreak: 0,
      bestStreak: 0,
      perfectDayCount: 0,
      todayProgress: null,
      todayGoalReached: null,
      todayPerfectDay: null,
      isAvailable: false,
    }
  }

  // Compute level progress
  const xpProgressInLevel = summary.xpTotal % XP_PER_LEVEL
  const xpToNextLevel = XP_PER_LEVEL - xpProgressInLevel

  return {
    xpTotal: summary.xpTotal,
    level: summary.level,
    xpToNextLevel,
    xpProgressInLevel,
    currentStreak: summary.currentStreak,
    bestStreak: summary.bestStreak,
    perfectDayCount: summary.perfectDayCount,
    todayProgress: todayProgress?.progressPercentage ?? null,
    todayGoalReached: todayProgress?.dailyGoalReached ?? null,
    todayPerfectDay: todayProgress?.perfectDayReached ?? null,
    isAvailable: true,
  }
}

/**
 * Computes the level from XP total.
 * Level = floor(xpTotal / XP_PER_LEVEL) + 1
 */
export function levelFromXp(xpTotal: number): number {
  return Math.floor(xpTotal / XP_PER_LEVEL) + 1
}

/**
 * Computes XP progress within current level (0 to XP_PER_LEVEL - 1).
 */
export function xpProgressInLevel(xpTotal: number): number {
  return xpTotal % XP_PER_LEVEL
}