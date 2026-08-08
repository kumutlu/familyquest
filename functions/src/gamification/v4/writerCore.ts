/**
 * Gamification V4 — shared authoritative writer core (Stage 7, Tasks 7.2–7.7).
 *
 * This is the Task 7.1 write algorithm (`taskApprovalWriter.applyTaskApprovalV4`)
 * extracted verbatim so that every remaining Stage 7 writer follows the EXACT
 * same architecture instead of re-implementing it:
 *
 *   1. The caller builds ONE canonical, deterministic event (id derived through
 *      `eventIdFor`, validated by `assertValidEventV4`).
 *   2. Probe the deterministic event id — if it already exists, the delivery is
 *      a duplicate and NOTHING is written (no duplicate event, no state rewrite).
 *   3. Write the single event through the Stage 4 repository
 *      (`writeEventIdempotent`) — there is no second persistence path.
 *   4. Re-read the family ledger, rebuild the member projection with the
 *      canonical `rebuildStateFromLedger`, and store it family-scoped at
 *      `families/{familyId}/gamification_state/{memberId}`.
 *
 * There is no arithmetic here: award/charge values are inputs, exactly as they
 * are for the replay pipeline, so there is a single source of truth for values.
 * No legacy rewardPoints / lifetimeXP document is touched and no wallet
 * document is ever referenced.
 *
 * Emulator only: the exported async entry point asserts `assertEmulatorOnly`
 * (pinned by `tools/architecture/v4-cutover-boundary.test.ts`). This module is
 * NOT imported by `functions/src/index.ts`.
 */

import type { Firestore } from 'firebase-admin/firestore'

import {
  readEvent,
  readLedger,
  writeState,
  writeEventIdempotent,
  assertEmulatorOnly,
} from './repository'
import type { GamificationEventV4 } from '../../../../src/domain/gamification/v4/event'
import type { GamificationStateV4 } from '../../../../src/domain/gamification/v4/types'
import { rebuildStateFromLedger } from '../../../../src/domain/gamification/v4/rebuild'
import type { ReduceContextV4 } from '../../../../src/domain/gamification/v4/reducer'

/** Projection engine version stamped by the V4 live writers (matches Task 7.1). */
export const V4_PROJECTION_VERSION = 1

/** Thrown when the facts handed to a V4 writer are unusable. */
export class WriterInputErrorV4 extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WriterInputErrorV4'
  }
}

/** Uniform result shape for every Stage 7 V4 writer. */
export interface WriterResultV4 {
  readonly status: 'processed' | 'duplicate'
  readonly eventId: string
  readonly event: GamificationEventV4
  readonly state: GamificationStateV4 | null
}

/** Assert a value is usable as a single Firestore path segment. */
export function assertSegmentV4(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('/')) {
    throw new WriterInputErrorV4(`${label} must be a non-empty Firestore document ID`)
  }
}

/** Assert a value is a safe integer (deltas may be negative for charges). */
export function assertIntegerV4(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new WriterInputErrorV4(`${label} must be a safe integer`)
  }
}

/** Assert a value is a non-negative safe integer. */
export function assertNonNegativeIntegerV4(value: unknown, label: string): asserts value is number {
  assertIntegerV4(value, label)
  if ((value as number) < 0) {
    throw new WriterInputErrorV4(`${label} must not be negative`)
  }
}

/**
 * Persist ONE canonical V4 event and rebuild the member projection.
 *
 * Duplicate delivery is a NO-OP. Idempotency is structural: the deterministic
 * event id is the Firestore document id.
 */
export async function applyEventV4(
  db: Firestore,
  event: GamificationEventV4,
  options: { readonly timezone?: string } = {},
): Promise<WriterResultV4> {
  assertEmulatorOnly('applyEventV4', { familyId: event?.familyId })

  const existing = await readEvent(db, event.familyId, event.eventId)
  if (existing !== null) {
    return { status: 'duplicate', eventId: event.eventId, event: existing, state: null }
  }

  await writeEventIdempotent(db, event)

  const ledger = await readLedger(db, event.familyId)
  const memberLedger = ledger.filter((e) => e.memberId === event.memberId)

  const ctx: ReduceContextV4 = {
    updatedAt: event.createdAt,
    projectionVersion: V4_PROJECTION_VERSION,
    ...(options.timezone !== undefined ? { timezone: options.timezone } : {}),
  }
  const state = rebuildStateFromLedger(memberLedger, ctx)
  await writeState(db, event.familyId, event.memberId, state)

  return { status: 'processed', eventId: event.eventId, event, state }
}
