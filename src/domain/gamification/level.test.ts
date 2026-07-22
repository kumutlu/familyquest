import { describe, expect, it } from 'vitest'
import { levelForXp, levelProgressForXp } from './level'

describe('XP levels', () => {
  it('advances at exact level boundaries', () => {
    expect(levelForXp(999, 1000)).toBe(1)
    expect(levelForXp(1000, 1000)).toBe(2)
  })

  it('derives exact progress within the current level', () => {
    expect(levelProgressForXp(1250, 1000)).toEqual({
      level: 2,
      xpIntoLevel: 250,
      xpToNextLevel: 750,
      percentage: 25,
    })
  })

  it('derives percentage without losing precision near MAX_SAFE_INTEGER', () => {
    expect(levelProgressForXp(Number.MAX_SAFE_INTEGER - 2, Number.MAX_SAFE_INTEGER - 1)).toMatchObject({
      percentage: 99,
    })
  })

  it.each([-1, 1.5, Number.NaN])('rejects invalid XP totals', (xp) => {
    expect(() => levelForXp(xp, 1000)).toThrow()
  })

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid XP-per-level values', (xpPerLevel) => {
    expect(() => levelProgressForXp(0, xpPerLevel)).toThrow()
  })
})
