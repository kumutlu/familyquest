import { describe, expect, it } from 'vitest'
import {
  BUSINESS_FIELD_NAMES_V4,
  businessFields,
  ESTIMATED_FLAG,
  GAMIFICATION_V4_EVENT_TYPES,
  GAMIFICATION_V4_SCHEMA_VERSION,
  type GamificationStateV4,
  SOURCE_TYPE,
} from './types'

const STATE: GamificationStateV4 = {
  rewardPoints: 10,
  xpTotal: 120,
  level: 2,
  xpProgressInLevel: 20,
  xpToNextLevel: 80,
  levelProgressPercentage: 20,
  currentStreak: 3,
  bestStreak: 5,
  lastQualifiedDayKey: '2026-01-05',
  unlockedAchievementIds: ['a1'],
  unlockedAvatarIds: ['av1'],
  projectionVersion: 1,
  foldedThroughEventId: 'evt-1',
  updatedAt: '2026-01-05T10:00:00.000Z',
}

describe('V4 type contracts', () => {
  it('declares schema version 4', () => {
    expect(GAMIFICATION_V4_SCHEMA_VERSION).toBe(4)
  })

  it('declares every required event type exactly once (design §2.2)', () => {
    expect([...GAMIFICATION_V4_EVENT_TYPES].sort()).toEqual([
      'AVATAR_UNLOCKED',
      'BEHAVIOUR_NEGATIVE',
      'BEHAVIOUR_POSITIVE',
      'DAILY_GOAL_AWARDED',
      'MANUAL_ADJUSTMENT',
      'MIGRATION_BASELINE',
      'PERFECT_DAY_AWARDED',
      'REWARD_REDEEMED',
      'REWARD_REFUNDED',
      'TASK_APPROVED',
      'TASK_REVERSED',
    ])
    expect(GAMIFICATION_V4_EVENT_TYPES).toHaveLength(11)
  })

  it('declares the known source types (design §2.1)', () => {
    expect(Object.values(SOURCE_TYPE).sort()).toEqual([
      'avatar',
      'behaviour',
      'daily_goal',
      'manual',
      'perfect_day',
      'reward_redemption',
      'reversal',
      'task_completion',
    ].sort())
  })

  it('exposes the estimated flag field name', () => {
    expect(ESTIMATED_FLAG).toBe('estimated')
  })

  it('businessFields returns exactly the authoritative field set (design §2.4)', () => {
    const fields = businessFields(STATE)
    expect(Object.keys(fields).sort()).toEqual([...BUSINESS_FIELD_NAMES_V4].sort())
    expect(fields).toEqual({
      rewardPoints: 10,
      xpTotal: 120,
      level: 2,
      xpProgressInLevel: 20,
      xpToNextLevel: 80,
      levelProgressPercentage: 20,
      currentStreak: 3,
      bestStreak: 5,
      lastQualifiedDayKey: '2026-01-05',
      unlockedAchievementIds: ['a1'],
      unlockedAvatarIds: ['av1'],
    })
  })

  it('businessFields excludes metadata fields', () => {
    const fields = businessFields(STATE)
    expect('projectionVersion' in fields).toBe(false)
    expect('foldedThroughEventId' in fields).toBe(false)
    expect('updatedAt' in fields).toBe(false)
  })
})
