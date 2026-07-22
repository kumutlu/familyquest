import { describe, expect, it } from 'vitest'
import {
  GAMIFICATION_CONFIG_V1,
  isValidXpReward,
  resolveGamificationConfig,
} from './config'

describe('gamification config v1', () => {
  it('exposes the fixed version-one settings', () => {
    expect(GAMIFICATION_CONFIG_V1).toEqual({
      schemaVersion: 1,
      xpPerLevel: 1000,
      defaultDailyGoalPercentage: 80,
      dailyGoalBonusXp: 25,
      perfectDayBonusXp: 50,
    })
    expect(Object.isFrozen(GAMIFICATION_CONFIG_V1)).toBe(true)
  })

  it('resolves a missing family setting to the v1 default', () => {
    expect(resolveGamificationConfig(undefined).dailyGoalPercentage).toBe(80)
  })

  it('uses a valid family daily-goal setting', () => {
    expect(resolveGamificationConfig({ schemaVersion: 1, dailyGoalPercentage: 75 }))
      .toMatchObject({ schemaVersion: 1, dailyGoalPercentage: 75 })
  })

  it.each([49, 101, 80.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid daily-goal percentage of %p',
    (dailyGoalPercentage) => {
      expect(() => resolveGamificationConfig({ schemaVersion: 1, dailyGoalPercentage })).toThrow()
    },
  )

  it.each([0, 25, Number.MAX_SAFE_INTEGER])('accepts %p as a valid XP reward', (value) => {
    expect(isValidXpReward(value)).toBe(true)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects %p as an invalid XP reward',
    (value) => {
      expect(isValidXpReward(value)).toBe(false)
    },
  )
})
