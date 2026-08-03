import { describe, expect, it } from 'vitest'
import { resolveProgression } from './gamificationAdapters'

const projection = {
  schemaVersion: 1,
  familyId: 'f1',
  childId: 'c1',
  xpTotal: 2500,
  level: 3,
  currentStreak: 1,
  bestStreak: 2,
  perfectDayCount: 0,
  lastQualifiedDayKey: null,
  projectionRevision: 1,
  foldedThrough: null,
  rebuildRequired: false,
  earliestDirtyCursor: null,
  projectionStatus: 'ready',
  updatedAt: 0,
} as any

describe('resolveProgression', () => {
  it('derives progression from lifetime XP when no projection exists', () => {
    expect(resolveProgression(null, { lifetimeXP: 2500 })).toEqual({
      level: 3,
      xpTotal: 2500,
      lifetimeXp: 2500,
      xpProgressInLevel: 500,
      xpToNextLevel: 500,
      percentage: 50,
      source: 'derived',
    })
  })

  it('derives progression from lifetime XP when the projection is rebuilding', () => {
    const rebuilding = { ...projection, rebuildRequired: true }
    expect(resolveProgression(rebuilding, { lifetimeXP: 1000 }).source).toBe('derived')
    expect(resolveProgression(rebuilding, { lifetimeXP: 1000 }).level).toBe(2)
  })

  it('uses the projection when it is ready', () => {
    expect(resolveProgression(projection, { lifetimeXP: 0 })).toEqual({
      level: 3,
      xpTotal: 2500,
      lifetimeXp: 2500,
      xpProgressInLevel: 500,
      xpToNextLevel: 500,
      percentage: 50,
      source: 'projection',
    })
  })

  it('treats a missing lifetime XP as zero and still returns a complete view', () => {
    expect(resolveProgression(null, {})).toEqual({
      level: 1,
      xpTotal: 0,
      lifetimeXp: 0,
      xpProgressInLevel: 0,
      xpToNextLevel: 1000,
      percentage: 0,
      source: 'derived',
    })
  })
})
