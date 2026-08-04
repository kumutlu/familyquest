import { describe, it, expect } from 'vitest'
import { mapManualAdjustment, type ManualAdjustmentSource } from './manualAdjustmentMapper'

describe('manualAdjustmentMapper', () => {
  it('maps a positive manual adjustment to a MANUAL_ADJUSTMENT event', () => {
    const source: ManualAdjustmentSource = {
      familyId: 'family-1',
      memberId: 'member-1',
      adjustmentId: 'adj-1',
      rewardPointsDelta: 10,
      reason: 'Good behaviour bonus',
      adjustedAt: '2026-01-05T10:00:00.000Z',
      createdAt: '2026-01-05T10:00:00.000Z',
    }
    const event = mapManualAdjustment(source)
    expect(event.eventType).toBe('MANUAL_ADJUSTMENT')
    expect(event.eventId).toBe('manual-adjustment:family-1:member-1:adj-1')
    expect(event.rewardPointsDelta).toBe(10)
    expect(event.xpDelta).toBe(0)
    expect(event.weeklyPointsDelta).toBe(0)
    expect(event.metadata.reason).toBe('Good behaviour bonus')
  })

  it('maps a negative manual adjustment', () => {
    const source: ManualAdjustmentSource = {
      familyId: 'family-1',
      memberId: 'member-1',
      adjustmentId: 'adj-2',
      rewardPointsDelta: -5,
      reason: 'Correction',
      clampToZero: true,
      adjustedAt: '2026-01-05T10:00:00.000Z',
      createdAt: '2026-01-05T10:00:00.000Z',
    }
    const event = mapManualAdjustment(source)
    expect(event.eventType).toBe('MANUAL_ADJUSTMENT')
    expect(event.rewardPointsDelta).toBe(-5)
    expect(event.metadata.clampToZero).toBe(true)
  })
})