/**
 * Gamification V4 — streak calculation (Task 1.6).
 *
 * Pure, deterministic projection of `currentStreak`, `bestStreak`, and
 * `lastQualifiedDayKey` from folded `DAILY_GOAL_AWARDED` / `PERFECT_DAY_AWARDED`
 * events. No `users` document fallback, no Firestore, no Cloud Functions, no
 * clock access.
 *
 * Day identity is derived from each event's `effectiveAt` instant using the
 * family IANA timezone. The approved family-timezone convention is that a
 * missing or invalid timezone falls back to `Europe/London`; the browser or
 * local-machine timezone is never read.
 *
 * Invariant: same ledger -> byte-identical streak fields.
 *
 * See docs/gamification-v4-design.md §3.4 and
 * docs/superpowers/plans/2026-08-05-gamification-v4-rewrite.md Task 1.6.
 */

import type { GamificationEventV4 } from './event'
import { ValidationErrorV4 } from './validators'

/** Event types that qualify a day toward the streak (design §3.4). */
const STREAK_QUALIFYING_EVENT_TYPES: ReadonlySet<GamificationEventV4['eventType']> = new Set([
  'DAILY_GOAL_AWARDED',
  'PERFECT_DAY_AWARDED',
])

/** Approved family-timezone fallback (design §3.4 / family timezone convention). */
export const FAMILY_TIMEZONE_FALLBACK_V4 = 'Europe/London' as const

/** Matches a `YYYY-MM-DD` day key with a real calendar date. */
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Returns true iff `dayKey` is a well-formed, real `YYYY-MM-DD` date. */
export function isValidDayKey(dayKey: unknown): dayKey is string {
  if (typeof dayKey !== 'string' || !DAY_KEY_PATTERN.test(dayKey)) return false
  // Reject impossible calendar dates (e.g. 2026-13-45) without a full parser.
  const parsed = Date.parse(`${dayKey}T00:00:00.000Z`)
  return !Number.isNaN(parsed)
}

function assertValidDayKey(dayKey: unknown, label: string): asserts dayKey is string {
  if (!isValidDayKey(dayKey)) {
    throw new ValidationErrorV4(`${label} must be a valid YYYY-MM-DD day key`)
  }
}

function resolveTimezone(timezone: string | undefined): string {
  if (timezone === undefined) return FAMILY_TIMEZONE_FALLBACK_V4
  try {
    // Validate the zone by formatting a known instant; throws on invalid zone.
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric' }).format(0)
    return timezone
  } catch {
    return FAMILY_TIMEZONE_FALLBACK_V4
  }
}

/**
 * Derive the family-local `YYYY-MM-DD` day key from an ISO-8601 UTC instant.
 *
 * The timezone is explicit; when omitted it falls back to the approved family
 * default (`Europe/London`). The browser/local-machine timezone is never used.
 */
export function dayKeyFor(instant: string, timezone?: string): string {
  const resolved = resolveTimezone(timezone)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolved,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant))

  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value
  if (!year || !month || !day) {
    throw new ValidationErrorV4(`could not resolve day parts for instant ${instant}`)
  }
  return `${year}-${month}-${day}`
}

/**
 * Integer number of days from `a` to `b` (b - a). Both must be valid day keys.
 * Deterministic: computed from UTC midnight epoch values.
 */
export function daysBetweenDayKeys(a: string, b: string): number {
  assertValidDayKey(a, 'a')
  assertValidDayKey(b, 'b')
  const msPerDay = 86_400_000
  const epochA = Date.parse(`${a}T00:00:00.000Z`)
  const epochB = Date.parse(`${b}T00:00:00.000Z`)
  return Math.round((epochB - epochA) / msPerDay)
}

export interface StreakResultV4 {
  readonly currentStreak: number
  readonly bestStreak: number
  readonly lastQualifiedDayKey: string | null
}

/**
 * Compute the streak projection from folded qualifying events as of `asOfDayKey`.
 *
 * - `lastQualifiedDayKey` is the most recent day with a qualifying event (a
 *   historical fact, independent of `asOfDayKey`).
 * - `bestStreak` is the longest run of consecutive qualified days (never
 *   decreases as more days are folded).
 * - `currentStreak` is the length of the consecutive run ending at the most
 *   recent qualified day that is on or before `asOfDayKey`, provided that day
 *   is `asOfDayKey` or the day immediately before it; otherwise it is 0 (a gap
 *   or future as-of breaks the live streak).
 *
 * The caller's `events` array is never mutated.
 */
export function computeStreak(
  events: readonly GamificationEventV4[],
  asOfDayKey: string,
  timezone?: string,
): StreakResultV4 {
  assertValidDayKey(asOfDayKey, 'asOfDayKey')

  // Collect unique qualified day keys (duplicate qualification is a no-op).
  const daySet = new Set<string>()
  for (const event of events) {
    if (!STREAK_QUALIFYING_EVENT_TYPES.has(event.eventType)) continue
    daySet.add(dayKeyFor(event.effectiveAt, timezone))
  }

  const days = [...daySet].sort()
  if (days.length === 0) {
    return { currentStreak: 0, bestStreak: 0, lastQualifiedDayKey: null }
  }

  // Run length ending at each day, and the overall best streak.
  const runEndingAt = new Map<string, number>()
  let bestStreak = 0
  for (let i = 0; i < days.length; i++) {
    const prev = i === 0 ? null : days[i - 1]
    const consecutive = prev !== null && daysBetweenDayKeys(prev, days[i]) === 1
    const run = consecutive ? (runEndingAt.get(prev) ?? 0) + 1 : 1
    runEndingAt.set(days[i], run)
    if (run > bestStreak) bestStreak = run
  }

  // Most recent qualified day on or before asOfDayKey.
  let currentStreak = 0
  for (const day of days) {
    const distance = daysBetweenDayKeys(day, asOfDayKey)
    if (distance < 0) break // days are sorted ascending; nothing later qualifies
    if (distance <= 1) {
      currentStreak = runEndingAt.get(day) ?? 0
    } else {
      // A gap before asOfDayKey breaks the live streak.
      currentStreak = 0
    }
  }

  return {
    currentStreak,
    bestStreak,
    lastQualifiedDayKey: days[days.length - 1],
  }
}
