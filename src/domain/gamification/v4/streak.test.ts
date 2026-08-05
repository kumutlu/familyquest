/**
 * Gamification V4 — streak calculation (Task 1.6).
 *
 * Pure, deterministic projection of `currentStreak` / `bestStreak` /
 * `lastQualifiedDayKey` from folded `DAILY_GOAL_AWARDED` / `PERFECT_DAY_AWARDED`
 * events. No `users` document fallback, no Firestore, no clock access.
 *
 * Every date/time input is explicit. Day identity uses the family IANA
 * timezone (approved convention: missing/invalid falls back to `Europe/London`),
 * never the browser or local-machine timezone.
 *
 * See docs/gamification-v4-design.md §3.4 and
 * docs/superpowers/plans/2026-08-05-gamification-v4-rewrite.md Task 1.6.
 */

import { describe, expect, it } from 'vitest'
import type { GamificationEventV4 } from './event'
import { GAMIFICATION_V4_SCHEMA_VERSION } from './types'
import { computeStreak, dayKeyFor, daysBetweenDayKeys, isValidDayKey } from './streak'

/** Build a minimal valid V4 event for streak tests. */
function makeEvent(
  eventType: GamificationEventV4['eventType'],
  effectiveAt: string,
  overrides: Partial<GamificationEventV4> = {},
): GamificationEventV4 {
  return {
    schemaVersion: GAMIFICATION_V4_SCHEMA_VERSION,
    eventId: `family-1::member-1::${eventType}::${effectiveAt}`,
    familyId: 'family-1',
    memberId: 'member-1',
    eventType,
    sourceType: 'daily_goal',
    sourceId: effectiveAt,
    effectiveAt,
    createdAt: effectiveAt,
    rewardPointsDelta: 0,
    xpDelta: 0,
    metadata: {},
    estimated: false,
    ...overrides,
  }
}

const ASOF = '2026-01-10'

describe('dayKeyFor — explicit family timezone, no local clock', () => {
  it('derives the London day key from a UTC instant', () => {
    expect(dayKeyFor('2026-01-05T12:00:00.000Z')).toBe('2026-01-05')
  })

  it('respects the DST boundary in Europe/London (spring forward)', () => {
    // 2026-03-29 00:30Z is 01:30 BST on the DST start day -> still 2026-03-29.
    expect(dayKeyFor('2026-03-29T00:30:00.000Z')).toBe('2026-03-29')
    // 2026-03-28 23:30Z is 23:30 GMT (still winter) -> 2026-03-28.
    expect(dayKeyFor('2026-03-28T23:30:00.000Z')).toBe('2026-03-28')
  })

  it('honours an explicitly supplied IANA timezone', () => {
    // Same instant, different family timezone -> different day key.
    expect(dayKeyFor('2026-01-05T23:30:00.000Z', 'America/New_York')).toBe('2026-01-05')
    expect(dayKeyFor('2026-01-06T00:30:00.000Z', 'America/New_York')).toBe('2026-01-05')
  })

  it('falls back to Europe/London for an invalid timezone (approved convention)', () => {
    expect(dayKeyFor('2026-01-05T12:00:00.000Z', 'not-a-zone')).toBe('2026-01-05')
  })

  it('rejects an unparseable timestamp', () => {
    expect(() => dayKeyFor('not-a-date')).toThrow()
    expect(() => dayKeyFor('2026-13-45T12:00:00.000Z')).toThrow()
  })

  it('accepts a date-only instant (parsed as UTC midnight)', () => {
    expect(dayKeyFor('2026-01-05')).toBe('2026-01-05')
  })
})

describe('daysBetweenDayKeys — deterministic integer day distance', () => {
  it('returns 0 for the same day', () => {
    expect(daysBetweenDayKeys('2026-01-05', '2026-01-05')).toBe(0)
  })

  it('returns 1 for consecutive days', () => {
    expect(daysBetweenDayKeys('2026-01-05', '2026-01-06')).toBe(1)
  })

  it('returns the gap for non-consecutive days', () => {
    expect(daysBetweenDayKeys('2026-01-05', '2026-01-08')).toBe(3)
  })

  it('returns a negative distance when reversed', () => {
    expect(daysBetweenDayKeys('2026-01-08', '2026-01-05')).toBe(-3)
  })

  it('handles month and year boundaries', () => {
    expect(daysBetweenDayKeys('2026-01-31', '2026-02-01')).toBe(1)
    expect(daysBetweenDayKeys('2025-12-31', '2026-01-01')).toBe(1)
  })
})

