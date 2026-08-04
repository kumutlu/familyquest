import { GAMIFICATION_V3_SCHEMA_VERSION, type ManualAdjustmentEventV3 } from '../../../../src/domain/gamification/v3/event'
import { manualAdjustmentEventId } from '../../../../src/domain/gamification/v3/ids'

export interface ManualAdjustmentSource {
  readonly familyId: string
  readonly memberId: string
  readonly adjustmentId: string
  readonly rewardPointsDelta: number
  readonly reason: string
  readonly clampToZero?: boolean
  readonly adjustedAt: string
  readonly createdAt: string
}

/** Pure mapper: manual adjustment → immutable MANUAL_ADJUSTMENT V3 event. */
export function mapManualAdjustment(source: ManualAdjustmentSource): ManualAdjustmentEventV3 {
  const eventId = manualAdjustmentEventId(source.familyId, source.memberId, source.adjustmentId)
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId,
    eventType: 'MANUAL_ADJUSTMENT',
    familyId: source.familyId,
    memberId: source.memberId,
    sourceType: 'manual_adjustment',
    sourceId: source.adjustmentId,
    effectiveAt: source.adjustedAt,
    createdAt: source.createdAt,
    rewardPointsDelta: source.rewardPointsDelta,
    xpDelta: 0,
    weeklyPointsDelta: 0,
    idempotencyKey: eventId,
    metadata: { reason: source.reason, ...(source.clampToZero !== undefined ? { clampToZero: source.clampToZero } : {}) },
  }
}