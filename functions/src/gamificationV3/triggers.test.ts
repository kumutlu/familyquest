import { describe, it, expect } from 'vitest'
import { mapRedemption, type RedemptionSource } from './sourceMappers/rewardMapper'
import { mapAvatarUnlock } from './sourceMappers/avatarMapper'
import { mapReversal } from './sourceMappers/reversalMapper'
import { mapManualAdjustment } from './sourceMappers/manualAdjustmentMapper'

describe('Trigger source mappers', () => {
  describe('reward redemption', () => {
    it('produces a valid REWARD_REDEEMED event from trigger source', () => {
      const source: RedemptionSource = {
        familyId: 'family-1',
        memberId: 'member-1',
        redemptionId: 'red-1',
        costPoints: 50,
        redeemedAt: '2026-01-05T10:00:00.000Z',
        createdAt: '2026-01-05T10:00:00.000Z',
      }
      const event = mapRedemption(source)
      expect(event.eventType).toBe('REWARD_REDEEMED')
      expect(event.rewardPointsDelta).toBe(-50)
    })
  })

  describe('avatar unlock', () => {
    it('produces a valid AVATAR_UNLOCKED event from trigger source', () => {
      const source = {
        familyId: 'family-1',
        memberId: 'member-1',
        avatarId: 'dragon',
        costPoints: 500,
        unlockedAt: '2026-01-05T10:00:00.000Z',
        createdAt: '2026-01-05T10:00:00.000Z',
      }
      const event = mapAvatarUnlock(source)
      expect(event.eventType).toBe('AVATAR_UNLOCKED')
      expect(event.rewardPointsDelta).toBe(-500)
    })
  })

  describe('reversal', () => {
    it('produces a valid REVERSAL event from trigger source', () => {
      const source = {
        familyId: 'family-1',
        memberId: 'member-1',
        reversalId: 'rev-1',
        originalEventId: 'task-approved:family-1:member-1:key',
        rewardPointsDelta: -10,
        xpDelta: -10,
        weeklyPointsDelta: -10,
        reversedAt: '2026-01-05T11:00:00.000Z',
        createdAt: '2026-01-05T11:00:00.000Z',
      }
      const event = mapReversal(source)
      expect(event.eventType).toBe('REVERSAL')
      expect(event.reversalOfEventId).toBe('task-approved:family-1:member-1:key')
    })
  })

  describe('manual adjustment', () => {
    it('produces a valid MANUAL_ADJUSTMENT event from trigger source', () => {
      const source = {
        familyId: 'family-1',
        memberId: 'member-1',
        adjustmentId: 'adj-1',
        rewardPointsDelta: 25,
        reason: 'Bonus',
        adjustedAt: '2026-01-05T10:00:00.000Z',
        createdAt: '2026-01-05T10:00:00.000Z',
      }
      const event = mapManualAdjustment(source)
      expect(event.eventType).toBe('MANUAL_ADJUSTMENT')
      expect(event.rewardPointsDelta).toBe(25)
    })
  })
})