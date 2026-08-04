import { GAMIFICATION_V3_SCHEMA_VERSION, type RewardRedeemedEventV3 } from '../../../../src/domain/gamification/v3/event'
import { rewardRedeemedEventId } from '../../../../src/domain/gamification/v3/ids'

export interface RedemptionSource {
  readonly familyId: string
  readonly memberId: string
  readonly redemptionId: string
  readonly costPoints: number
  readonly redeemedAt: string
  readonly createdAt: string
}

/** Pure mapper: client redemption → immutable REWARD_REDEEMED V3 event. */
export function mapRedemption(source: RedemptionSource): RewardRedeemedEventV3 {
  const eventId = rewardRedeemedEventId(source.familyId, source.memberId, source.redemptionId)
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId,
    eventType: 'REWARD_REDEEMED',
    familyId: source.familyId,
    memberId: source.memberId,
    sourceType: 'redemption',
    sourceId: source.redemptionId,
    effectiveAt: source.redeemedAt,
    createdAt: source.createdAt,
    rewardPointsDelta: -source.costPoints,
    xpDelta: 0,
    weeklyPointsDelta: 0,
    idempotencyKey: eventId,
    metadata: {},
  }
}