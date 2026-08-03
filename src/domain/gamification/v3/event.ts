/**
 * Canonical Gamification V3 event contract.
 *
 * Pure domain module: no Firestore, no Cloud Functions, no clock access.
 * Every ledger fact in V3 is one immutable event in this discriminated union.
 */

export const GAMIFICATION_V3_SCHEMA_VERSION = 3 as const

export const GAMIFICATION_V3_EVENT_TYPES = [
  'TASK_APPROVED',
  'BEHAVIOUR_POSITIVE',
  'BEHAVIOUR_NEGATIVE',
  'REWARD_REDEEMED',
  'AVATAR_UNLOCKED',
  'MANUAL_ADJUSTMENT',
  'REVERSAL',
  'DAILY_GOAL_AWARDED',
  'PERFECT_DAY_AWARDED',
  'LEGACY_BASELINE',
  'WEEK_ROLLOVER',
] as const

export type GamificationEventTypeV3 = (typeof GAMIFICATION_V3_EVENT_TYPES)[number]

export type EventMetadataV3 = Readonly<Record<string, unknown>>

/** Fields shared by every V3 event. */
interface EventBaseV3 {
  readonly schemaVersion: typeof GAMIFICATION_V3_SCHEMA_VERSION
  /** Deterministic ledger identity — see `ids.ts`. */
  readonly eventId: string
  readonly familyId: string
  readonly memberId: string
  /** Domain of the originating action, e.g. `task_completion`. */
  readonly sourceType: string
  /** Identity of the originating action within its source domain. */
  readonly sourceId: string
  /** When the fact became true (business time, ISO-8601 UTC instant). */
  readonly effectiveAt: string
  /** When the fact was recorded (ISO-8601 UTC instant). */
  readonly createdAt: string
  /** Spendable balance delta. */
  readonly rewardPointsDelta: number
  /** Lifetime progression delta. */
  readonly xpDelta: number
  /** Windowed earning delta. */
  readonly weeklyPointsDelta: number
  /** Write-side deduplication key; equals `eventId` for deterministic sources. */
  readonly idempotencyKey: string
  readonly metadata: EventMetadataV3
}

interface NonReversalEventV3 extends EventBaseV3 {
  /** Only REVERSAL events may carry a reversal reference. */
  readonly reversalOfEventId?: never
}

export interface TaskApprovedEventV3 extends NonReversalEventV3 {
  readonly eventType: 'TASK_APPROVED'
}

export interface BehaviourPositiveEventV3 extends NonReversalEventV3 {
  readonly eventType: 'BEHAVIOUR_POSITIVE'
}

export interface BehaviourNegativeEventV3 extends NonReversalEventV3 {
  readonly eventType: 'BEHAVIOUR_NEGATIVE'
}

export interface RewardRedeemedEventV3 extends NonReversalEventV3 {
  readonly eventType: 'REWARD_REDEEMED'
}

export interface AvatarUnlockedEventV3 extends NonReversalEventV3 {
  readonly eventType: 'AVATAR_UNLOCKED'
}

export interface ManualAdjustmentEventV3 extends NonReversalEventV3 {
  readonly eventType: 'MANUAL_ADJUSTMENT'
}

export interface DailyGoalAwardedEventV3 extends NonReversalEventV3 {
  readonly eventType: 'DAILY_GOAL_AWARDED'
}

export interface PerfectDayAwardedEventV3 extends NonReversalEventV3 {
  readonly eventType: 'PERFECT_DAY_AWARDED'
}

export interface LegacyBaselineEventV3 extends NonReversalEventV3 {
  readonly eventType: 'LEGACY_BASELINE'
}

export interface WeekRolloverEventV3 extends NonReversalEventV3 {
  readonly eventType: 'WEEK_ROLLOVER'
}

export interface ReversalEventV3 extends EventBaseV3 {
  readonly eventType: 'REVERSAL'
  /** Mandatory: a reversal is never a standalone untraceable correction. */
  readonly reversalOfEventId: string
}

export type GamificationEventV3 =
  | TaskApprovedEventV3
  | BehaviourPositiveEventV3
  | BehaviourNegativeEventV3
  | RewardRedeemedEventV3
  | AvatarUnlockedEventV3
  | ManualAdjustmentEventV3
  | DailyGoalAwardedEventV3
  | PerfectDayAwardedEventV3
  | LegacyBaselineEventV3
  | WeekRolloverEventV3
  | ReversalEventV3

export type DeltaSign = 'positive' | 'negative' | 'zero' | 'any'

export interface DeltaRuleV3 {
  readonly rewardPointsDelta: DeltaSign
  readonly xpDelta: DeltaSign
  readonly weeklyPointsDelta: DeltaSign
}

/**
 * Normative delta matrix.
 *
 * - `positive` means >= 0 (an earning event may legitimately award zero of a currency).
 * - `negative` means <= 0.
 * - `zero` means exactly 0.
 * - `any` permits either direction.
 */
export const DELTA_RULES_V3: Readonly<Record<GamificationEventTypeV3, DeltaRuleV3>> = Object.freeze({
  TASK_APPROVED: { rewardPointsDelta: 'positive', xpDelta: 'positive', weeklyPointsDelta: 'positive' },
  BEHAVIOUR_POSITIVE: { rewardPointsDelta: 'positive', xpDelta: 'positive', weeklyPointsDelta: 'positive' },
  // Approved product contract: negative behaviour never reduces XP or weekly earnings.
  BEHAVIOUR_NEGATIVE: { rewardPointsDelta: 'negative', xpDelta: 'zero', weeklyPointsDelta: 'zero' },
  REWARD_REDEEMED: { rewardPointsDelta: 'negative', xpDelta: 'zero', weeklyPointsDelta: 'zero' },
  AVATAR_UNLOCKED: { rewardPointsDelta: 'negative', xpDelta: 'zero', weeklyPointsDelta: 'zero' },
  MANUAL_ADJUSTMENT: { rewardPointsDelta: 'any', xpDelta: 'zero', weeklyPointsDelta: 'zero' },
  DAILY_GOAL_AWARDED: { rewardPointsDelta: 'positive', xpDelta: 'positive', weeklyPointsDelta: 'positive' },
  PERFECT_DAY_AWARDED: { rewardPointsDelta: 'positive', xpDelta: 'positive', weeklyPointsDelta: 'positive' },
  LEGACY_BASELINE: { rewardPointsDelta: 'positive', xpDelta: 'positive', weeklyPointsDelta: 'positive' },
  WEEK_ROLLOVER: { rewardPointsDelta: 'zero', xpDelta: 'zero', weeklyPointsDelta: 'zero' },
  // A reversal is the only event permitted to reduce XP, and only by referencing a prior event.
  REVERSAL: { rewardPointsDelta: 'any', xpDelta: 'any', weeklyPointsDelta: 'any' },
})

export function isGamificationEventTypeV3(value: unknown): value is GamificationEventTypeV3 {
  return typeof value === 'string' && (GAMIFICATION_V3_EVENT_TYPES as readonly string[]).includes(value)
}
