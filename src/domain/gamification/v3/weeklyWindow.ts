import { assertInstant, ValidationErrorV3 } from './validators'

/**
 * Weekly Points window semantics.
 *
 * - Day boundary: local midnight in the family's configured IANA timezone.
 * - Week start day: Monday (ISO-8601), configurable per family via `weekStartsOn`
 *   where 0 = Sunday .. 6 = Saturday.
 * - Window key format: `YYYY-Www` (ISO week-numbering year and week of the
 *   Thursday inside the local week).
 * - Fallback: if a family has no timezone, or an unusable one, the documented
 *   fallback is `UTC`. The browser/local timezone is never used implicitly.
 */

export interface WeeklyContextV3 {
  readonly timeZone: string
  /** 0 = Sunday .. 6 = Saturday. */
  readonly weekStartsOn: number
}

export const DEFAULT_WEEKLY_CONTEXT: Readonly<WeeklyContextV3> = Object.freeze({
  timeZone: 'UTC',
  weekStartsOn: 1,
})

export interface WeeklyContextInput {
  readonly timeZone?: string | null
  readonly weekStartsOn?: number | null
}

function isUsableTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone })
    return true
  } catch {
    return false
  }
}

export function resolveWeeklyContext(input: WeeklyContextInput | undefined | null): Readonly<WeeklyContextV3> {
  const requested = input?.timeZone
  const timeZone = typeof requested === 'string' && requested.length > 0 && isUsableTimeZone(requested)
    ? requested
    : DEFAULT_WEEKLY_CONTEXT.timeZone
  const weekStartsOn = Number.isInteger(input?.weekStartsOn) ? (input?.weekStartsOn as number) : DEFAULT_WEEKLY_CONTEXT.weekStartsOn
  if (weekStartsOn < 0 || weekStartsOn > 6) {
    throw new ValidationErrorV3('weekStartsOn must be an integer from 0 through 6')
  }
  return Object.freeze({ timeZone, weekStartsOn })
}

interface LocalParts {
  readonly year: number
  readonly month: number
  readonly day: number
}

function localParts(instant: string, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const [year, month, day] = formatter.format(new Date(instant)).split('-').map(Number)
  return { year, month, day }
}

function toUtcMidnight(parts: LocalParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day)
}

const DAY_MS = 86_400_000

export function dayKeyFor(instant: string, context: WeeklyContextV3): string {
  assertInstant(instant, 'instant')
  const parts = localParts(instant, context.timeZone)
  const mm = String(parts.month).padStart(2, '0')
  const dd = String(parts.day).padStart(2, '0')
  return `${parts.year}-${mm}-${dd}`
}

/** Local midnight (as a UTC-normalised timestamp) of the first day of the window. */
export function weekStartTimestampFor(instant: string, context: WeeklyContextV3): number {
  const midnight = toUtcMidnight(localParts(instant, context.timeZone))
  const dayOfWeek = new Date(midnight).getUTCDay()
  const offset = (dayOfWeek - context.weekStartsOn + 7) % 7
  return midnight - offset * DAY_MS
}

export function weeklyWindowKeyFor(instant: string, context: WeeklyContextV3): string {
  assertInstant(instant, 'instant')
  const weekStart = weekStartTimestampFor(instant, context)
  // The ISO week-numbering year is defined by the Thursday inside the week.
  const thursday = new Date(weekStart + 3 * DAY_MS)
  const isoYear = thursday.getUTCFullYear()
  const jan1 = Date.UTC(isoYear, 0, 1)
  const week = Math.floor((thursday.getTime() - jan1) / DAY_MS / 7) + 1
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

export function daysBetweenDayKeys(earlier: string, later: string): number {
  const parse = (key: string): number => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
      throw new ValidationErrorV3(`dayKey must be formatted YYYY-MM-DD, received ${key}`)
    }
    const [y, m, d] = key.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((parse(later) - parse(earlier)) / DAY_MS)
}
