/**
 * Gamification V4 — canonical deterministic event ordering (Task 1.4).
 *
 * Pure domain module: no Firestore, no Cloud Functions, no clock access.
 * The projection folds the ledger in this exact order, so the same ledger
 * always rebuilds byte-identical business state.
 *
 * See docs/gamification-v4-design.md §2.1 and plan Task 1.4.
 */

import { type GamificationEventTypeV4 } from './types'
import type { GamificationEventV4 } from './event'
import { ValidationErrorV4 } from './validators'

/**
 * Event-type precedence for canonical ordering. Lower numbers sort first.
 *
 *   baseline (0) → earnings → spending → reversal (last)
 *
 * This is a complete, deterministic total order over event types. Within a
 * group the order is fixed so that, when timestamps are identical, the
 * projection folds events in a reproducible sequence. The ordering guarantees
 * the migration baseline is applied first and that an original event is always
 * folded before its reversal at the same timestamp.
 */
export const EVENT_PRECEDENCE_V4: Readonly<Record<GamificationEventTypeV4, number>> = Object.freeze({
  MIGRATION_BASELINE: 0,
  TASK_APPROVED: 1,
  BEHAVIOUR_POSITIVE: 2,
  DAILY_GOAL_AWARDED: 3,
  PERFECT_DAY_AWARDED: 4,
  AVATAR_UNLOCKED: 5,
  MANUAL_ADJUSTMENT: 6,
  BEHAVIOUR_NEGATIVE: 7,
  REWARD_REDEEMED: 8,
  TASK_REVERSED: 9,
  REWARD_REFUNDED: 10,
})

function precedenceOf(eventType: GamificationEventTypeV4): number {
  const rank = EVENT_PRECEDENCE_V4[eventType]
  // Defensive default: an unknown type (which validators reject) sorts last.
  return rank === undefined ? Number.MAX_SAFE_INTEGER : rank
}

function compareString(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * Return a NEW array of events ordered by the canonical deterministic total
 * order:
 *
 *   1. effectiveAt           (ISO-8601 instant, ascending)
 *   2. createdAt             (ISO-8601 instant, ascending) — tie-breaker
 *   3. event-type precedence (EVENT_PRECEDENCE_V4)         — tie-breaker
 *   4. eventId               (string, ascending)           — final tie-breaker
 *
 * Because `eventId` is deterministic and unique per logical event
 * (`familyId::memberId::eventType::sourceId`), the four keys already form a
 * complete total order for every distinct event — no reliance on JS stable
 * sort and no use of input-array order as a tie-breaker. Identical event
 * identities (duplicate `eventId`) are rejected, since they cannot be
 * distinguished by the canonical tuple and must never reach the projection.
 *
 * The caller's array is never mutated.
 */
export function canonicalOrder(events: readonly GamificationEventV4[]): GamificationEventV4[] {
  const seen = new Set<string>()
  for (const event of events) {
    if (seen.has(event.eventId)) {
      throw new ValidationErrorV4(`duplicate eventId in ledger: ${event.eventId}`)
    }
    seen.add(event.eventId)
  }

  return [...events].sort((a, b) => {
    const byEffective = compareString(a.effectiveAt, b.effectiveAt)
    if (byEffective !== 0) return byEffective

    const byCreated = compareString(a.createdAt, b.createdAt)
    if (byCreated !== 0) return byCreated

    const byPrecedence = precedenceOf(a.eventType) - precedenceOf(b.eventType)
    if (byPrecedence !== 0) return byPrecedence

    return compareString(a.eventId, b.eventId)
  })
}
