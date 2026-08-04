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
  /**
   * True when a projection document is present but dirty/rebuilding. The card
   * may show a quiet "updating" indicator, but the projection's own values are
   * still displayed (never replaced by the legacy `users.lifetimeXP` mirror).
   * Optional so callers/tests that build the view literally need not set it;
   * `adaptGamificationSummary` always populates it.
   */
  readonly isUpdating?: boolean
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
  member?: { lifetimeXP?: number | null } | null,
): GamificationSummaryView {
  // Priority 1 & 2: a projection document that is present with valid numeric
  // fields is authoritative — even when dirty or still rebuilding. We display
  // its own xpTotal/level/progress and (optionally) flag it as updating, but we
  // never replace its values with the legacy `users.lifetimeXP` mirror.
  const summaryPresent =
    !!summary &&
    Number.isFinite(Number(summary.xpTotal)) &&
    Number.isFinite(Number(summary.level))

  if (summaryPresent) {
    const xpTotal = Math.max(0, Math.floor(Number(summary!.xpTotal)))
    const level = Math.max(1, Math.floor(Number(summary!.level)))
    const xpProgressInLevel = xpTotal % XP_PER_LEVEL
    const xpToNextLevel = XP_PER_LEVEL - xpProgressInLevel
    const isUpdating =
      !!summary!.rebuildRequired || summary!.projectionStatus === 'rebuilding'
    return {
      xpTotal,
      level,
      xpToNextLevel,
      xpProgressInLevel,
      currentStreak: nonNegativeInteger(summary!.currentStreak),
      bestStreak: nonNegativeInteger(summary!.bestStreak),
      perfectDayCount: nonNegativeInteger(summary!.perfectDayCount),
      todayProgress: todayProgress?.progressPercentage ?? null,
      todayGoalReached: todayProgress?.dailyGoalReached ?? null,
      todayPerfectDay: todayProgress?.perfectDayReached ?? null,
      isAvailable: true,
      isUpdating,
    }
  }

  // Priority 3: projection genuinely absent -> temporary `users.lifetimeXP`
  // compatibility fallback (legacy mirror). Only used when there is no
  // projection document at all AND a finite lifetimeXP is available.
  const rawXp = Number(member?.lifetimeXP)
  const hasFallback = member !== undefined && member !== null && Number.isFinite(rawXp)
  if (hasFallback) {
    const xpTotal = Math.max(0, Math.floor(rawXp))
    const progress = levelProgressForXp(xpTotal, XP_PER_LEVEL)
    return {
      xpTotal,
      level: progress.level,
      xpToNextLevel: progress.xpToNextLevel,
      xpProgressInLevel: progress.xpIntoLevel,
      currentStreak: 0,
      bestStreak: 0,
      perfectDayCount: 0,
      todayProgress: todayProgress?.progressPercentage ?? null,
      todayGoalReached: todayProgress?.dailyGoalReached ?? null,
      todayPerfectDay: todayProgress?.perfectDayReached ?? null,
      isAvailable: true,
      isUpdating: false,
    }
  }

  // Priority 4: neither source available -> render unavailable/updating.
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
    isUpdating: false,
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
 * TODO(gamification-legacy-fallback): the `member.lifetimeXP` fallback below is a
 * temporary safety net. Operational removal condition: every production family
 * member has a ready (non-rebuilding, non-rebuildRequired) document at
 * `families/{familyId}/gamification_summaries/{memberId}` — verified by a full
 * production projection audit — after which this parameter and the `derived`
 * source branch must be deleted and callers switched to projection-only reads.
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
 * Resolved streak view.
 *
 * There is exactly ONE streak source per member, and it feeds both the streak
 * display and streak-based achievement evaluation. A *ready* projection always
 * wins — including when it legitimately reports 0 — so a badge can never be
 * unlocked from a stale legacy `longestStreak` while the card shows 0.
 * The legacy member counters are only consulted when no usable projection
 * exists (missing, rebuilding or dirty).
 */
export interface StreakView {
  readonly currentStreak: number
  readonly bestStreak: number
  readonly source: 'projection' | 'legacy'
}

function nonNegativeInteger(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0
}

export function resolveStreaks(
  summary: GamificationSummaryV1 | null | undefined,
  member: { currentStreak?: number | null; longestStreak?: number | null } | null | undefined,
): StreakView {
  const projectionUsable =
    !!summary && !summary.rebuildRequired && summary.projectionStatus !== 'rebuilding'

  if (projectionUsable) {
    return {
      currentStreak: nonNegativeInteger(summary!.currentStreak),
      bestStreak: nonNegativeInteger(summary!.bestStreak),
      source: 'projection',
    }
  }
  return {
    currentStreak: nonNegativeInteger(member?.currentStreak),
    bestStreak: nonNegativeInteger(member?.longestStreak),
    source: 'legacy',
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