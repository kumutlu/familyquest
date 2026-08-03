import type { GamificationSummaryV1, DailyProgressV1 } from '../domain/gamification/types'
import { GAMIFICATION_CONFIG_V1 } from '../domain/gamification/config'
import { levelProgressForXp } from '../domain/gamification/level'

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
 * XP per level constant — sourced from the canonical gamification config so the
 * UI can never drift from the server-side level formula.
 */
const XP_PER_LEVEL = GAMIFICATION_CONFIG_V1.xpPerLevel

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
 * Progression view model.
 *
 * Unlike {@link GamificationSummaryView} this view is *always* complete: when the
 * server-side gamification projection is missing, dirty or still rebuilding we
 * derive the progression from the member's authoritative `lifetimeXP` balance
 * (the same value the XP awards are written to in `users/{id}`), so the profile
 * never renders an empty progression block.
 */
export interface ProgressionView {
  readonly level: number
  readonly xpTotal: number
  readonly lifetimeXp: number
  readonly xpProgressInLevel: number
  readonly xpToNextLevel: number
  readonly percentage: number
  readonly source: 'projection' | 'derived'
}

/**
 * Resolves the progression to display for a member.
 *
 * @param summary  Gamification projection document (may be null/dirty/rebuilding).
 * @param member   Member record providing the `lifetimeXP` fallback.
 */
export function resolveProgression(
  summary: GamificationSummaryV1 | null | undefined,
  member: { lifetimeXP?: number | null } | null | undefined,
): ProgressionView {
  const projectionUsable =
    !!summary && !summary.rebuildRequired && summary.projectionStatus !== 'rebuilding'

  const rawXp = projectionUsable ? Number(summary!.xpTotal) : Number(member?.lifetimeXP)
  // `levelProgressForXp` (the canonical formula) requires a non-negative safe
  // integer, so normalise defensively before delegating to it.
  const xpTotal = Number.isFinite(rawXp) ? Math.max(0, Math.floor(rawXp)) : 0

  // Single source of truth: the same helper the engine and the Cloud Functions
  // projection use (`levelForXp` / `levelProgressForXp` with the config's
  // `xpPerLevel`). No independent formula lives here.
  const progress = levelProgressForXp(xpTotal, XP_PER_LEVEL)

  return {
    level: projectionUsable ? summary!.level : progress.level,
    xpTotal,
    lifetimeXp: xpTotal,
    xpProgressInLevel: progress.xpIntoLevel,
    xpToNextLevel: progress.xpToNextLevel,
    percentage: progress.percentage,
    source: projectionUsable ? 'projection' : 'derived',
  }
}

/**
 * Computes the level from XP total.
 * Thin wrapper over the canonical {@link levelProgressForXp} helper.
 */
export function levelFromXp(xpTotal: number): number {
  return levelProgressForXp(xpTotal, XP_PER_LEVEL).level
}

/**
 * Computes XP progress within current level (0 to XP_PER_LEVEL - 1).
 */
export function xpProgressInLevel(xpTotal: number): number {
  return xpTotal % XP_PER_LEVEL
}