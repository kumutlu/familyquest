/**
 * Gamification V4 — authoritative ledger event contract (Task 1.1).
 *
 * Pure domain module: no Firestore, no Cloud Functions, no clock access.
 * See docs/gamification-v4-design.md §2.1.
 */

import {
  type EventMetadataV4,
  GAMIFICATION_V4_SCHEMA_VERSION,
  type GamificationEventTypeV4,
} from './types'

export interface GamificationEventV4 {
  /** V4 schema constant. */
  readonly schemaVersion: typeof GAMIFICATION_V4_SCHEMA_VERSION
  /** Deterministic ledger identity — see ids.ts (Task 1.2). */
  readonly eventId: string
  /** Partition key. */
  readonly familyId: string
  /** Target member. */
  readonly memberId: string
  /** One of GAMIFICATION_V4_EVENT_TYPES. */
  readonly eventType: GamificationEventTypeV4
  /** Domain of the originating action, e.g. `task_completion`. */
  readonly sourceType: string
  /** Idempotency anchor, e.g. `task-1#2026-01-05`. */
  readonly sourceId: string
  /** When the effect applies (business time, ISO-8601 UTC instant). */
  readonly effectiveAt: string
  /** When the event was written (ISO-8601 UTC instant). */
  readonly createdAt: string
  /** May be negative; never drives state below 0. */
  readonly rewardPointsDelta: number
  /** Positive except reversals. */
  readonly xpDelta: number
  /** effectSnapshot, awardedPoints, reason, classification, etc. */
  readonly metadata: EventMetadataV4
  /** true when fallback reward selection used. */
  readonly estimated: boolean
  /** Present iff this event is a reversal/refund of another event. */
  readonly reversalOfEventId?: string
}
