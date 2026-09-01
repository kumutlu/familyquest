/**
 * Smart Notifications V1 — type contracts.
 *
 * Pure types. No Firestore, no React, no Date.now() inside the resolver.
 *
 * Notifications are PRESENTATION only. They must NEVER:
 *   - award XP
 *   - award points
 *   - create completion records
 *   - alter streaks
 *   - mutate Surge eligibility
 *   - bypass task approval
 *   - create gamification events
 */

import type { NotificationPreferences } from './preferences'

export type NotificationType =
  | 'morning_brief'
  | 'surge'
  | 'streak'
  | 'family_progress'
  | 'seasonal'
  | 'quest_reminder'
  | 'mystery_drop'
  | 'comeback'

export type NotificationReason =
  | 'selected'
  | 'disabled'
  | 'quiet_hours'
  | 'daily_cap'
  | 'duplicate'
  | 'no_useful_content'
  | 'preference_disabled'

export type WeatherCondition =
  | 'clear'
  | 'cloudy'
  | 'rain'
  | 'snow'
  | 'storm'
  | 'fog'
  | 'wind'
  | 'mixed'

export type WeatherAdvisory = 'umbrella' | 'coat' | 'hot_weather' | 'icy'

export interface WeatherContext {
  readonly condition: WeatherCondition
  readonly minC?: number
  readonly maxC?: number
  readonly precipitationChance?: number
  readonly advisory?: WeatherAdvisory
}

export interface WeatherLocation {
  readonly countryCode: string
  readonly postalArea?: string
  readonly city?: string
  readonly timezone: string
}

/** Already-normalized, read-only Surge window passed in by the
 *  Engagement layer (server-derived). Notifications never determine
 *  Surge award authority. */
export interface ActiveSurgeContext {
  readonly surgeId: string
  readonly taskId?: string
  readonly taskTitle?: string
  readonly bonusPoints?: number
  readonly endsAt: number
}

export interface FamilyProgressContext {
  readonly current: number
  readonly target: number
  /** True when a single quest from this child could complete today's
   *  family goal. */
  readonly childCouldComplete?: boolean
}

export interface ActiveSeasonContext {
  readonly eventId: string
  readonly name: string
}

/** Mystery Drop availability — read-only view surfaced to notifications. */
export interface ActiveMysteryDropContext {
  readonly dropId: string
  readonly rarity?: 'common' | 'rare' | 'epic'
  readonly unlockReady: boolean
  readonly endsAt: number
}

/** Comeback Mission availability — read-only view surfaced to notifications. */
export interface ActiveComebackContext {
  readonly tier: 'return_1d' | 'return_3d' | 'return_7d'
  readonly missionAvailable: boolean
}

export interface NotificationDeliveryState {
  readonly sentToday: number
  readonly sentKeysToday: readonly string[]
  readonly lastSentAt?: number
}

export interface NotificationDailyContext {
  readonly questsRemaining: number
  readonly questsCompletedToday: number
  readonly currentStreak?: number
  readonly streakAtRisk?: boolean
  readonly activeSurge?: ActiveSurgeContext
  readonly familyProgress?: FamilyProgressContext
  readonly activeSeason?: ActiveSeasonContext
  readonly activeMysteryDrop?: ActiveMysteryDropContext
  readonly activeComeback?: ActiveComebackContext
}

export interface NotificationDecisionContext {
  readonly now: number
  readonly timezone: string
  readonly child: { readonly id: string; readonly displayName?: string }
  readonly familyPreferences: NotificationPreferences
  readonly deliveryState: NotificationDeliveryState
  readonly dailyContext: NotificationDailyContext
  readonly weather?: WeatherContext
}

export interface NotificationDecision {
  readonly shouldSend: boolean
  readonly type?: NotificationType
  readonly priority?: number
  readonly dedupeKey?: string
  readonly messageKey?: string
  readonly variables?: Readonly<Record<string, string | number>>
  readonly reason: NotificationReason
}

/** Morning brief window in family-local time. 07:00 inclusive,
 *  10:30 exclusive. Pinned by tests. */
export const MORNING_WINDOW = Object.freeze({
  startHour: 7,
  startMinute: 0,
  endHour: 10,
  endMinute: 30,
})

/** Evaluation slot windows (local). The scheduler uses these to pick
 *  deterministic evaluation times. */
