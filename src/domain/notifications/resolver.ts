/**
 * Smart Notifications V1 — PURE deterministic decision resolver.
 *
 * Architectural law:
 *   - The resolver decides WHETHER to send. Delivery is a separate
 *     concern (`delivery.ts`). The resolver never imports Firebase,
 *     push APIs, or `Date.now()`.
 *   - The resolver consumes already-normalized Engagement context
 *     (Surge read-only view, Daily Engagement, weather). It does NOT
 *     award value.
 *   - One evaluation cycle returns at most ONE selected notification.
 *   - Priority is pinned by spec §6.
 *
 * Tests in `resolver.test.ts` pin every decision branch the spec calls
 * out in §29.
 */

import { intensityToMaxPerDay } from './preferences'
import {
  buildDedupeKey,
  isInQuietHours,
  localDateKey,
  localTimeOfDay,
  MORNING_WINDOW,
  type EvaluationSlot,
  type NotificationDailyContext,
  type NotificationDecision,
  type NotificationDecisionContext,
  type NotificationType,
} from './types'

export type { NotificationDecisionContext } from './types'

/** Decision priority (lower wins per spec §6). The first viable
 *  candidate with the lowest priority number is selected. */
const PRIORITY = Object.freeze({
  surge: 10,
  streak: 20,
  family_progress: 30,
  seasonal: 40,
  morning_brief: 50,
  quest_reminder: 60,
} as const)

export type NotificationSlot = EvaluationSlot

/** The slot the resolver was evaluated in. Required to build dedupe
 *  keys for slot-bound types (seasonal, quest_reminder). The caller
 *  passes this from the deterministic scheduler. */
export interface ResolveOptions {
  readonly slot: NotificationSlot
  /** Family id for family-scoped dedupe keys (family_progress,
   *  seasonal). The Decision Engine never reads this from Firestore;
   *  it is injected. */
  readonly familyId: string
}

export interface ResolvedDecision extends NotificationDecision {
  /** Convenience: the candidate list, in priority order, so callers
   *  can debug WHY a higher-priority candidate was suppressed. NOT
   *  used by delivery; purely informational. */
  readonly candidatesConsidered?: readonly NotificationType[]
}

interface Candidate {
  readonly type: NotificationType
  readonly priority: number
  readonly dedupeKey: string
  readonly messageKey: string
  readonly variables: Readonly<Record<string, string | number>>
  readonly preferenceEnabled: boolean
  readonly blockedBy?: 'no_useful_content' | 'preference_disabled'
}

function inMorningWindow(now: number, timezone: string): boolean {
  const t = localTimeOfDay(now, timezone)
  const minutes = t.hour * 60 + t.minute
  const start = MORNING_WINDOW.startHour * 60 + MORNING_WINDOW.startMinute
  const end = MORNING_WINDOW.endHour * 60 + MORNING_WINDOW.endMinute
  // Inclusive start, exclusive end.
  return minutes >= start && minutes < end
}

function makeSurgeCandidate(ctx: NotificationDecisionContext, localDate: string): Candidate | null {
  const surge = ctx.dailyContext.activeSurge
  if (!surge) return null
  if (ctx.familyPreferences.surgeAlerts !== true) {
    return null
  }
  // Time-sensitive only when there's actual bonus value & still time.
  const remaining = Math.max(0, surge.endsAt - ctx.now)
  const minutesRemaining = Math.ceil(remaining / 60_000)
  if (remaining <= 0) return null
  return {
    type: 'surge',
    priority: PRIORITY.surge,
    preferenceEnabled: ctx.familyPreferences.surgeAlerts === true,
    dedupeKey: buildDedupeKey({
      type: 'surge',
      childId: ctx.child.id,
      surgeId: surge.surgeId,
      familyId: '',
      slot: 'midday',
      localDate,
    }),
    messageKey: 'surge.alert',
    variables: {
      taskTitle: surge.taskTitle ?? 'a task',
      bonusPoints: surge.bonusPoints ?? 0,
      minutesRemaining,
    },
  }
}