describe('isValidDayKey', () => {
  it('accepts a well-formed day key', () => {
    expect(isValidDayKey('2026-01-05')).toBe(true)
  })

  it('rejects malformed day keys', () => {
    expect(isValidDayKey('2026-1-5')).toBe(false)
    expect(isValidDayKey('2026-13-45')).toBe(false)
    expect(isValidDayKey('not-a-date')).toBe(false)
    expect(isValidDayKey('')).toBe(false)
  })
})

describe('computeStreak — empty ledger', () => {
  it('returns zeroed streak with null last qualified day', () => {
    const result = computeStreak([], ASOF)
    expect(result).toEqual({
      currentStreak: 0,
      bestStreak: 0,
      lastQualifiedDayKey: null,
    })
  })
})

describe('computeStreak — first qualified day starts the streak', () => {
  it('counts a single qualified day as currentStreak 1 / bestStreak 1', () => {
    const events = [makeEvent('DAILY_GOAL_AWARDED', '2026-01-05T10:00:00.000Z')]
    const result = computeStreak(events, '2026-01-05')
    expect(result.currentStreak).toBe(1)
    expect(result.bestStreak).toBe(1)
    expect(result.lastQualifiedDayKey).toBe('2026-01-05')
  })

  it('keeps the streak alive on the day after the last qualified day', () => {
    const events = [makeEvent('DAILY_GOAL_AWARDED', '2026-01-05T10:00:00.000Z')]
    const result = computeStreak(events, '2026-01-06')
    expect(result.currentStreak).toBe(1)
    expect(result.lastQualifiedDayKey).toBe('2026-01-05')
  })
})

describe('computeStreak — consecutive qualified days increment the streak', () => {
  it('increments currentStreak across consecutive days', () => {
    const events = [
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-05T10:00:00.000Z'),
      makeEvent('PERFECT_DAY_AWARDED', '2026-01-06T10:00:00.000Z'),
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-07T10:00:00.000Z'),
    ]
    const result = computeStreak(events, '2026-01-07')
    expect(result.currentStreak).toBe(3)
    expect(result.bestStreak).toBe(3)
    expect(result.lastQualifiedDayKey).toBe('2026-01-07')
  })
})

describe('computeStreak — a skipped day resets the current streak', () => {
  it('resets currentStreak to 0 after a gap but keeps bestStreak', () => {
    const events = [
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-05T10:00:00.000Z'),
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-06T10:00:00.000Z'),
      // gap: 2026-01-07 missing
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-08T10:00:00.000Z'),
    ]
    const result = computeStreak(events, '2026-01-08')
    expect(result.currentStreak).toBe(1)
    expect(result.bestStreak).toBe(2)
    expect(result.lastQualifiedDayKey).toBe('2026-01-08')
  })

  it('reports currentStreak 0 when asOfDayKey is past the gap', () => {
    const events = [
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-05T10:00:00.000Z'),
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-06T10:00:00.000Z'),
    ]
    const result = computeStreak(events, '2026-01-09')
    expect(result.currentStreak).toBe(0)
    expect(result.bestStreak).toBe(2)
    expect(result.lastQualifiedDayKey).toBe('2026-01-06')
  })
})

describe('computeStreak — best streak never decreases', () => {
  it('is non-decreasing as more days are folded', () => {
    const base = [
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-05T10:00:00.000Z'),
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-06T10:00:00.000Z'),
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-07T10:00:00.000Z'),
    ]
    const afterGap = [
      ...base,
      // gap then a single day
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-10T10:00:00.000Z'),
    ]
    const before = computeStreak(base, '2026-01-07')
    const after = computeStreak(afterGap, '2026-01-10')
    expect(after.bestStreak).toBeGreaterThanOrEqual(before.bestStreak)
    expect(after.bestStreak).toBe(3)
  })
})

