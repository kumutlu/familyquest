/**
 * Gamification V4 — authoritative REFUND / REVERSAL writer (Stage 7, Task 7.5).
 *
 * V4 side of the refund/reversal cutover (legacy: the task-invalidation path in
 * `functions/src/gamificationRepository.ts` and the redemption refund /
 * reversal APIs in `src/lib/api.ts` + `reversalApi.ts`). Reached ONLY when the
 * Stage 7 route resolver returns `v4` for the reversing writer
 * (`task_invalidation` for TASK_REVERSED, `reward_redemption` for
 * REWARD_REFUNDED). Not imported by `functions/src/index.ts`, so it can never
 * become a deployed production write path before activation (pinned by
 * `tools/architecture/v4-cutover-boundary.test.ts`).
 *
 * Semantics (docs/gamification-v4-design.md §2.1, §2.4):
 *   - A reversal is an APPEND, never a delete or an edit. The original event
 *     stays in the ledger forever; the reversal negates it.
 *   - Exactly ONE reversal per original: the deltas are derived from the stored
 *     original by the canonical domain builder `buildReversalEvent`, so a
 *     refund can never return more (or less) than was charged.
 *   - `reversalOfEventId` always references exactly one original, which is what
 *     permits `xpDelta < 0` (`assertXpOnlyDecreasesViaReversal`).
 *   - Deterministic event id: `eventIdFor(familyId, memberId, reversalType,
 *     originalSourceId)`. The domain builder's `reversalEventId` suffix form is
 *     NOT used for the document id because the Stage 4 repository requires every
 *     stored id to be `eventIdFor`-derived (`rejectCrossFamily`). Both forms are
 *     one-to-one with the original, so idempotency is identical; this one is
 *     also partition-verifiable.
 *   - Reversing twice is a NO-OP; state is rebuilt by the canonical
 *     `rebuildStateFromLedger` (see `writerCore.applyEventV4`).
 *   - No legacy rewardPoints / lifetimeXP write, no wallet document.
 *
 * Emulator only: every exported async entry point asserts `assertEmulatorOnly`.
 */

import type { Firestore } from 'firebase-admin/firestore'

import { applyEventV4, assertSegmentV4, WriterInputErrorV4, type WriterResultV4 } from './writerCore'
import { assertEmulatorOnly, readEvent } from './repository'
import { eventIdFor } from '../../../../src/domain/gamification/v4/ids'
import type { GamificationEventV4 } from '../../../../src/domain/gamification/v4/event'
import {
  buildReversalEvent,
  type ReversalKindV4,
} from '../../../../src/domain/gamification/v4/reversal'
import { assertValidEventV4 } from '../../../../src/domain/gamification/v4/validators'

/** Thrown when the reversal facts handed to the V4 writer are unusable. */
export class ReversalInputError extends WriterInputErrorV4 {
  constructor(message: string) {
    super(message)
    this.name = 'ReversalInputError'
  }
}

/** Thrown when the event being reversed does not exist in the V4 ledger. */
export class OriginalEventNotFoundError extends Error {
  constructor(readonly eventId: string) {
    super(`original event ${eventId} does not exist in the V4 ledger`)
    this.name = 'OriginalEventNotFoundError'
  }
}

/** Thrown when the target of a reversal is itself a reversal. */
export class NotReversibleError extends Error {
  constructor(readonly eventId: string) {
    super(`event ${eventId} is a reversal and cannot itself be reversed`)
    this.name = 'NotReversibleError'
  }
}

/** The already-validated facts of ONE refund / reversal. */
export interface ReversalFactsV4 {
  readonly familyId: string
  readonly memberId: string
  /** Deterministic id of the event being reversed. */
  readonly originalEventId: string
  /** REV reverses a task approval; REFUND reverses a reward redemption. */
  readonly kind: ReversalKindV4
  /** Human-readable reason recorded in metadata. */
  readonly reason?: string
  /** Optional actor recorded in metadata (audit only). */
  readonly reversedBy?: string
  /** Optional family IANA timezone used for streak day-key resolution. */
  readonly timezone?: string
}

export type ReversalWriteResultV4 = WriterResultV4

/**
 * Build the ONE canonical reversal event for a stored original.
 *
 * Delegates the negation to the canonical domain builder (no second reversal
 * semantic), then re-derives the document id through `eventIdFor` so the Stage 4
 * repository can verify the family partition. Fails closed via
 * `assertValidEventV4`.
 */
export function buildReversalEventV4(
  original: GamificationEventV4,
  facts: ReversalFactsV4,
): GamificationEventV4 {
  if (original.reversalOfEventId !== undefined) {
    throw new NotReversibleError(original.eventId)
  }

  const base = buildReversalEvent(original, facts.kind)
  const event: GamificationEventV4 = {
    ...base,
    eventId: eventIdFor(base.familyId, base.memberId, base.eventType, base.sourceId),
    // Negating 0 yields -0; normalise so the persisted document and every
    // equality assertion see the canonical +0.
    rewardPointsDelta: base.rewardPointsDelta + 0,
    xpDelta: base.xpDelta + 0,
    metadata: {
      ...base.metadata,
      ...(facts.reason !== undefined ? { reason: facts.reason } : {}),
      ...(facts.reversedBy !== undefined ? { reversedBy: facts.reversedBy } : {}),
    },
  }

  assertValidEventV4(event)
  return event
}

/**
 * Apply ONE refund / reversal through the V4 engine.
 *
 * Order of operations:
 *   1. Load the original event — a reversal without an original fails closed.
 *   2. Build the canonical reversal (deltas derived from the stored original).
 *   3. Duplicate probe: reversing twice writes nothing.
 *   4. Append the reversal and rebuild the projection (shared writer core).
 *
 * The original event is NEVER mutated or deleted.
 */
export async function applyReversalV4(
  db: Firestore,
  facts: ReversalFactsV4,
): Promise<ReversalWriteResultV4> {
  assertEmulatorOnly('applyReversalV4', { familyId: facts?.familyId })

  if (facts === null || typeof facts !== 'object') {
    throw new ReversalInputError('reversal facts must be an object')
  }
  assertSegmentV4(facts.familyId, 'familyId')
  assertSegmentV4(facts.memberId, 'memberId')
  if (typeof facts.originalEventId !== 'string' || facts.originalEventId.length === 0) {
    throw new ReversalInputError('originalEventId must be a non-empty string')
  }
  if (facts.kind !== 'REV' && facts.kind !== 'REFUND') {
    throw new ReversalInputError("kind must be 'REV' or 'REFUND'")
  }

  const original = await readEvent(db, facts.familyId, facts.originalEventId)
  if (original === null) {
    throw new OriginalEventNotFoundError(facts.originalEventId)
  }
  if (original.memberId !== facts.memberId) {
    throw new ReversalInputError('originalEventId belongs to a different member')
  }

  const event = buildReversalEventV4(original, facts)
  return applyEventV4(db, event, { timezone: facts.timezone })
}