function makeStreakCandidate(ctx: NotificationDecisionContext, localDate: string, slot: NotificationSlot): Candidate | null {
  if (ctx.dailyContext.streakAtRisk !== true) return null
  if (ctx.familyPreferences.streakAlerts !== true) return null
  if (ctx.dailyContext.currentStreak === undefined) return null
  return {
    type: 'streak',
    priority: PRIORITY.streak,
    preferenceEnabled: true,
    dedupeKey: buildDedupeKey({
      type: 'streak',
      childId: ctx.child.id,
      familyId: '',
      slot,
      localDate,
    }),
    messageKey: 'streak.protect',
    variables: { streak: ctx.dailyContext.currentStreak },
  }
}

function makeFamilyProgressCandidate(
  ctx: NotificationDecisionContext,
  localDate: string,
  slot: NotificationSlot,
  familyId: string,
): Candidate | null {
  const fp = ctx.dailyContext.familyProgress
  if (!fp) return null
  if (fp.target <= 0) return null
  if (ctx.familyPreferences.familyProgress !== true) return null
  if (fp.childCouldComplete !== true) return null
  const pct = Math.min(100, Math.round((fp.current / fp.target) * 100))
  // Bucket to nearest 10% so a family in the 71–79% range gets ONE
  // notification per day, not one per percentage point.
  const bucket = Math.floor(pct / 10) * 10
  return {
    type: 'family_progress',
    priority: PRIORITY.family_progress,
    preferenceEnabled: true,
    dedupeKey: buildDedupeKey({
      type: 'family_progress',
      childId: ctx.child.id,
      familyId,
      milestoneBucket: bucket,
      slot,
      localDate,
    }),
    messageKey: 'familyProgress.nearComplete',
    variables: { percent: pct },
  }
}

function makeSeasonalCandidate(
  ctx: NotificationDecisionContext,
  localDate: string,
  slot: NotificationSlot,
  familyId: string,
): Candidate | null {
  if (!ctx.dailyContext.activeSeason) return null
  if (ctx.familyPreferences.seasonalEvents !== true) return null
  return {
    type: 'seasonal',
    priority: PRIORITY.seasonal,
    preferenceEnabled: true,
    dedupeKey: buildDedupeKey({
      type: 'seasonal',
      childId: ctx.child.id,
      familyId,
      slot,
      localDate,
    }),
    messageKey: 'seasonal.newDiscovery',
    variables: { name: ctx.dailyContext.activeSeason.name },
  }
}

function makeMorningBriefCandidate(
  ctx: NotificationDecisionContext,
  localDate: string,
): Candidate | null {
  if (ctx.familyPreferences.morningBrief !== true) return null
  if (!inMorningWindow(ctx.now, ctx.timezone)) return null
  // Useful content = at least one of weather / quests remaining / streak
  // / season.
  const hasWeather = ctx.weather !== undefined
  const hasQuests = ctx.dailyContext.questsRemaining > 0
  const hasStreak = (ctx.dailyContext.currentStreak ?? 0) > 0
  const hasSeason = ctx.dailyContext.activeSeason !== undefined
  if (!hasWeather && !hasQuests && !hasStreak && !hasSeason) {
    return null
  }
  return {
    type: 'morning_brief',
    priority: PRIORITY.morning_brief,
    preferenceEnabled: true,
    dedupeKey: buildDedupeKey({
      type: 'morning_brief',
      childId: ctx.child.id,
      familyId: '',
      slot: 'morning',
      localDate,
    }),
    messageKey: 'morningBrief.greet',
    variables: {
      name: ctx.child.displayName ?? '',
      questsRemaining: ctx.dailyContext.questsRemaining,
    },
  }
}

