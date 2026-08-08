import {
  GAMIFICATION_V3_SCHEMA_VERSION,
  type DailyGoalAwardedEventV3,
  type PerfectDayAwardedEventV3,
} from '../../../../src/domain/gamification/v3/event'
import { dailyGoalEventId, perfectDayEventId } from '../../../../src/domain/gamification/v3/ids'

export interface DailyGoalSource {
  readonly familyId: string
  readonly memberId: string
  readonly dayKey: string
  readonly xpAward: number
  readonly rewardPointsAward: number
  readonly weeklyPointsAward: number
  readonly awardedAt: string
}

const PERFECT_DAY_XP_AWARD = 50
const DAILY_GOAL_XP_AWARD = 25

/** Pure mapper: daily goal threshold → DAILY_GOAL_AWARDED V3 event. */
export function mapDailyGoal(source: DailyGoalSource): DailyGoalAwardedEventV3 {
  const eventId = dailyGoalEventId(source.familyId, source.memberId, source.dayKey)
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId,
    eventType: 'DAILY_GOAL_AWARDED',
    familyId: source.familyId,
    memberId: source.memberId,
    sourceType: 'daily_goal',
    sourceId: source.dayKey,
    effectiveAt: source.awardedAt,
    createdAt: source.awardedAt,
    rewardPointsDelta: 0,
    xpDelta: DAILY_GOAL_XP_AWARD,
    weeklyPointsDelta: 0,
    idempotencyKey: eventId,
    metadata: { dayKey: source.dayKey },
  }
}

/** Pure mapper: perfect day threshold → PERFECT_DAY_AWARDED V3 event. */
export function mapPerfectDay(source: DailyGoalSource): PerfectDayAwardedEventV3 {
  const eventId = perfectDayEventId(source.familyId, source.memberId, source.dayKey)
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId,
    eventType: 'PERFECT_DAY_AWARDED',
    familyId: source.familyId,
    memberId: source.memberId,
    sourceType: 'perfect_day',
    sourceId: source.dayKey,
    effectiveAt: source.awardedAt,
    createdAt: source.awardedAt,
    rewardPointsDelta: 0,
    xpDelta: PERFECT_DAY_XP_AWARD,
    weeklyPointsDelta: 0,
    idempotencyKey: eventId,
    metadata: { dayKey: source.dayKey },
  }
}