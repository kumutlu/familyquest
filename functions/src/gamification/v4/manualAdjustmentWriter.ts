/**
 * Gamification V4 — authoritative MANUAL_ADJUSTMENT writer (Stage 7, Task 7.7).
 *
 * V4 side of the manual-adjustment / challenge-claim cutover (legacy: the
 * parent "adjust points" and `claimChallenge` paths in `src/lib/api.ts`).
 * Reached ONLY when the Stage 7 route resolver returns `v4` for the
 * `challenge_claim` writer. Not imported by `functions/src/index.ts`, so it can
 * never become a deployed production write path before activation (pinned by
 * `tools/architecture/v4-cutover-boundary.test.ts`).
 *
 * Semantics (docs/gamification-v4-design.md §2.1–§2.4):
 *   - ONE canonical MANUAL_ADJUSTMENT event per adjustment record. The
 *     adjustment id (the audit record the parent action creates) IS the
 *     idempotency anchor, so a double-tap can never double-adjust.
 *   - Deterministic event id: `eventIdFor(familyId, memberId,
 *     'MANUAL_ADJUSTMENT', adjustmentId)`.
 *   - `rewardPointsDelta` may be POSITIVE or NEGATIVE (a grant or a deduction),
 *     but `xpDelta` is ALWAYS 0 (DELTA_RULES_V4): a manual points change must
 *     never rewrite lifetime progression, and XP may only ever decrease through
 *     an explicit reversal.
 *   - An adjustment requires a non-empty `reason`: manual balance changes are
 *     always auditable.
 *   - A deduction never drives the balance below zero (the reducer clamps in
 *     exactly one place); a deduction larger than the balance is accepted as a
 *     ledger fact and clamped, matching the legacy behaviour.
 *   - Duplicate delivery is a NO-OP; state is rebuilt by the canonical
 *     `rebuildStateFromLedger` (see `writerCore.applyEventV4`).
 *   - No legacy rewardPoints / lifetimeXP write, no wallet document.
 *
 * Emulator only: every exported async entry point asserts `assertEmulatorOnly`.
 */

import type { Firestore } from 'firebase-admin/firestore'

import {
  applyEventV4,
  assertSegmentV4,
  assertIntegerV4,
  WriterInputErrorV4,
  type WriterResultV4,
} from './writerCore'
import { assertEmulatorOnly } from './repository'
import { eventIdFor } from '../../../../src/domain/gamification/v4/ids'
import {
  GAMIFICATION_V4_SCHEMA_VERSION,
  SOURCE_TYPE,
} from '../../../../src/domain/gamification/v4/types'
import type { GamificationEventV4 } from '../../../../src/domain/gamification/v4/event'
import { assertValidEventV4 } from '../../../../src/domain/gamification/v4/validators'

/** Thrown when the adjustment facts handed to the V4 writer are unusable. */
export class ManualAdjustmentInputError extends WriterInputErrorV4 {
  constructor(message: string) {
    super(message)
    this.name = 'ManualAdjustmentInputError'
  }
}

/** The already-validated facts of ONE manual points adjustment. */
export interface ManualAdjustmentFactsV4 {
  readonly familyId: string
  readonly memberId: string
  /** Adjustment / claim record id — the canonical idempotency anchor. */
  readonly adjustmentId: string
  /** Signed points delta: positive grants, negative deducts. Never 0. */
  readonly rewardPointsDelta: number
  /** Mandatory audit reason. */
  readonly reason: string
  /** Optional actor recorded in metadata (audit only). */
  readonly adjustedBy?: string
  /** Business time of the adjustment (ISO-8601 UTC instant). */
  readonly effectiveAt: string
  /** Write time (ISO-8601 UTC instant). */
  readonly createdAt: string
  /** Optional family IANA timezone used for streak day-key resolution. */
  readonly timezone?: string
}

export type ManualAdjustmentWriteResultV4 = WriterResultV4

/**
 * Build the ONE canonical MANUAL_ADJUSTMENT V4 event.
 *
 * Pure and deterministic; fails closed via `assertValidEventV4`.
 */
export function buildManualAdjustmentEventV4(
  facts: ManualAdjustmentFactsV4,
): GamificationEventV4 {
  if (facts === null || typeof facts !== 'object') {
    throw new ManualAdjustmentInputError('manual adjustment facts must be an object')
  }
  assertSegmentV4(facts.familyId, 'familyId')
  assertSegmentV4(facts.memberId, 'memberId')
  assertSegmentV4(facts.adjustmentId, 'adjustmentId')
  assertIntegerV4(facts.rewardPointsDelta, 'rewardPointsDelta')
  if (facts.rewardPointsDelta === 0) {
    throw new ManualAdjustmentInputError('rewardPointsDelta must not be 0: a no-op is not a ledger fact')
  }
  if (typeof facts.reason !== 'string' || facts.reason.trim().length === 0) {
    throw new ManualAdjustmentInputError('reason is mandatory for a manual adjustment')
  }

  const event: GamificationEventV4 = {
    schemaVersion: GAMIFICATION_V4_SCHEMA_VERSION,
    eventId: eventIdFor(facts.familyId, facts.memberId, 'MANUAL_ADJUSTMENT', facts.adjustmentId),
    familyId: facts.familyId,
    memberId: facts.memberId,
    eventType: 'MANUAL_ADJUSTMENT',
    sourceType: SOURCE_TYPE.MANUAL,
    sourceId: facts.adjustmentId,
    effectiveAt: facts.effectiveAt,
    createdAt: facts.createdAt,
    rewardPointsDelta: facts.rewardPointsDelta,
    // A manual points change never rewrites lifetime progression.
    xpDelta: 0,
    metadata: {
      adjustmentId: facts.adjustmentId,
      reason: facts.reason,
      ...(facts.adjustedBy !== undefined ? { adjustedBy: facts.adjustedBy } : {}),
    },
    // A manual adjustment is an explicit human decision, never an estimate.
    estimated: false,
  }

  assertValidEventV4(event)
  return event
}

/**
 * Apply ONE manual adjustment through the V4 engine.
 *
 * Delegates persistence + projection rebuild to the shared Task 7.1 writer core:
 * single event write, deterministic id, duplicate delivery is a no-op, and the
 * stored state always equals `rebuildStateFromLedger` over the member's slice.
 */
export async function applyManualAdjustmentV4(
  db: Firestore,
  facts: ManualAdjustmentFactsV4,
): Promise<ManualAdjustmentWriteResultV4> {
  assertEmulatorOnly('applyManualAdjustmentV4', { familyId: facts?.familyId })
  const event = buildManualAdjustmentEventV4(facts)
  return applyEventV4(db, event, { timezone: facts.timezone })
}
