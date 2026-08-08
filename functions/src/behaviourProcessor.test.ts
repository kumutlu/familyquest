import { describe, expect, it } from 'vitest'
import {
  BEHAVIOUR_PROCESSOR_VERSION,
  behaviourEventIdempotencyKey,
  planBehaviourAward,
  type BehaviourAwardInput,
} from './behaviourProcessor'

function input(overrides: Partial<BehaviourAwardInput> = {}): BehaviourAwardInput {
  return {
    familyId: 'family-1',
    childId: 'child-1',
    behaviourEventId: 'behaviour-1',
    type: 'positive',
    pointsDelta: 20,
    effectiveAt: Date.parse('2026-08-03T10:00:00Z'),
    processingAt: Date.parse('2026-08-03T10:00:01Z'),
    currentRewardPoints: 350,
    currentXpTotal: 380,
    currentLifetimeXP: 380,
    ...overrides,
  }
}

describe('behaviourProcessor', () => {
  it('derives a deterministic idempotency identity per behaviour event', () => {
    expect(behaviourEventIdempotencyKey('family-1', 'child-1', 'behaviour-1'))
      .toBe('behaviour_event_v1|family-1|child-1|behaviour-1')
    expect(behaviourEventIdempotencyKey('family-1', 'child-1', 'behaviour-2'))
      .not.toBe(behaviourEventIdempotencyKey('family-1', 'child-1', 'behaviour-1'))
  })

  it('awards +20 rewardPoints and +20 xpTotal for a positive behaviour', () => {
    const plan = planBehaviourAward(input())
    expect(plan.status).toBe('planned')
    expect(plan.rewardPointsDelta).toBe(20)
    expect(plan.xpDelta).toBe(20)
    expect(plan.nextRewardPoints).toBe(370)
    expect(plan.nextXpTotal).toBe(400)
    expect(plan.nextLifetimeXP).toBe(400)
  })

  it('recalculates canonical level and progress from the projected xpTotal', () => {
    const plan = planBehaviourAward(input())
    expect(plan.level).toBeGreaterThanOrEqual(1)
    expect(plan.event.xpDelta).toBe(20)
    expect(plan.event.rewardPointsDelta).toBe(20)
    expect(plan.event.eventType).toBe('behaviour_positive')
    expect(plan.event.processorVersion).toBe(BEHAVIOUR_PROCESSOR_VERSION)
    expect(plan.event.sourceBehaviourEventId).toBe('behaviour-1')
    expect(plan.event.familyId).toBe('family-1')
    expect(plan.event.childId).toBe('child-1')
    expect(plan.event.idempotencyKey).toBe(behaviourEventIdempotencyKey('family-1', 'child-1', 'behaviour-1'))
    expect(plan.eventId).toContain('behaviour-1')
  })

  it('reduces only spendable points for a negative behaviour and never reduces XP', () => {
    const plan = planBehaviourAward(input({ type: 'negative', pointsDelta: -20 }))
    expect(plan.rewardPointsDelta).toBe(-20)
    expect(plan.xpDelta).toBe(0)
    expect(plan.nextRewardPoints).toBe(330)
    expect(plan.nextXpTotal).toBe(380)
    expect(plan.nextLifetimeXP).toBe(380)
  })

  it('clamps a negative behaviour at zero spendable points', () => {
    const plan = planBehaviourAward(input({ type: 'negative', pointsDelta: -500 }))
    expect(plan.nextRewardPoints).toBe(0)
    expect(plan.rewardPointsDelta).toBe(-350)
    expect(plan.nextXpTotal).toBe(380)
  })

  it('is a no-op when the behaviour event was already processed', () => {
    const plan = planBehaviourAward(input({ alreadyProcessed: true }))
    expect(plan.status).toBe('duplicate')
    expect(plan.rewardPointsDelta).toBe(0)
    expect(plan.xpDelta).toBe(0)
    expect(plan.nextRewardPoints).toBe(350)
    expect(plan.nextXpTotal).toBe(380)
  })

  it('never awards XP for a financial behaviour', () => {
    const plan = planBehaviourAward(input({ type: 'financial', pointsDelta: 0 }))
    expect(plan.xpDelta).toBe(0)
    expect(plan.rewardPointsDelta).toBe(0)
  })

  it('rejects an inconsistent positive behaviour delta', () => {
    expect(() => planBehaviourAward(input({ type: 'positive', pointsDelta: -5 }))).toThrow(/positive/i)
    expect(() => planBehaviourAward(input({ type: 'negative', pointsDelta: 5 }))).toThrow(/negative/i)
  })
})
