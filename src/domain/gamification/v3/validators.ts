import {
  DELTA_RULES_V3,
  GAMIFICATION_V3_SCHEMA_VERSION,
  isGamificationEventTypeV3,
  type DeltaSign,
  type GamificationEventV3,
} from './event'
import { STATE_V3_FIELDS, type GamificationStateV3 } from './state'

/**
 * Strict runtime validation for the V3 contract.
 *
 * Malformed data fails loudly. Nothing is ever silently coerced into a valid
 * balance: an invalid ledger is a bug to be surfaced, not a number to invent.
 */
export class ValidationErrorV3 extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationErrorV3'
  }
}

const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function assertInstant(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !INSTANT_PATTERN.test(value)) {
    throw new ValidationErrorV3(`${label} must be an ISO-8601 UTC instant such as 2026-01-05T10:00:00.000Z`)
  }
  if (Number.isNaN(Date.parse(value))) {
    throw new ValidationErrorV3(`${label} must be a valid instant`)
  }
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationErrorV3(`${label} must be a non-empty string`)
  }
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new ValidationErrorV3(`${label} must match ${IDENTIFIER_PATTERN.source}`)
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationErrorV3(`${label} must be a non-empty string`)
  }
}

function assertSafeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ValidationErrorV3(`${label} must be a safe integer (whole number)`)
  }
}

export function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  assertSafeInteger(value, label)
  if ((value as number) < 0) {
    throw new ValidationErrorV3(`${label} must not be negative`)
  }
}

function assertDeltaSign(value: number, sign: DeltaSign, label: string, eventType: string): void {
  if (sign === 'zero' && value !== 0) {
    throw new ValidationErrorV3(`${label} must be 0 for ${eventType} events`)
  }
  if (sign === 'positive' && value < 0) {
    throw new ValidationErrorV3(`${label} must not be negative for ${eventType} events`)
  }
  if (sign === 'negative' && value > 0) {
    throw new ValidationErrorV3(`${label} must not be positive for ${eventType} events`)
  }
}

export function assertValidEventV3(event: unknown): asserts event is GamificationEventV3 {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) {
    throw new ValidationErrorV3('event must be an object')
  }
  const candidate = event as Record<string, unknown>

  if (candidate.schemaVersion !== GAMIFICATION_V3_SCHEMA_VERSION) {
    throw new ValidationErrorV3(
      `schemaVersion must be ${GAMIFICATION_V3_SCHEMA_VERSION}, received ${String(candidate.schemaVersion)}`,
    )
  }
  if (!isGamificationEventTypeV3(candidate.eventType)) {
    throw new ValidationErrorV3(`eventType is not a known V3 event type: ${String(candidate.eventType)}`)
  }
  assertNonEmptyString(candidate.eventId, 'eventId')
  assertIdentifier(candidate.familyId, 'familyId')
  assertIdentifier(candidate.memberId, 'memberId')
  assertNonEmptyString(candidate.sourceType, 'sourceType')
  assertNonEmptyString(candidate.sourceId, 'sourceId')
  assertInstant(candidate.effectiveAt, 'effectiveAt')
  assertInstant(candidate.createdAt, 'createdAt')
  assertNonEmptyString(candidate.idempotencyKey, 'idempotencyKey')

  if (
    typeof candidate.metadata !== 'object' ||
    candidate.metadata === null ||
    Array.isArray(candidate.metadata)
  ) {
    throw new ValidationErrorV3('metadata must be an object')
  }

  assertSafeInteger(candidate.rewardPointsDelta, 'rewardPointsDelta')
  assertSafeInteger(candidate.xpDelta, 'xpDelta')
  assertSafeInteger(candidate.weeklyPointsDelta, 'weeklyPointsDelta')

  const eventType = candidate.eventType
  const rules = DELTA_RULES_V3[eventType]
  assertDeltaSign(candidate.rewardPointsDelta as number, rules.rewardPointsDelta, 'rewardPointsDelta', eventType)
  assertDeltaSign(candidate.xpDelta as number, rules.xpDelta, 'xpDelta', eventType)
  assertDeltaSign(candidate.weeklyPointsDelta as number, rules.weeklyPointsDelta, 'weeklyPointsDelta', eventType)

  if (eventType === 'REVERSAL') {
    assertNonEmptyString(candidate.reversalOfEventId, 'reversalOfEventId')
    if (candidate.reversalOfEventId === candidate.eventId) {
      throw new ValidationErrorV3('reversalOfEventId must not reference the reversal itself')
    }
  } else if (candidate.reversalOfEventId !== undefined) {
    throw new ValidationErrorV3(`reversalOfEventId is only permitted on REVERSAL events, not ${eventType}`)
  }

  assertEventMetadataV3(candidate as unknown as GamificationEventV3)
}

