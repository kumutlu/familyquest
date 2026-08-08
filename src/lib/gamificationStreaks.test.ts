import { describe, expect, it } from 'vitest'
import { resolveStreaks } from './gamificationAdapters'
import type { GamificationSummaryV1 } from '../domain/gamification/types'

const ready: GamificationSummaryV1 = {
  schemaVersion: 1,
  familyId: 'family-1',
  childId: 'child-1',
  xpTotal: 0,
  level: 1,
  currentStreak: 0,
  bestStreak: 0,
  perfectDayCount: 0,
  lastQualifiedDayKey: null,
  projectionRevision: 1,
  foldedThrough: null,
  rebuildRequired: false,
  earliestDirtyCursor: null,
  projectionStatus: 'ready',
  updatedAt: 0,
}

describe('resolveStreaks', () => {
  it('trusts a ready projection reporting zero over legacy counters', () => {
    expect(resolveStreaks(ready, { currentStreak: 3, longestStreak: 3 })).toEqual({
      currentStreak: 0,
      bestStreak: 0,
      source: 'projection',
    })
  })

  it('uses the ready projection values when they are non-zero', () => {
    expect(resolveStreaks({ ...ready, currentStreak: 3, bestStreak: 4 }, { longestStreak: 0 })).toEqual({
      currentStreak: 3,
      bestStreak: 4,
      source: 'projection',
    })
  })

  it('falls back to legacy counters only when the projection is unusable', () => {
    expect(resolveStreaks(null, { currentStreak: 1, longestStreak: 3 })).toEqual({
      currentStreak: 1,
      bestStreak: 3,
      source: 'legacy',
    })
    expect(resolveStreaks({ ...ready, rebuildRequired: true }, { longestStreak: 3 }).source).toBe('legacy')
    expect(resolveStreaks({ ...ready, projectionStatus: 'rebuilding' }, { longestStreak: 3 }).source).toBe('legacy')
  })

  it('normalises malformed values to non-negative integers', () => {
    expect(resolveStreaks(null, { currentStreak: -4, longestStreak: 2.7 })).toEqual({
      currentStreak: 0,
      bestStreak: 2,
      source: 'legacy',
    })
  })
})
