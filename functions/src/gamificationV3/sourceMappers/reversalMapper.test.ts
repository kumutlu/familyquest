import { describe, it, expect } from 'vitest'
import { mapReversal, type ReversalSource } from './reversalMapper'

describe('reversalMapper', () => {
  it('maps a reversal to a REVERSAL event', () => {
    const source: ReversalSource = {
      familyId: 'family-1',
      memberId: 'member-1',
      reversalId: 'rev-1',
      originalEventId: 'task-approved:family-1:member-1:completion-1',
      rewardPointsDelta: -5,
      xpDelta: -5,
      weeklyPointsDelta: -5,
      reversedAt: '2026-01-05T11:00:00.000Z',
      createdAt: '2026-01-05T11:00:00.000Z',
    }
    const event = mapReversal(source)
    expect(event.eventType).toBe('REVERSAL')
    expect(event.eventId).toBe('reversal:task-approved:family-1:member-1:completion-1:rev-1')
    expect(event.reversalOfEventId).toBe('task-approved:family-1:member-1:completion-1')
    expect(event.rewardPointsDelta).toBe(-5)
    expect(event.xpDelta).toBe(-5)
    expect(event.weeklyPointsDelta).toBe(-5)
  })
})