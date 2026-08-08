/**
 * Gamification V4 — reversal event construction (Task 1.8).
 *
 * Pure domain module: no Firestore, no Cloud Functions, no clock access.
 * Builds a deterministic reversal/refund event that negates exactly one
 * original ledger event. See docs/gamification-v4-design.md §2.1 and plan
 * Task 1.8.
 */

import {
  GAMIFICATION_V4_SCHEMA_VERSION,
  SOURCE_TYPE,
  type GamificationEventV4,
  type GamificationEventTypeV4,
} from './types'
import { reversalEventId } from './ids'

/** Reversal kinds: REV reverses a task approval; REFUND reverses a redemption. */
export type ReversalKindV4 = 'REV' | 'REFUND'

const REVERSAL_EVENT_TYPE: Readonly<Record<ReversalKindV4, GamificationEventTypeV4>> = Object.freeze({
  REV: 'TASK_REVERSED',
  REFUND: 'REWARD_REFUNDED',
})

/**
 * Build a deterministic reversal event that negates exactly one original.
 *
 * The returned event has:
 * - `eventType` mapped from `kind` (REV → TASK_REVERSED, REFUND → REWARD_REFUNDED)
 * - `rewardPointsDelta` and `xpDelta` negated from the original
 * - `reversalOfEventId` set to the original's eventId (exactly one original)
 * - `eventId` derived via `reversalEventId(original.eventId, kind)` (idempotent)
 *
 * The caller's `original` is never mutated. Timestamps are copied from the
 * original because this module has no clock access; the reversal is anchored
 * to the original's business time for deterministic replay.
 */
export function buildReversalEvent(
  original: GamificationEventV4,
  kind: ReversalKindV4,
): GamificationEventV4 {
  const eventType = REVERSAL_EVENT_TYPE[kind]
  return {
    schemaVersion: GAMIFICATION_V4_SCHEMA_VERSION,
    eventId: reversalEventId(original.eventId, kind),
    familyId: original.familyId,
    memberId: original.memberId,
    eventType,
    sourceType: SOURCE_TYPE.REVERSAL,
    sourceId: original.sourceId,
    effectiveAt: original.effectiveAt,
    createdAt: original.createdAt,
    rewardPointsDelta: -original.rewardPointsDelta,
    xpDelta: -original.xpDelta,
    metadata: {
      reason: 'reversal',
      originalEventId: original.eventId,
      originalEventType: original.eventType,
    },
    estimated: false,
    reversalOfEventId: original.eventId,
  }
}

/**
 * True iff `event` is a reversal of the event identified by `originalEventId`.
 * A reversal references exactly one original via `reversalOfEventId`.
 */
export function isReversalOf(event: GamificationEventV4, originalEventId: string): boolean {
  return event.reversalOfEventId === originalEventId
}
