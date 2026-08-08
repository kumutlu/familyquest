import { describe, it, expect } from 'vitest'
import { mapBehaviour, type BehaviourSource } from './behaviourMapper'

describe('behaviourMapper', () => {
  it('maps a positive behaviour to a BEHAVIOUR_POSITIVE event', () => {
    const source: BehaviourSource = {
      familyId: 'family-1',
      memberId: 'member-1',
      behaviourEventId: 'beh-1',
      type: 'positive',
      pointsDelta: 20,
      effectiveAt: '2026-01-05T10:00:00.000Z',
      createdAt: '2026-01-05T10:00:00.000Z',
    }
    const event = mapBehaviour(source)
    expect(event.eventType).toBe('BEHAVIOUR_POSITIVE')
    expect(event.eventId).toBe('behaviour:family-1:member-1:beh-1')
    expect(event.rewardPointsDelta).toBe(20)
    expect(event.xpDelta).toBe(20)
    expect(event.weeklyPointsDelta).toBe(20)
  })

  it('maps a negative behaviour to a BEHAVIOUR_NEGATIVE event', () => {
    const source: BehaviourSource = {
      familyId: 'family-1',
      memberId: 'member-1',
      behaviourEventId: 'beh-2',
      type: 'negative',
      pointsDelta: -5,
      effectiveAt: '2026-01-05T10:00:00.000Z',
      createdAt: '2026-01-05T10:00:00.000Z',
    }
    const event = mapBehaviour(source)
    expect(event.eventType).toBe('BEHAVIOUR_NEGATIVE')
    expect(event.rewardPointsDelta).toBe(-5)
    expect(event.xpDelta).toBe(0)
    expect(event.weeklyPointsDelta).toBe(0)
  })
})