/**
 * Gamification V4 — deterministic event id derivation (Task 1.2).
 *
 * Pure domain module: no Firestore, no Cloud Functions, no clock access.
 * Same inputs always produce the same id; no randomness. The id is the
 * idempotency anchor that lets a replay rebuild byte-identical state.
 *
 * See docs/gamification-v4-design.md §2.1 and plan Task 1.2.
 */

/** Source id used for the migration baseline event (design §2.1). */
export const MIGRATION_BASELINE_SOURCE_ID = 'BASELINE' as const

/**
 * Deterministic ledger identity for a V4 event.
 *
 * Format: `${familyId}::${memberId}::${eventType}::${sourceId}`
 * The four components fully partition the ledger, so the same logical
 * action always maps to the same id (idempotent replay).
 */
export function eventIdFor(
  familyId: string,
  memberId: string,
  eventType: string,
  sourceId: string,
): string {
  return `${familyId}::${memberId}::${eventType}::${sourceId}`
}

/**
 * Deterministic id for a reversal/refund of an existing event.
 *
 * Appends `::REV` or `::REFUND` to the original event id so the reversal
 * is uniquely and deterministically tied to exactly one original.
 */
export function reversalEventId(originalEventId: string, kind: 'REV' | 'REFUND'): string {
  return `${originalEventId}::${kind}`
}
