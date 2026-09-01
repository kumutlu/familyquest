/**
 * RED tests for the Comeback resolver.
 *
 * Pure domain module — same module is used by client UI / Mascot /
 * Notification candidates AND the authoritative server evaluator. All
 * boundary semantics are pinned here.
 */
import { describe, expect, it } from 'vitest'

import { resolveComeback, tierForInactivity } from './eligibility'
import {
  COMEBACK_MISSION_BY_TIER,
  DEFAULT_COMEBACK_REWARD_TABLE,
  comebackEventId,
  comebackEvidenceId,
  comebackReversalEventId,
  comebackXpReward,
  familyLocalDateKey,
  inactivityDaysBetween,
  type ResolveComebackInput,
} from './types'

const TZ_LONDON = 'Europe/London'

/** Anchor: 2026-06-15 12:00 UTC = 2026-06-15 in Europe/London. */
const NOW_UTC = Date.UTC(2026, 5, 15, 12, 0, 0)
const LOCAL_TODAY = familyLocalDateKey(NOW_UTC, TZ_LONDON)

function localMidnight(year: number, monthIndex: number, day: number): number {
  // Produce the first instant whose London local date is (y, m, d).
  // For 2026-06-15 in Europe/London (summer), that's UTC 01:00.
  return Date.UTC(year, monthIndex, day, 1, 0, 0)
}

function input(overrides: Partial<ResolveComebackInput> = {}): ResolveComebackInput {
  return {
    timezone: overrides.timezone ?? TZ_LONDON,
    now: overrides.now ?? NOW_UTC,
    lastMeaningfulActivityAt: overrides.lastMeaningfulActivityAt,
    completedTiersForDate: overrides.completedTiersForDate,
  }
}

/* ----- tier mapping ------------------------------------------------------ */

describe('tierForInactivity — pinned mapping', () => {
  it('maps <1 day to none', () => {
    expect(tierForInactivity(0)).toBe('none')
    expect(tierForInactivity(0.4)).toBe('none')
    expect(tierForInactivity(-1)).toBe('none')
  })

  it('maps 1d..2d to return_1d', () => {
    expect(tierForInactivity(1)).toBe('return_1d')
    expect(tierForInactivity(2)).toBe('return_1d')
    expect(tierForInactivity(2.999)).toBe('return_1d')
  })

  it('maps 3d..6d to return_3d', () => {
    expect(tierForInactivity(3)).toBe('return_3d')
    expect(tierForInactivity(6)).toBe('return_3d')
    expect(tierForInactivity(6.999)).toBe('return_3d')
  })

  it('maps >=7d to return_7d', () => {
    expect(tierForInactivity(7)).toBe('return_7d')
    expect(tierForInactivity(30)).toBe('return_7d')
  })

  it('returns none for NaN / Infinity', () => {
    expect(tierForInactivity(Number.NaN)).toBe('none')
    expect(tierForInactivity(Number.POSITIVE_INFINITY)).toBe('none')
  })
})

/* ----- resolveComeback --------------------------------------------------- */