/** Event-type-specific metadata requirements. */
export function assertEventMetadataV3(event: GamificationEventV3): void {
  const metadata = event.metadata as Record<string, unknown>
  switch (event.eventType) {
    case 'AVATAR_UNLOCKED':
      assertNonEmptyString(metadata.avatarId, 'metadata.avatarId')
      break
    case 'MANUAL_ADJUSTMENT':
      assertNonEmptyString(metadata.reason, 'metadata.reason')
      if (metadata.clampToZero !== undefined && typeof metadata.clampToZero !== 'boolean') {
        throw new ValidationErrorV3('metadata.clampToZero must be a boolean when present')
      }
      break
    case 'DAILY_GOAL_AWARDED':
    case 'PERFECT_DAY_AWARDED':
      assertDayKey(metadata.dayKey, 'metadata.dayKey')
      break
    case 'WEEK_ROLLOVER':
      assertNonEmptyString(metadata.weeklyWindowKey, 'metadata.weeklyWindowKey')
      break
    default:
      break
  }
}

export function assertDayKey(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationErrorV3(`${label} must be formatted YYYY-MM-DD`)
  }
}

export function assertUniqueEventIds(events: readonly GamificationEventV3[]): void {
  const seen = new Set<string>()
  for (const event of events) {
    if (seen.has(event.eventId)) {
      throw new ValidationErrorV3(`duplicate event identity detected: ${event.eventId}`)
    }
    seen.add(event.eventId)
  }
}

export function assertValidStateV3(state: unknown): asserts state is GamificationStateV3 {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    throw new ValidationErrorV3('state must be an object')
  }
  const candidate = state as Record<string, unknown>

  for (const field of STATE_V3_FIELDS) {
    if (!(field in candidate)) {
      throw new ValidationErrorV3(`state is missing required field ${field}`)
    }
  }

  assertIdentifier(candidate.familyId, 'familyId')
  assertIdentifier(candidate.memberId, 'memberId')
  assertNonNegativeInteger(candidate.rewardPoints, 'rewardPoints')
  assertNonNegativeInteger(candidate.xpTotal, 'xpTotal')
  assertNonNegativeInteger(candidate.weeklyPoints, 'weeklyPoints')
  assertNonNegativeInteger(candidate.currentStreak, 'currentStreak')
  assertNonNegativeInteger(candidate.bestStreak, 'bestStreak')
  assertNonNegativeInteger(candidate.xpProgressInLevel, 'xpProgressInLevel')
  assertNonNegativeInteger(candidate.xpToNextLevel, 'xpToNextLevel')
  assertNonNegativeInteger(candidate.levelProgressPercentage, 'levelProgressPercentage')
  assertNonNegativeInteger(candidate.projectionVersion, 'projectionVersion')

  if (!Number.isSafeInteger(candidate.level) || (candidate.level as number) < 1) {
    throw new ValidationErrorV3('level must be an integer of at least 1')
  }
  if ((candidate.levelProgressPercentage as number) > 100) {
    throw new ValidationErrorV3('levelProgressPercentage must be between 0 and 100')
  }
  assertNonEmptyString(candidate.weeklyWindowKey, 'weeklyWindowKey')
  if (candidate.lastQualifiedDayKey !== null) {
    assertDayKey(candidate.lastQualifiedDayKey, 'lastQualifiedDayKey')
  }
  if (candidate.foldedThroughEventId !== null) {
    assertNonEmptyString(candidate.foldedThroughEventId, 'foldedThroughEventId')
  }
  if (!Array.isArray(candidate.unlockedAvatarIds)) {
    throw new ValidationErrorV3('unlockedAvatarIds must be an array')
  }
  assertInstant(candidate.updatedAt, 'updatedAt')
}
