import { describe, it, expect } from 'vitest'
import { mapDailyGoal, mapPerfectDay, type DailyGoalSource } from './dailyAwardMapper'

describe('dailyAwardMapper', () => {
  const base: DailyGoalSource = {
    familyId: 'family-1',
    memberId: 'member-1',
    dayKey: '2026-01-05',
    xpAward: 25,
    rewardPointsAward: 0,
    weeklyPointsAward: 0,
    awardedAt: '2026-01-05T10:00:00.000Z',
  }

  it('maps a daily goal award to a DAILY_GOAL_AWARDED event', () => {
    const event = mapDailyGoal(base)
    expect(event.eventType).toBe('DAILY_GOAL_AWARDED')
    expect(event.eventId).toBe('daily-goal:family-1:member-1:2026-01-05')
    expect(event.rewardPointsDelta).toBe(0)
    expect(event.xpDelta).toBe(25)
    expect(event.weeklyPointsDelta).toBe(0)
    expect(event.metadata.dayKey).toBe('2026-01-05')
  })

  it('maps a perfect day award to a PERFECT_DAY_AWARDED event', () => {
    const event = mapPerfectDay(base)
    expect(event.eventType).toBe('PERFECT_DAY_AWARDED')
    expect(event.eventId).toBe('perfect-day:family-1:member-1:2026-01-05')
    expect(event.rewardPointsDelta).toBe(0)
    expect(event.xpDelta).toBe(50)
    expect(event.weeklyPointsDelta).toBe(0)
    expect(event.metadata.dayKey).toBe('2026-01-05')
  })
})