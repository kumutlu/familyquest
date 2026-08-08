/**
 * Gamification V4 — authoritative TASK_APPROVED writer (Stage 7, Task 7.1).
 *
 * This is the V4 side of the task-approval cutover. It is reached ONLY when the
 * Stage 7 route resolver returns `v4` for the `task_approval` writer. It is not
 * imported by `functions/src/index.ts`, so it can never become a deployed
 * production write path before activation (pinned by
 * `tools/architecture/v4-cutover-boundary.test.ts`).
 *
 * Semantics (docs/gamification-v4-design.md §2.1–§2.4):
 *   - ONE canonical TASK_APPROVED event per approved completion.
 *   - Deterministic event id: `eventIdFor(familyId, memberId, 'TASK_APPROVED',
 *     completionId)` — the same anchor the Stage 2 replay reader derives from a
 *     task completion document, so replay and live writes collide by design.
 *   - Written through the Stage 4 repository (`writeEventIdempotent`) — there is
 *     no second persistence path.
 *   - State is rebuilt with the canonical `rebuildStateFromLedger` over the
 *     member's slice of the family ledger and stored family-scoped at
 *     `families/{familyId}/gamification_state/{memberId}`. There is no second
 *     arithmetic path: this module never adds points or XP itself.
 *   - Duplicate delivery is a NO-OP: if the deterministic event id already
 *     exists, nothing is written (no duplicate event, no state rewrite).
 *   - No legacy rewardPoints / lifetimeXP write happens on this path, and no
 *     wallet document is ever referenced.
 *
 * Emulator only: every exported async entry point asserts `assertEmulatorOnly`.
 */

import type { Firestore } from 'firebase-admin/firestore'

import {
  readEvent,
  readLedger,
  writeState,
  writeEventIdempotent,
  assertEmulatorOnly,
} from './repository'
import { eventIdFor } from '../../../../src/domain/gamification/v4/ids'
import {
  GAMIFICATION_V4_SCHEMA_VERSION,
  SOURCE_TYPE,
  type GamificationStateV4,
} from '../../../../src/domain/gamification/v4/types'
import type { GamificationEventV4 } from '../../../../src/domain/gamification/v4/event'
import { assertValidEventV4 } from '../../../../src/domain/gamification/v4/validators'
import {
  rebuildStateFromLedger,
} from '../../../../src/domain/gamification/v4/rebuild'
import type { ReduceContextV4 } from '../../../../src/domain/gamification/v4/reducer'

/** Projection engine version stamped by the V4 live writers. */
export const V4_PROJECTION_VERSION = 1

/** Thrown when the approval facts handed to the V4 writer are unusable. */
export class TaskApprovalInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaskApprovalInputError'
  }
}

/**
 * The already-validated facts of ONE approved task completion.
 *
 * The V4 writer performs no reward selection and no XP arithmetic: the awarding
 * decision is an input, exactly as it is for the replay pipeline. This keeps a
 * single source of truth for award values.
 */
export interface TaskApprovalFactsV4 {
  readonly familyId: string
  readonly memberId: string
  /** Completion document id — the canonical idempotency anchor. */
  readonly completionId: string
  /** Task definition id (metadata only). */
  readonly taskId: string
  /** Reward-points delta for this approval (>= 0). */
  readonly rewardPointsDelta: number
  /** XP delta for this approval (>= 0). */
  readonly xpDelta: number
  /** Business time of the approval (ISO-8601 UTC instant). */
  readonly effectiveAt: string
  /** Write time of the approval (ISO-8601 UTC instant). */
  readonly createdAt: string
  /** True only when a fallback reward value was used. */
  readonly estimated?: boolean
  /** Optional family IANA timezone used for streak day-key resolution. */
  readonly timezone?: string
}

export interface TaskApprovalWriteResultV4 {
  readonly status: 'processed' | 'duplicate'
  readonly eventId: string
  readonly event: GamificationEventV4
  readonly state: GamificationStateV4 | null
}

function assertSegment(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('/')) {
    throw new TaskApprovalInputError(`${label} must be a non-empty Firestore document ID`)
  }
}

/**
 * Build the ONE canonical TASK_APPROVED V4 event for an approved completion.
 *
 * Pure and deterministic: identical facts always produce a byte-identical
 * event, including its id. Fails closed on malformed input — the event is run
 * through the canonical `assertValidEventV4` guard before it is returned, so a
 * malformed approval can never reach Firestore.
 */
export function buildTaskApprovedEventV4(facts: TaskApprovalFactsV4): GamificationEventV4 {
  if (facts === null || typeof facts !== 'object') {
    throw new TaskApprovalInputError('task approval facts must be an object')
  }
  assertSegment(facts.familyId, 'familyId')
  assertSegment(facts.memberId, 'memberId')
  assertSegment(facts.completionId, 'completionId')

  const event: GamificationEventV4 = {
    schemaVersion: GAMIFICATION_V4_SCHEMA_VERSION,
    eventId: eventIdFor(facts.familyId, facts.memberId, 'TASK_APPROVED', facts.completionId),
    familyId: facts.familyId,
    memberId: facts.memberId,
    eventType: 'TASK_APPROVED',
    sourceType: SOURCE_TYPE.TASK_COMPLETION,
    sourceId: facts.completionId,
    effectiveAt: facts.effectiveAt,
    createdAt: facts.createdAt,
    rewardPointsDelta: facts.rewardPointsDelta,
    xpDelta: facts.xpDelta,
    metadata: {
      taskId: facts.taskId,
      completionId: facts.completionId,
      awardedPoints: facts.rewardPointsDelta,
    },
    estimated: facts.estimated === true,
  }

  // Canonical validator: malformed approvals fail closed before any write.
  assertValidEventV4(event)
  return event
}

/**
 * Apply ONE approved task completion through the V4 engine.
 *
 * Order of operations:
 *   1. Build the canonical event (fails closed on malformed input).
 *   2. Probe the deterministic event id — if it already exists, return
 *      `duplicate` and write NOTHING (duplicate delivery is a no-op).
 *   3. Write the single event through the Stage 4 repository.
 *   4. Re-read the family ledger, rebuild the member projection with the
 *      canonical `rebuildStateFromLedger`, and store it family-scoped.
 *
 * The legacy rewardPoints / lifetimeXP documents are never touched here, and no
 * wallet path is referenced.
 */
export async function applyTaskApprovalV4(
  db: Firestore,
  facts: TaskApprovalFactsV4,
): Promise<TaskApprovalWriteResultV4> {
  assertEmulatorOnly('applyTaskApprovalV4', { familyId: facts?.familyId })

  const event = buildTaskApprovedEventV4(facts)

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
    ...(facts.timezone !== undefined ? { timezone: facts.timezone } : {}),
  }
  const state = rebuildStateFromLedger(memberLedger, ctx)
  await writeState(db, event.familyId, event.memberId, state)

  return { status: 'processed', eventId: event.eventId, event, state }
}
