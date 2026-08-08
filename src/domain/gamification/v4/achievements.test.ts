/**
 * Gamification V4 — achievement & avatar derivation (Task 1.7).
 *
 * Pure, deterministic projection of `unlockedAchievementIds` and
 * `unlockedAvatarIds` from the authoritative V4 state. No UI unlock logic,
 * no Firestore, no clock access.
 *
 * See docs/gamification-v4-design.md §3.5 and
 * docs/superpowers/plans/2026-08-05-gamification-v4-rewrite.md Task 1.7.
 */

import { describe, expect, it } from 'vitest'
import type { GamificationStateV4 } from './types'
import { deriveAchievements, deriveUnlockedAvatars, ACHIEVEMENTS_V4 } from './achievements'

/** Build a valid baseline V4 state for tests (level 1, no progress). */
function makeState(overrides: Partial<GamificationStateV4> = {}): GamificationStateV4 {
  return {
    rewardPoints: 0,
    xpTotal: 0,
    level: 1,
    xpProgressInLevel: 0,
    xpToNextLevel: 1000,
    levelProgressPercentage: 0,
    currentStreak: 0,
    bestStreak: 0,
    lastQualifiedDayKey: null,
    unlockedAchievementIds: [],
    unlockedAvatarIds: [],
    projectionVersion: 4,
    foldedThroughEventId: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('deriveAchievements — pure projection-derived badges', () => {
  it('returns no achievements for a baseline (level 1, zero xp) state', () => {
    const state = makeState()
    expect(deriveAchievements(state)).toEqual([])
  })

  it('unlocks first_steps at xpTotal >= 50', () => {
    const state = makeState({ xpTotal: 50, xpProgressInLevel: 50, xpToNextLevel: 950, levelProgressPercentage: 5 })
    expect(deriveAchievements(state)).toContain('first_steps')
  })

  it('does NOT unlock first_steps below the threshold', () => {
    const state = makeState({ xpTotal: 49, xpProgressInLevel: 49, xpToNextLevel: 951, levelProgressPercentage: 4 })
    expect(deriveAchievements(state)).not.toContain('first_steps')
  })

  it('unlocks centurion at xpTotal >= 1000', () => {
    const state = makeState({ xpTotal: 1000, level: 2, xpProgressInLevel: 0, xpToNextLevel: 1000, levelProgressPercentage: 0 })
    expect(deriveAchievements(state)).toContain('centurion')
  })

  it('unlocks champion at xpTotal >= 5000', () => {
    const state = makeState({ xpTotal: 5000, level: 6, xpProgressInLevel: 0, xpToNextLevel: 1000, levelProgressPercentage: 0 })
    expect(deriveAchievements(state)).toContain('champion')
  })

  it('unlocks streak achievements from bestStreak only', () => {
    const state = makeState({ bestStreak: 3, currentStreak: 3 })
    const ids = deriveAchievements(state)
    expect(ids).toContain('streak_starter')
    expect(ids).not.toContain('streak_master')
  })

  it('unlocks streak_master at bestStreak >= 7', () => {
    const state = makeState({ bestStreak: 7, currentStreak: 7 })
    expect(deriveAchievements(state)).toContain('streak_master')
  })

  it('unlocks a level-based achievement from state.level only', () => {
    const state = makeState({ level: 5, xpTotal: 4000, xpProgressInLevel: 0, xpToNextLevel: 1000, levelProgressPercentage: 0 })
    expect(deriveAchievements(state)).toContain('level_five')
  })

  it('returns achievements in a deterministic, sorted order', () => {
    const state = makeState({
      xpTotal: 5000,
      level: 6,
      xpProgressInLevel: 0,
      xpToNextLevel: 1000,
      levelProgressPercentage: 0,
      bestStreak: 7,
      currentStreak: 7,
    })
    const a = deriveAchievements(state)
    const b = deriveAchievements(state)
    expect(a).toEqual([...a].sort())
    expect(a).toEqual(b)
  })

  it('is deterministic across repeated calls (same state -> same ids)', () => {
    const state = makeState({ xpTotal: 1200, level: 2, xpProgressInLevel: 200, xpToNextLevel: 800, levelProgressPercentage: 20, bestStreak: 4, currentStreak: 4 })
    expect(deriveAchievements(state)).toEqual(deriveAchievements({ ...state }))
  })

  it('does not mutate the caller-provided state', () => {
    const state = makeState({ xpTotal: 5000, level: 6, bestStreak: 7, unlockedAchievementIds: ['first_steps'] })
    const snapshot = JSON.stringify(state)
    deriveAchievements(state)
    expect(JSON.stringify(state)).toBe(snapshot)
  })

  it('rejects malformed state input', () => {
    // xpTotal negative is invalid per assertValidStateV4
    const bad = makeState({ xpTotal: -1 })
    expect(() => deriveAchievements(bad)).toThrow()
  })

  it('every canonical achievement id is unique', () => {
    const ids = ACHIEVEMENTS_V4.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('deriveUnlockedAvatars — pure projection-derived avatars', () => {
  it('returns the state unlockedAvatarIds for a baseline state', () => {
    const state = makeState()
    expect(deriveUnlockedAvatars(state)).toEqual([])
  })

  it('returns the unlocked avatars from the state', () => {
    const state = makeState({ unlockedAvatarIds: ['starter-cat', 'fox'] })
    expect(deriveUnlockedAvatars(state)).toEqual(['starter-cat', 'fox'])
  })

  it('returns a defensive copy (caller array is not the returned reference)', () => {
    const state = makeState({ unlockedAvatarIds: ['starter-cat'] })
    const result = deriveUnlockedAvatars(state)
    expect(result).not.toBe(state.unlockedAvatarIds)
    result.push('mutated')
    expect(state.unlockedAvatarIds).toEqual(['starter-cat'])
  })

  it('does not mutate the caller-provided state', () => {
    const state = makeState({ unlockedAvatarIds: ['starter-cat'] })
    const snapshot = JSON.stringify(state)
    deriveUnlockedAvatars(state)
    expect(JSON.stringify(state)).toBe(snapshot)
  })

  it('rejects malformed state input', () => {
    const bad = makeState({ rewardPoints: -5 })
    expect(() => deriveUnlockedAvatars(bad)).toThrow()
  })
})
