/**
 * Gamification V4 — event and state validators (Task 1.3).
 *
 * Pure domain module: no Firestore, no Cloud Functions, no clock access.
 * Mirrors the V3 DELTA_RULES contract but for the V4 ledger. Malformed data
 * fails loudly; nothing is ever silently coerced into a valid balance.
 *
 * See docs/gamification-v4-design.md §2.1–§2.4 and plan Task 1.3.
 */

import {
  GAMIFICATION_V4_SCHEMA_VERSION,
  GAMIFICATION_V4_EVENT_TYPES,
  type GamificationEventTypeV4,
  type GamificationStateV4,
} from './types'
import type { GamificationEventV4 } from './event'

export class ValidationErrorV4 extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationErrorV4'
  }
}

export type DeltaSignV4 = 'positive' | 'negative' | 'zero' | 'any'

export interface DeltaRuleV4 {
  readonly rewardPointsDelta: DeltaSignV4
  readonly xpDelta: DeltaSignV4
}

/**
 * Normative delta matrix for V4 event types (mirrors V3 DELTA_RULES).
 *
 * - `positive` means >= 0 (an earning event may legitimately award zero).
 * - `negative` means <= 0.
 * - `zero` means exactly 0.
 * - `any` permits either direction.
 *
 * The only event types permitted to reduce XP are the reversal/refund types,
 * and only when they reference the original event via `reversalOfEventId`.
 */
export const DELTA_RULES_V4: Readonly<Record<GamificationEventTypeV4, DeltaRuleV4>> = Object.freeze({
  TASK_APPROVED: { rewardPointsDelta: 'positive', xpDelta: 'positive' },
  TASK_REVERSED: { rewardPointsDelta: 'any', xpDelta: 'any' },
  BEHAVIOUR_POSITIVE: { rewardPointsDelta: 'positive', xpDelta: 'positive' },
  BEHAVIOUR_NEGATIVE: { rewardPointsDelta: 'negative', xpDelta: 'zero' },
  DAILY_GOAL_AWARDED: { rewardPointsDelta: 'positive', xpDelta: 'positive' },
  PERFECT_DAY_AWARDED: { rewardPointsDelta: 'positive', xpDelta: 'positive' },
  REWARD_REDEEMED: { rewardPointsDelta: 'negative', xpDelta: 'zero' },
  REWARD_REFUNDED: { rewardPointsDelta: 'any', xpDelta: 'any' },
  AVATAR_UNLOCKED: { rewardPointsDelta: 'negative', xpDelta: 'zero' },
  MANUAL_ADJUSTMENT: { rewardPointsDelta: 'any', xpDelta: 'zero' },
  MIGRATION_BASELINE: { rewardPointsDelta: 'positive', xpDelta: 'positive' },
})

/** Event types that are reversals/refunds and must reference an original. */
const REVERSAL_EVENT_TYPES_V4: ReadonlySet<GamificationEventTypeV4> = new Set([
  'TASK_REVERSED',
  'REWARD_REFUNDED',
])

const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/

function assertInstant(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !INSTANT_PATTERN.test(value)) {
    throw new ValidationErrorV4(
      `${label} must be an ISO-8601 UTC instant such as 2026-01-05T10:00:00.000Z`,
    )
  }
  if (Number.isNaN(Date.parse(value))) {
    throw new ValidationErrorV4(`${label} must be a valid instant`)
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationErrorV4(`${label} must be a non-empty string`)
  }
}

function assertSafeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ValidationErrorV4(`${label} must be a safe integer (whole number)`)
  }
}

export function assertNonNegativeRewardPoints(value: unknown, label: string): asserts value is number {
  assertSafeInteger(value, label)
  if ((value as number) < 0) {
    throw new ValidationErrorV4(`${label} must not be negative`)
  }
}

function assertDeltaSign(value: number, sign: DeltaSignV4, label: string, eventType: string): void {
  if (sign === 'zero' && value !== 0) {
    throw new ValidationErrorV4(`${label} must be 0 for ${eventType} events`)
  }
  if (sign === 'positive' && value < 0) {
    throw new ValidationErrorV4(`${label} must not be negative for ${eventType} events`)
  }
  if (sign === 'negative' && value > 0) {
    throw new ValidationErrorV4(`${label} must not be positive for ${eventType} events`)
  }
}

/**
 * XP may only decrease when the event is a reversal/refund that references the
 * original event. This is the authoritative guard against silent XP loss.
 */
export function assertXpOnlyDecreasesViaReversal(event: GamificationEventV4): void {
  if (event.xpDelta < 0 && event.reversalOfEventId === undefined) {
    throw new ValidationErrorV4(
      `xpDelta must not be negative on ${event.eventType} unless reversalOfEventId is set`,
    )
  }
}