describe('computeStreak — duplicate qualification for the same day is a no-op', () => {
  it('does not double-count a day with multiple qualifying events', () => {
    const events = [
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-05T10:00:00.000Z'),
      makeEvent('PERFECT_DAY_AWARDED', '2026-01-05T14:00:00.000Z'),
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-06T10:00:00.000Z'),
    ]
    const result = computeStreak(events, '2026-01-06')
    expect(result.currentStreak).toBe(2)
    expect(result.bestStreak).toBe(2)
    expect(result.lastQualifiedDayKey).toBe('2026-01-06')
  })
})

describe('computeStreak — out-of-order input is deterministic', () => {
  it('produces identical output regardless of input order', () => {
    const a = makeEvent('DAILY_GOAL_AWARDED', '2026-01-05T10:00:00.000Z')
    const b = makeEvent('DAILY_GOAL_AWARDED', '2026-01-06T10:00:00.000Z')
    const c = makeEvent('DAILY_GOAL_AWARDED', '2026-01-07T10:00:00.000Z')
    const forward = computeStreak([a, b, c], '2026-01-07')
    const backward = computeStreak([c, b, a], '2026-01-07')
    const shuffled = computeStreak([b, c, a], '2026-01-07')
    expect(backward).toEqual(forward)
    expect(shuffled).toEqual(forward)
    expect(forward.currentStreak).toBe(3)
  })
})

describe('computeStreak — timezone / day-boundary handling is explicit', () => {
  it('assigns a late-night UTC instant to the correct London day', () => {
    // 2026-01-05T23:30:00Z is 2026-01-05 23:30 GMT (winter) -> 2026-01-05.
    const events = [makeEvent('DAILY_GOAL_AWARDED', '2026-01-05T23:30:00.000Z')]
    expect(computeStreak(events, '2026-01-05').lastQualifiedDayKey).toBe('2026-01-05')
  })

  it('uses the supplied family timezone for day identity', () => {
    // 2026-01-06T00:30:00Z is 2026-01-05 19:30 in America/New_York.
    const events = [
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-06T00:30:00.000Z'),
    ]
    expect(computeStreak(events, '2026-01-05', 'America/New_York').lastQualifiedDayKey).toBe(
      '2026-01-05',
    )
  })
})

describe('computeStreak — invalid day keys are rejected', () => {
  it('throws on an invalid asOfDayKey', () => {
    const events = [makeEvent('DAILY_GOAL_AWARDED', '2026-01-05T10:00:00.000Z')]
    expect(() => computeStreak(events, '2026-13-45')).toThrow()
    expect(() => computeStreak(events, 'not-a-date')).toThrow()
  })
})

describe('computeStreak — repeated calls are deterministic', () => {
  it('returns identical results across repeated calls', () => {
    const events = [
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-05T10:00:00.000Z'),
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-06T10:00:00.000Z'),
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-08T10:00:00.000Z'),
    ]
    const first = computeStreak(events, '2026-01-08')
    const second = computeStreak(events, '2026-01-08')
    expect(second).toEqual(first)
  })
})

describe('computeStreak — no mutation of caller input', () => {
  it('does not mutate the supplied events array', () => {
    const events = [
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-05T10:00:00.000Z'),
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-06T10:00:00.000Z'),
    ]
    const snapshot = JSON.stringify(events)
    computeStreak(events, '2026-01-06')
    expect(JSON.stringify(events)).toBe(snapshot)
  })
})

describe('computeStreak — ignores non-qualifying event types', () => {
  it('does not count TASK_APPROVED / REWARD_REDEEMED toward the streak', () => {
    const events = [
      makeEvent('TASK_APPROVED', '2026-01-05T10:00:00.000Z'),
      makeEvent('REWARD_REDEEMED', '2026-01-06T10:00:00.000Z'),
      makeEvent('DAILY_GOAL_AWARDED', '2026-01-07T10:00:00.000Z'),
    ]
    const result = computeStreak(events, '2026-01-07')
    expect(result.currentStreak).toBe(1)
    expect(result.bestStreak).toBe(1)
    expect(result.lastQualifiedDayKey).toBe('2026-01-07')
  })
})
