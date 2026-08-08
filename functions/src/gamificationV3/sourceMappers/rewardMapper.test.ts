import { describe, it, expect } from 'vitest'
import { mapRedemption, type RedemptionSource } from './rewardMapper'

describe('rewardMapper', () => {
  it('maps a redemption to a REWARD_REDEEMED event', () => {
    const source: RedemptionSource = {
      familyId: 'family-1',
      memberId: 'member-1',
      redemptionId: 'red-1',
      costPoints: 10,
      redeemedAt: '2026-01-05T10:00:00.000Z',
      createdAt: '2026-01-05T10:00:00.000Z',
    }
    const event = mapRedemption(source)
    expect(event.eventType).toBe('REWARD_REDEEMED')
    expect(event.eventId).toBe('reward-redeemed:family-1:member-1:red-1')
    expect(event.rewardPointsDelta).toBe(-10)
    expect(event.xpDelta).toBe(0)
    expect(event.weeklyPointsDelta).toBe(0)
  })
})