export function assertValidEventV4(event: unknown): asserts event is GamificationEventV4 {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) {
    throw new ValidationErrorV4('event must be an object')
  }
  const candidate = event as Record<string, unknown>

  if (candidate.schemaVersion !== GAMIFICATION_V4_SCHEMA_VERSION) {
    throw new ValidationErrorV4(
      `schemaVersion must be ${GAMIFICATION_V4_SCHEMA_VERSION}, received ${String(candidate.schemaVersion)}`,
    )
  }
  if (
    typeof candidate.eventType !== 'string' ||
    !(GAMIFICATION_V4_EVENT_TYPES as readonly string[]).includes(candidate.eventType)
  ) {
    throw new ValidationErrorV4(`eventType is not a known V4 event type: ${String(candidate.eventType)}`)
  }
  assertNonEmptyString(candidate.eventId, 'eventId')
  assertNonEmptyString(candidate.familyId, 'familyId')
  assertNonEmptyString(candidate.memberId, 'memberId')
  assertNonEmptyString(candidate.sourceType, 'sourceType')
  assertNonEmptyString(candidate.sourceId, 'sourceId')
  assertInstant(candidate.effectiveAt, 'effectiveAt')
  assertInstant(candidate.createdAt, 'createdAt')

  if (
    typeof candidate.metadata !== 'object' ||
    candidate.metadata === null ||
    Array.isArray(candidate.metadata)
  ) {
    throw new ValidationErrorV4('metadata must be an object')
  }
  if (typeof candidate.estimated !== 'boolean') {
    throw new ValidationErrorV4('estimated must be a boolean')
  }

  assertSafeInteger(candidate.rewardPointsDelta, 'rewardPointsDelta')
  assertSafeInteger(candidate.xpDelta, 'xpDelta')

  const eventType = candidate.eventType as GamificationEventTypeV4
  const rules = DELTA_RULES_V4[eventType]
  assertDeltaSign(
    candidate.rewardPointsDelta as number,
    rules.rewardPointsDelta,
    'rewardPointsDelta',
    eventType,
  )
  assertDeltaSign(candidate.xpDelta as number, rules.xpDelta, 'xpDelta', eventType)

  if (REVERSAL_EVENT_TYPES_V4.has(eventType)) {
    assertNonEmptyString(candidate.reversalOfEventId, 'reversalOfEventId')
    if (candidate.reversalOfEventId === candidate.eventId) {
      throw new ValidationErrorV4('reversalOfEventId must not reference the reversal itself')
    }
  } else if (candidate.reversalOfEventId !== undefined) {
    throw new ValidationErrorV4(`reversalOfEventId is only permitted on reversal events, not ${eventType}`)
  }

  assertXpOnlyDecreasesViaReversal(candidate as unknown as GamificationEventV4)
}

export function assertValidStateV4(state: unknown): asserts state is GamificationStateV4 {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    throw new ValidationErrorV4('state must be an object')
  }
  const candidate = state as Record<string, unknown>

  assertNonNegativeRewardPoints(candidate.rewardPoints, 'rewardPoints')
  assertNonNegativeRewardPoints(candidate.xpTotal, 'xpTotal')
  assertNonNegativeRewardPoints(candidate.xpProgressInLevel, 'xpProgressInLevel')
  assertNonNegativeRewardPoints(candidate.xpToNextLevel, 'xpToNextLevel')
  assertNonNegativeRewardPoints(candidate.currentStreak, 'currentStreak')
  assertNonNegativeRewardPoints(candidate.bestStreak, 'bestStreak')

  if (!Number.isSafeInteger(candidate.level) || (candidate.level as number) < 1) {
    throw new ValidationErrorV4('level must be an integer of at least 1')
  }
  if (
    !Number.isSafeInteger(candidate.levelProgressPercentage) ||
    (candidate.levelProgressPercentage as number) < 0 ||
    (candidate.levelProgressPercentage as number) > 100
  ) {
    throw new ValidationErrorV4('levelProgressPercentage must be an integer between 0 and 100')
  }
  if (!Number.isSafeInteger(candidate.projectionVersion) || (candidate.projectionVersion as number) < 0) {
    throw new ValidationErrorV4('projectionVersion must be a non-negative integer')
  }

  if (candidate.lastQualifiedDayKey !== null) {
    if (
      typeof candidate.lastQualifiedDayKey !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(candidate.lastQualifiedDayKey)
    ) {
      throw new ValidationErrorV4('lastQualifiedDayKey must be formatted YYYY-MM-DD or null')
    }
  }
  if (candidate.foldedThroughEventId !== null) {
    assertNonEmptyString(candidate.foldedThroughEventId, 'foldedThroughEventId')
  }
  if (!Array.isArray(candidate.unlockedAchievementIds)) {
    throw new ValidationErrorV4('unlockedAchievementIds must be an array')
  }
  if (!Array.isArray(candidate.unlockedAvatarIds)) {
    throw new ValidationErrorV4('unlockedAvatarIds must be an array')
  }
  assertInstant(candidate.updatedAt, 'updatedAt')
}
