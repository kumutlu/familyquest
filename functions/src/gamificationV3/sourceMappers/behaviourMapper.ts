import {
  GAMIFICATION_V3_SCHEMA_VERSION,
  type BehaviourNegativeEventV3,
  type BehaviourPositiveEventV3,
} from '../../../../src/domain/gamification/v3/event'
import { behaviourEventId } from '../../../../src/domain/gamification/v3/ids'

export interface BehaviourSource {
  readonly familyId: string
  readonly memberId: string
  readonly behaviourEventId: string
  readonly type: 'positive' | 'negative' | 'financial'
  readonly pointsDelta: number
  readonly effectiveAt: string
  readonly createdAt: string
}

/**
 * Pure mapper: legacy behaviour event → BEHAVIOUR_POSITIVE / BEHAVIOUR_NEGATIVE.
 *
 * Phase 1 contract: negative behaviour never reduces XP or weekly earnings;
 * positive behaviour earns XP equal to the reward delta.
 */
export function mapBehaviour(source: BehaviourSource): BehaviourPositiveEventV3 | BehaviourNegativeEventV3 {
  const eventId = behaviourEventId(source.familyId, source.memberId, source.behaviourEventId)
  const base = {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId,
    familyId: source.familyId,
    memberId: source.memberId,
    sourceType: 'behaviour_event',
    sourceId: source.behaviourEventId,
    effectiveAt: source.effectiveAt,
    createdAt: source.createdAt,
    rewardPointsDelta: source.pointsDelta,
    idempotencyKey: eventId,
    metadata: {},
  }

  if (source.type === 'negative') {
    return {
      ...base,
      eventType: 'BEHAVIOUR_NEGATIVE' as const,
      xpDelta: 0,
      weeklyPointsDelta: 0,
    }
  }

  // positive or financial behaviour with a positive delta is an earning event.
  return {
    ...base,
    eventType: 'BEHAVIOUR_POSITIVE' as const,
    xpDelta: source.pointsDelta,
    weeklyPointsDelta: source.pointsDelta,
  }
}