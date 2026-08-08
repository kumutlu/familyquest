/**
 * Gamification V4 — projection rebuild from ledger (Task 1.10).
 *
 * Pure domain module: no Firestore, no Cloud Functions, no clock access, no
 * randomness. Rebuilds the authoritative `GamificationStateV4` projection
 * purely from the immutable V4 event ledger.
 *
 * Design constraints (plan Task 1.10):
 *   - `reduceGamificationEventsV4()` is the SOLE state-building algorithm.
 *     There is no second reducer; ordering, level, streak, achievement,
 *     avatar and reversal logic live only in the reducer and its helpers.
 *   - Rebuild is deterministic: same ledger + same ctx → byte-identical
 *     business fields.
 *   - Rebuild never mutates the ledger.
 *   - Duplicate / malformed event identities are rejected through the existing
 *     `assertValidEventV4` validator and the `canonicalOrder` order helper
 *     (which throws on duplicate `eventId`).
 *
 * See docs/gamification-v4-design.md §2.4 and plan Task 1.10.
 */

import type { GamificationEventV4, GamificationStateV4 } from './event'
import { reduceGamificationEventsV4, type ReduceContextV4 } from './reducer'
import { assertValidEventV4 } from './validators'

/**
 * Rebuild a single member's authoritative projection from its event ledger.
 *
 * The ledger is assumed to contain only the events for one member (callers
 * partition the full ledger per member via `rebuildAllMembers`). Each event is
 * validated through the existing `assertValidEventV4` guard; duplicate event
 * identities are rejected inside `reduceGamificationEventsV4` via the canonical
 * order helper. The reducer is then the sole state-building algorithm.
 *
 * Pure: the input `events` array is never mutated.
 */
export function rebuildStateFromLedger(
  events: readonly GamificationEventV4[],
  ctx: ReduceContextV4,
): GamificationStateV4 {
  // Reject malformed events through the existing validator before folding.
  for (const event of events) {
    assertValidEventV4(event)
  }

  // The reducer is the sole state-building algorithm. It canonical-orders the
  // ledger (rejecting duplicate eventId) and folds via the canonical helpers.
  return reduceGamificationEventsV4(events, ctx)
}

/**
 * Rebuild the authoritative projection for every member present in the ledger.
 *
 * The ledger is partitioned by `memberId`; each member's events are rebuilt
 * independently through `rebuildStateFromLedger`. The input ledger is never
 * mutated.
 */
export function rebuildAllMembers(
  ledger: readonly GamificationEventV4[],
  ctx: ReduceContextV4,
): Record<string, GamificationStateV4> {
  const byMember = new Map<string, GamificationEventV4[]>()
  for (const event of ledger) {
    const list = byMember.get(event.memberId)
    if (list === undefined) {
      byMember.set(event.memberId, [event])
    } else {
      list.push(event)
    }
  }

  const result: Record<string, GamificationStateV4> = {}
  for (const [memberId, events] of byMember) {
    result[memberId] = rebuildStateFromLedger(events, ctx)
  }
  return result
}
