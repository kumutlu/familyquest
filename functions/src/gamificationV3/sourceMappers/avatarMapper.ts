import { GAMIFICATION_V3_SCHEMA_VERSION, type AvatarUnlockedEventV3 } from '../../../../src/domain/gamification/v3/event'
import { avatarUnlockedEventId } from '../../../../src/domain/gamification/v3/ids'

export interface AvatarUnlockSource {
  readonly familyId: string
  readonly memberId: string
  readonly avatarId: string
  readonly costPoints: number
  readonly unlockedAt: string
  readonly createdAt: string
}

/** Pure mapper: client avatar unlock → immutable AVATAR_UNLOCKED V3 event. */
export function mapAvatarUnlock(source: AvatarUnlockSource): AvatarUnlockedEventV3 {
  const eventId = avatarUnlockedEventId(source.familyId, source.memberId, source.avatarId)
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId,
    eventType: 'AVATAR_UNLOCKED',
    familyId: source.familyId,
    memberId: source.memberId,
    sourceType: 'avatar_unlock',
    sourceId: source.avatarId,
    effectiveAt: source.unlockedAt,
    createdAt: source.createdAt,
    rewardPointsDelta: -source.costPoints,
    xpDelta: 0,
    weeklyPointsDelta: 0,
    idempotencyKey: eventId,
    metadata: { avatarId: source.avatarId },
  }
}