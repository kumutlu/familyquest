/**
 * Gamification V4 — canonical level calculation (Task 1.5).
 *
 * Pure, deterministic, single-source-of-truth derivation of level progression
 * from `xpTotal` only. No UI formula, no client arithmetic, no Firestore.
 *
 * See docs/gamification-v4-design.md §3.3 and
 * docs/superpowers/plans/2026-08-05-gamification-v4-rewrite.md Task 1.5.
 */

import { describe, expect, it } from 'vitest'
import { levelForXp, XP_PER_LEVEL_V4 } from './level'

describe('levelForXp — canonical V4 curve', () => {
  it('returns level 1 at the XP 0 boundary', () => {
    expect(levelForXp(0)).toEqual({
      level: 1,
      xpProgressInLevel: 0,
      xpToNextLevel: XP_PER_LEVEL_V4,
      levelProgressPercentage: 0,
    })
  })

  it('advances at the exact level boundary (1000)', () => {
    expect(levelForXp(XP_PER_LEVEL_V4)).toEqual({
      level: 2,
      xpProgressInLevel: 0,
      xpToNextLevel: XP_PER_LEVEL_V4,
      levelProgressPercentage: 0,
    })
  })

  it('is level 1 one below the boundary (999)', () => {
    const r = levelForXp(XP_PER_LEVEL_V4 - 1)
    expect(r.level).toBe(1)
    expect(r.xpProgressInLevel).toBe(XP_PER_LEVEL_V4 - 1)
    expect(r.xpToNextLevel).toBe(1)
    expect(r.levelProgressPercentage).toBe(99)
  })

  it('is level 2 one above the boundary (1001)', () => {
    const r = levelForXp(XP_PER_LEVEL_V4 + 1)
    expect(r.level).toBe(2)
    expect(r.xpProgressInLevel).toBe(1)
    expect(r.xpToNextLevel).toBe(XP_PER_LEVEL_V4 - 1)
    expect(r.levelProgressPercentage).toBe(0)
  })

  it('computes percentage without floating-point drift', () => {
    // 333 / 1000 = 33.3% -> must floor to 33, never 33.3 or 33.30000001
    const r = levelForXp(333)
    expect(r.xpProgressInLevel).toBe(333)
    expect(r.levelProgressPercentage).toBe(33)
    expect(Number.isInteger(r.levelProgressPercentage)).toBe(true)
  })

  it('computes a mid-level percentage (250 -> 25%)', () => {
    const r = levelForXp(250)
    expect(r.level).toBe(1)
    expect(r.xpProgressInLevel).toBe(250)
    expect(r.xpToNextLevel).toBe(750)
    expect(r.levelProgressPercentage).toBe(25)
  })

  it('handles large XP values deterministically', () => {
    const big = 1_000_000
    const r = levelForXp(big)
    expect(r.level).toBe(1001)
    expect(r.xpProgressInLevel).toBe(0)
    expect(r.xpToNextLevel).toBe(XP_PER_LEVEL_V4)
    expect(r.levelProgressPercentage).toBe(0)
  })

  it('handles Number.MAX_SAFE_INTEGER without overflow', () => {
    const r = levelForXp(Number.MAX_SAFE_INTEGER)
    expect(r.level).toBe(Math.floor(Number.MAX_SAFE_INTEGER / XP_PER_LEVEL_V4) + 1)
    expect(r.xpProgressInLevel + r.xpToNextLevel).toBe(XP_PER_LEVEL_V4)
    expect(r.levelProgressPercentage).toBeGreaterThanOrEqual(0)
    expect(r.levelProgressPercentage).toBeLessThanOrEqual(100)
  })

  it('rejects negative XP totals', () => {
    expect(() => levelForXp(-1)).toThrow()
  })

  it('rejects non-integer XP totals', () => {
    expect(() => levelForXp(1.5)).toThrow()
    expect(() => levelForXp(Number.NaN)).toThrow()
    expect(() => levelForXp(Number.POSITIVE_INFINITY)).toThrow()
  })

  it('rejects non-safe-integer XP totals', () => {
    expect(() => levelForXp(Number.MAX_SAFE_INTEGER + 1)).toThrow()
  })

  it('is deterministic across repeated calls', () => {
    const samples = [0, 1, 999, 1000, 1001, 2500, 999_999, 1_000_000]
    for (const xp of samples) {
      expect(levelForXp(xp)).toEqual(levelForXp(xp))
      expect(levelForXp(xp)).toEqual(levelForXp(xp))
    }
  })

  it('keeps returned progression fields internally consistent', () => {
    const samples = [0, 333, 500, 999, 1000, 1001, 2500, 1_000_000]
    for (const xp of samples) {
      const r = levelForXp(xp)
      // progress + remaining == one full level span
      expect(r.xpProgressInLevel + r.xpToNextLevel).toBe(XP_PER_LEVEL_V4)
      // level matches the canonical integer formula
      expect(r.level).toBe(Math.floor(xp / XP_PER_LEVEL_V4) + 1)
      // percentage matches the integer floor of progress / span
      expect(r.levelProgressPercentage).toBe(
        Number((BigInt(r.xpProgressInLevel) * 100n) / BigInt(XP_PER_LEVEL_V4)),
      )
      // percentage is clamped to 0..100
      expect(r.levelProgressPercentage).toBeGreaterThanOrEqual(0)
      expect(r.levelProgressPercentage).toBeLessThanOrEqual(100)
    }
  })
})
