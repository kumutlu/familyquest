import { GAMIFICATION_V3_SCHEMA_VERSION, type ReversalEventV3 } from '../../../../src/domain/gamification/v3/event'
import { reversalEventId } from '../../../../src/domain/gamification/v3/ids'

export interface ReversalSource {
  readonly familyId: string
  readonly memberId: string
  readonly reversalId: string
  readonly originalEventId: string  // The V3 eventId being reversed
  readonly rewardPointsDelta: number
  readonly xpDelta: number
  readonly weeklyPointsDelta: number
  readonly reversedAt: string
  readonly createdAt: string
}

/** Pure mapper: reversal → immutable REVERSAL V3 event. */
export function mapReversal(source: ReversalSource): ReversalEventV3 {
  const eventId = reversalEventId(source.originalEventId, source.reversalId)
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId,
    eventType: 'REVERSAL',
    familyId: source.familyId,
    memberId: source.memberId,
    sourceType: 'reversal',
    sourceId: source.reversalId,
    effectiveAt: source.reversedAt,
    createdAt: source.createdAt,
    rewardPointsDelta: source.rewardPointsDelta,
    xpDelta: source.xpDelta,
    weeklyPointsDelta: source.weeklyPointsDelta,
    idempotencyKey: eventId,
    reversalOfEventId: source.originalEventId,
    metadata: {},
  }
}