function makeQuestReminderCandidate(
  ctx: NotificationDecisionContext,
  localDate: string,
  slot: NotificationSlot,
): Candidate | null {
  if (ctx.familyPreferences.questReminders !== true) return null
  if (ctx.dailyContext.questsRemaining <= 0) return null
  return {
    type: 'quest_reminder',
    priority: PRIORITY.quest_reminder,
    preferenceEnabled: true,
    dedupeKey: buildDedupeKey({
      type: 'quest_reminder',
      childId: ctx.child.id,
      familyId: '',
      slot,
      localDate,
    }),
    messageKey: 'questReminder.waiting',
    variables: {
      name: ctx.child.displayName ?? '',
      questsRemaining: ctx.dailyContext.questsRemaining,
    },
  }
}

/** Public entry point. PURE. No I/O. */
export function resolveNotificationDecision(
  ctx: NotificationDecisionContext,
  options: ResolveOptions,
): ResolvedDecision {
  // Defensive: bad inputs collapse to a safe "no send".
  if (!ctx || typeof ctx.now !== 'number' || !Number.isFinite(ctx.now)) {
    return { shouldSend: false, reason: 'no_useful_content' }
  }

  const prefs = ctx.familyPreferences

  // Hard kill-switches in priority order:
  if (prefs.enabled !== true) {
    return { shouldSend: false, reason: 'disabled' }
  }
  if (prefs.intensity === 'off' || intensityToMaxPerDay(prefs.intensity) === 0) {
    return { shouldSend: false, reason: 'disabled' }
  }
  const maxPerDay = intensityToMaxPerDay(prefs.intensity)
  if (ctx.deliveryState.sentToday >= maxPerDay) {
    return { shouldSend: false, reason: 'daily_cap' }
  }
  if (isInQuietHours(ctx.now, ctx.timezone, prefs.quietHours)) {
    return { shouldSend: false, reason: 'quiet_hours' }
  }

  const localDate = localDateKey(ctx.now, ctx.timezone)
  const sentKeys = new Set(ctx.deliveryState.sentKeysToday)

  // Build candidates in priority order.
  const ordered: NotificationType[] = ['surge', 'streak', 'family_progress', 'seasonal', 'morning_brief', 'quest_reminder']
  const candidates: Candidate[] = []
  for (const t of ordered) {
    let c: Candidate | null = null
    if (t === 'surge') c = makeSurgeCandidate(ctx, localDate)
    else if (t === 'streak') c = makeStreakCandidate(ctx, localDate, options.slot)
    else if (t === 'family_progress') c = makeFamilyProgressCandidate(ctx, localDate, options.slot, options.familyId)
    else if (t === 'seasonal') c = makeSeasonalCandidate(ctx, localDate, options.slot, options.familyId)
    else if (t === 'morning_brief') c = makeMorningBriefCandidate(ctx, localDate)
    else if (t === 'quest_reminder') c = makeQuestReminderCandidate(ctx, localDate, options.slot)
    if (c) candidates.push(c)
  }

  if (candidates.length === 0) {
    return { shouldSend: false, reason: 'no_useful_content', candidatesConsidered: ordered }
  }

  // Select the lowest-priority-number candidate.
  candidates.sort((a, b) => a.priority - b.priority)
  const chosen = candidates[0]

  if (sentKeys.has(chosen.dedupeKey)) {
    return { shouldSend: false, reason: 'duplicate', candidatesConsidered: ordered }
  }

  return {
    shouldSend: true,
    type: chosen.type,
    priority: chosen.priority,
    dedupeKey: chosen.dedupeKey,
    messageKey: chosen.messageKey,
    variables: chosen.variables,
    reason: 'selected',
    candidatesConsidered: ordered,
  }
}

/** Convenience: a single candidate's `useful content` predicate for
 *  debugging. Exported so the catalog and tests can share it. */
export function hasUsefulDailyContent(dailyContext: NotificationDailyContext): boolean {
  return (
    dailyContext.questsRemaining > 0 ||
    dailyContext.questsCompletedToday > 0 ||
    (dailyContext.currentStreak ?? 0) > 0 ||
    dailyContext.activeSurge !== undefined ||
    dailyContext.familyProgress !== undefined ||
    dailyContext.activeSeason !== undefined
  )
}