export const EVALUATION_SLOTS = Object.freeze([
  { name: 'morning', startHour: 7, startMinute: 0, endHour: 10, endMinute: 30 },
  { name: 'midday', startHour: 12, startMinute: 0, endHour: 17, endMinute: 0 },
  { name: 'evening', startHour: 17, startMinute: 0, endHour: 20, endMinute: 30 },
] as const)

export type EvaluationSlot = (typeof EVALUATION_SLOTS)[number]['name']

/** Translate epoch ms → family-local date key (yyyy-mm-dd). The
 *  resolver uses this for dedupe scoping. */
export function localDateKey(now: number, timezone: string): string {
  const parts = formatInTimezone(now, timezone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  // formatToParts output is locale-dependent; normalise to yyyy-mm-dd.
  const y = parts.find(p => p.type === 'year')?.value ?? '1970'
  const m = parts.find(p => p.type === 'month')?.value ?? '01'
  const d = parts.find(p => p.type === 'day')?.value ?? '01'
  return `${y}-${m}-${d}`
}

/** Translate epoch ms → HH:mm in family-local time. */
export function localTimeOfDay(now: number, timezone: string): { hour: number; minute: number } {
  const parts = formatInTimezone(now, timezone, { hour: '2-digit', minute: '2-digit', hour12: false })
  const h = Number.parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10)
  const m = Number.parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10)
  return { hour: Number.isFinite(h) ? h : 0, minute: Number.isFinite(m) ? m : 0 }
}

interface IntlLikePart { type: string; value: string }

function formatInTimezone(
  now: number,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
): readonly IntlLikePart[] {
  try {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: timezone }).formatToParts(new Date(now))
  } catch {
    // Fall back to UTC if the timezone string is invalid.
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).formatToParts(new Date(now))
  }
}

/** Build deterministic dedupe keys per spec §18. */
export function buildDedupeKey(args: {
  type: NotificationType
  childId: string
  surgeId?: string
  familyId: string
  milestoneBucket?: number
  slot: EvaluationSlot
  localDate: string
}): string {
  switch (args.type) {
    case 'morning_brief':
      return `morning_brief:${args.childId}:${args.localDate}`
    case 'surge':
      return `surge:${args.surgeId ?? 'unknown'}:${args.childId}`
    case 'streak':
      return `streak-risk:${args.childId}:${args.localDate}`
    case 'family_progress':
      return `family-progress:${args.familyId}:${args.milestoneBucket ?? 0}:${args.localDate}`
    case 'seasonal':
      return `seasonal:${args.familyId}:${args.localDate}:${args.slot}`
    case 'quest_reminder':
      return `quest-reminder:${args.childId}:${args.localDate}:${args.slot}`
    case 'mystery_drop':
      return `mystery-drop:${args.childId}:${args.localDate}`
    case 'comeback':
      return `comeback:${args.childId}:${args.localDate}`
  }
}

/** Parse "HH:mm" → { hour, minute }. */
export function parseHHmm(value: string): { hour: number; minute: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  if (!match) return null
  return { hour: Number.parseInt(match[1], 10), minute: Number.parseInt(match[2], 10) }
}

/** Total minutes of day for a wall-clock {hour, minute}. */
function toMinutes(t: { hour: number; minute: number }): number {
  return t.hour * 60 + t.minute
}

/** Quiet-hour test that handles cross-midnight windows. The boundary
 *  pin: start is INCLUSIVE (20:30 quiet), end is INCLUSIVE (07:00 quiet
 *  is true at 06:59, false at 07:00). We align with the spec:
 *  20:29 allowed, 20:30 suppressed, 06:59 suppressed, 07:00 allowed. */
export function isInQuietHours(now: number, timezone: string, quietHours: { start: string; end: string }): boolean {
  const nowT = localTimeOfDay(now, timezone)
  const startT = parseHHmm(quietHours.start)
  const endT = parseHHmm(quietHours.end)
  if (!startT || !endT) return false
  const nowM = toMinutes(nowT)
  const startM = toMinutes(startT)
  const endM = toMinutes(endT)
  if (startM === endM) return false
  if (startM < endM) {
    // same-day window, e.g. 13:00 → 15:00.
    return nowM >= startM && nowM < endM
  }
  // cross-midnight window, e.g. 20:30 → 07:00.
  // Quiet if nowM in [startM, 1440) ∪ [0, endM).
  // Boundary: start INCLUSIVE (nowM === startM is quiet), end EXCLUSIVE
  // (nowM === endM is NOT quiet — matches 07:00 allowed).
  return nowM >= startM || nowM < endM
}