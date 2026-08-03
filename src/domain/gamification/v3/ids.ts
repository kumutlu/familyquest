import { ValidationErrorV3 } from './validators'

/**
 * Deterministic V3 ledger identity.
 *
 * The same source action must always resolve to the same event id, so replay,
 * retry and backfill can never create a duplicate award. Random identifiers are
 * never used for ledger identity.
 */

/** Identity segments may not contain the separator or whitespace. */
const ILLEGAL_SEGMENT = /[:\s/]/

export function assertIdSegment(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationErrorV3(`${label} must be a non-empty string`)
  }
  if (ILLEGAL_SEGMENT.test(value)) {
    throw new ValidationErrorV3(`${label} must not contain ':', '/' or whitespace`)
  }
}

/** Composite keys (for example `taskId#dayKey`) may contain '#' but not ':'. */
function assertLogicalKey(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationErrorV3(`${label} must be a non-empty string`)
  }
  if (/[\s/]/.test(value)) {
    throw new ValidationErrorV3(`${label} must not contain '/' or whitespace`)
  }
}

export function taskApprovedEventId(familyId: string, memberId: string, logicalCompletionKey: string): string {
  assertIdSegment(familyId, 'familyId')
  assertIdSegment(memberId, 'memberId')
  assertLogicalKey(logicalCompletionKey, 'logicalCompletionKey')
  return `task-approved:${familyId}:${memberId}:${logicalCompletionKey}`
}

export function behaviourEventId(familyId: string, memberId: string, behaviourEventKey: string): string {
  assertIdSegment(familyId, 'familyId')
  assertIdSegment(memberId, 'memberId')
  assertIdSegment(behaviourEventKey, 'behaviourEventId')
  return `behaviour:${familyId}:${memberId}:${behaviourEventKey}`
}

export function rewardRedeemedEventId(familyId: string, memberId: string, redemptionId: string): string {
  assertIdSegment(familyId, 'familyId')
  assertIdSegment(memberId, 'memberId')
  assertIdSegment(redemptionId, 'redemptionId')
  return `reward-redeemed:${familyId}:${memberId}:${redemptionId}`
}

export function avatarUnlockedEventId(familyId: string, memberId: string, avatarId: string): string {
  assertIdSegment(familyId, 'familyId')
  assertIdSegment(memberId, 'memberId')
  assertIdSegment(avatarId, 'avatarId')
  return `avatar-unlocked:${familyId}:${memberId}:${avatarId}`
}

export function manualAdjustmentEventId(familyId: string, memberId: string, adjustmentId: string): string {
  assertIdSegment(familyId, 'familyId')
  assertIdSegment(memberId, 'memberId')
  assertIdSegment(adjustmentId, 'adjustmentId')
  return `manual-adjustment:${familyId}:${memberId}:${adjustmentId}`
}

export function dailyGoalEventId(familyId: string, memberId: string, dayKey: string): string {
  assertIdSegment(familyId, 'familyId')
  assertIdSegment(memberId, 'memberId')
  assertIdSegment(dayKey, 'dayKey')
  return `daily-goal:${familyId}:${memberId}:${dayKey}`
}

export function perfectDayEventId(familyId: string, memberId: string, dayKey: string): string {
  assertIdSegment(familyId, 'familyId')
  assertIdSegment(memberId, 'memberId')
  assertIdSegment(dayKey, 'dayKey')
  return `perfect-day:${familyId}:${memberId}:${dayKey}`
}

export function legacyBaselineEventId(familyId: string, memberId: string): string {
  assertIdSegment(familyId, 'familyId')
  assertIdSegment(memberId, 'memberId')
  return `legacy-baseline:${familyId}:${memberId}:v3`
}

export function weekRolloverEventId(familyId: string, memberId: string, weeklyWindowKey: string): string {
  assertIdSegment(familyId, 'familyId')
  assertIdSegment(memberId, 'memberId')
  assertIdSegment(weeklyWindowKey, 'weeklyWindowKey')
  return `week-rollover:${familyId}:${memberId}:${weeklyWindowKey}`
}

export function reversalEventId(originalEventId: string, reversalId: string): string {
  assertLogicalKey(originalEventId, 'originalEventId')
  assertIdSegment(reversalId, 'reversalId')
  return `reversal:${originalEventId}:${reversalId}`
}