describe('resolveComeback', () => {
  it('returns tier=none for a child active today', () => {
    const result = resolveComeback(input({ lastMeaningfulActivityAt: NOW_UTC - 60_000 }))
    expect(result.tier).toBe('none')
    expect(result.missionId).toBeNull()
    expect(result.missionCompleted).toBe(false)
  })

  it('returns tier=return_1d for 1 calendar day of inactivity', () => {
    const yesterday = localMidnight(2026, 5, 14)
    const result = resolveComeback(input({ lastMeaningfulActivityAt: yesterday }))
    expect(result.tier).toBe('return_1d')
    expect(result.inactivityDays).toBe(1)
    expect(result.missionId).toBe(`mission-${LOCAL_TODAY}-return_1d`)
    expect(result.missionCompleted).toBe(false)
  })

  it('returns tier=return_3d for 3 days of inactivity', () => {
    const threeDaysAgo = localMidnight(2026, 5, 12)
    const result = resolveComeback(input({ lastMeaningfulActivityAt: threeDaysAgo }))
    expect(result.tier).toBe('return_3d')
    expect(result.inactivityDays).toBe(3)
  })

  it('returns tier=return_7d for 7+ days of inactivity', () => {
    const tenDaysAgo = localMidnight(2026, 5, 4)
    const result = resolveComeback(input({ lastMeaningfulActivityAt: tenDaysAgo }))
    expect(result.tier).toBe('return_7d')
    expect(result.inactivityDays).toBeGreaterThanOrEqual(10)
  })

  it('treats missing lastMeaningfulActivityAt as return_7d', () => {
    const result = resolveComeback(input({ lastMeaningfulActivityAt: undefined }))
    expect(result.tier).toBe('return_7d')
    expect(result.inactivityDays).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('treats null lastMeaningfulActivityAt as return_7d', () => {
    const result = resolveComeback(input({ lastMeaningfulActivityAt: null }))
    expect(result.tier).toBe('return_7d')
  })

  it('reports missionCompleted=true when the active tier has already been completed for today', () => {
    const tenDaysAgo = localMidnight(2026, 5, 4)
    const result = resolveComeback(input({
      lastMeaningfulActivityAt: tenDaysAgo,
      completedTiersForDate: ['return_7d'],
    }))
    expect(result.tier).toBe('return_7d')
    expect(result.missionCompleted).toBe(true)
    expect(result.missionId).toBeNull()
  })

  it('is pure: same inputs always produce the same output', () => {
    const a = resolveComeback(input({ lastMeaningfulActivityAt: localMidnight(2026, 5, 12) }))
    const b = resolveComeback(input({ lastMeaningfulActivityAt: localMidnight(2026, 5, 12) }))
    expect(a).toEqual(b)
  })

  it('uses family-local calendar-day math (timezone-aware)', () => {
    // 22:00 UTC on 2026-06-14 in London is 23:00 local on 2026-06-14.
    // The child was last active at 22:00 UTC on 2026-06-14 → local
    // 2026-06-14. From a `now` at 12:00 UTC on 2026-06-15, that is 1
    // calendar day of inactivity.
    const lastActivity = Date.UTC(2026, 5, 14, 22, 0, 0)
    const result = resolveComeback(input({ lastMeaningfulActivityAt: lastActivity }))
    expect(result.tier).toBe('return_1d')
    expect(result.inactivityDays).toBe(1)
  })

  it('does NOT mutate streaks or any other state', () => {
    const result = resolveComeback(input({ lastMeaningfulActivityAt: localMidnight(2026, 5, 12) }))
    expect(Object.keys(result).sort()).toEqual(['inactivityDays', 'missionCompleted', 'missionId', 'tier'])
  })
})

/* ----- idempotency keys -------------------------------------------------- */

describe('comeback id helpers', () => {
  it('event id is deterministic and includes the tier', () => {
    expect(comebackEventId('child-A', '2026-06-15', 'return_3d'))
      .toBe('comeback:child-A:2026-06-15:return_3d')
  })

  it('reversal id differs from event id', () => {
    expect(comebackReversalEventId('child-A', '2026-06-15', 'return_3d'))
      .toBe('comeback:child-A:2026-06-15:return_3d:reversal')
    expect(comebackReversalEventId('child-A', '2026-06-15', 'return_3d'))
      .not.toBe(comebackEventId('child-A', '2026-06-15', 'return_3d'))
  })

  it('evidence id uses triple underscore separator', () => {
    expect(comebackEvidenceId('child-A', '2026-06-15', 'return_3d'))
      .toBe('child-A__2026-06-15__return_3d')
  })

  it('rejects malformed local date in id helpers', () => {
    expect(() => comebackEventId('child-A', 'not-a-date', 'return_3d')).toThrow(/YYYY-MM-DD/)
    expect(() => comebackEvidenceId('child-A', '2026-6-15', 'return_3d')).toThrow(/YYYY-MM-DD/)
  })
})

/* ----- reward table ------------------------------------------------------ */

describe('comebackXpReward + DEFAULT_COMEBACK_REWARD_TABLE', () => {
  it('pinned rewards: 1d=0, 3d=25, 7d=50', () => {
    expect(DEFAULT_COMEBACK_REWARD_TABLE.return_1d).toBe(0)
    expect(DEFAULT_COMEBACK_REWARD_TABLE.return_3d).toBe(25)
    expect(DEFAULT_COMEBACK_REWARD_TABLE.return_7d).toBe(50)
  })

  it('comebackXpReward honors the supplied table', () => {
    expect(comebackXpReward('return_3d')).toBe(25)
    expect(comebackXpReward('return_7d')).toBe(50)
    expect(comebackXpReward('return_1d')).toBe(0)
    expect(comebackXpReward('none')).toBe(0)
  })

  it('supports overriding the reward table for tests', () => {
    expect(comebackXpReward('return_3d', { return_1d: 0, return_3d: 100, return_7d: 200 })).toBe(100)
  })
})

/* ----- family-local-day math -------------------------------------------- */

describe('inactivityDaysBetween', () => {
  it('returns 0 for the same date', () => {
    expect(inactivityDaysBetween('2026-06-15', '2026-06-15')).toBe(0)
  })

  it('returns 1 for adjacent dates', () => {
    expect(inactivityDaysBetween('2026-06-15', '2026-06-14')).toBe(1)
  })

  it('returns N for N calendar-day gaps', () => {
    expect(inactivityDaysBetween('2026-06-15', '2026-06-08')).toBe(7)
  })

  it('returns 0 when later < earlier (negative input)', () => {
    expect(inactivityDaysBetween('2026-06-10', '2026-06-15')).toBe(0)
  })

  it('rejects malformed date keys', () => {
    expect(() => inactivityDaysBetween('2026-6-15', '2026-06-08')).toThrow(/YYYY-MM-DD/)
    expect(() => inactivityDaysBetween('2026-06-15', 'not-a-date')).toThrow(/YYYY-MM-DD/)
  })
})

/* ----- mission catalog --------------------------------------------------- */

describe('COMEBACK_MISSION_BY_TIER', () => {
  it('contains a definition for every non-none tier', () => {
    expect(COMEBACK_MISSION_BY_TIER.has('return_1d')).toBe(true)
    expect(COMEBACK_MISSION_BY_TIER.has('return_3d')).toBe(true)
    expect(COMEBACK_MISSION_BY_TIER.has('return_7d')).toBe(true)
  })

  it('each tier definition is reward-aligned with the default table', () => {
    for (const tier of ['return_1d', 'return_3d', 'return_7d'] as const) {
      const def = COMEBACK_MISSION_BY_TIER.get(tier)!
      expect(def.rewardXp).toBe(DEFAULT_COMEBACK_REWARD_TABLE[tier])
    }
  })
})