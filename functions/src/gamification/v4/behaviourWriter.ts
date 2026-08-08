/**
 * Gamification V4 — authoritative BEHAVIOUR writer (Stage 7, Task 7.2).
 *
 * V4 side of the behaviour cutover (legacy: `functions/src/behaviourRepository.ts`
 * / the client behaviour log write). Reached ONLY when the Stage 7 route
 * resolver returns `v4` for the `behaviour` writer. Not imported by
 * `functions/src/index.ts`, so it can never become a deployed production write
 * path before activation (pinned by `tools/architecture/v4-cutover-boundary.test.ts`).
 *
 * Semantics (docs/gamification-v4-design.md §2.1–§2.4):
 *   - ONE canonical BEHAVIOUR_POSITIVE / BEHAVIOUR_NEGATIVE event per logged
 *     behaviour entry.
 *   - Deterministic event id: `eventIdFor(familyId, memberId, eventType, logId)`
 *     — the same anchor the Stage 2 replay reader derives from a behaviour log
 *     document, so replay and live writes collide by design.
 *   - Negative behaviour never reduces XP (DELTA_RULES_V4: xpDelta must be 0);
 *     it only debits reward points, and the reducer clamps the balance at zero
 *     in exactly one place.
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
  assertNonNegativeIntegerV4,
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

/** Thrown when the behaviour facts handed to the V4 writer are unusable. */
export class BehaviourInputError extends WriterInputErrorV4 {
  constructor(message: string) {
    super(message)
    this.name = 'BehaviourInputError'
  }
}

/** Direction of a logged behaviour entry. */
export type BehaviourDirection = 'positive' | 'negative'

/**
 * The already-validated facts of ONE logged behaviour entry.
 *
 * The V4 writer performs no behaviour selection and no arithmetic: the points
 * value is an input (the behaviour definition's configured points), exactly as
 * it is for the replay pipeline.
 */
export interface BehaviourFactsV4 {
  readonly familyId: string
  readonly memberId: string
  /** Behaviour log document id — the canonical idempotency anchor. */
  readonly logId: string
  /** Behaviour definition id (metadata only). */
  readonly behaviourId: string
  readonly direction: BehaviourDirection
  /** MAGNITUDE of the points effect (>= 0). Sign is derived from `direction`. */
  readonly points: number
  /** XP awarded for a positive behaviour (>= 0). Always 0 when negative. */
  readonly xpAward?: number
  /** Business time of the behaviour (ISO-8601 UTC instant). */
  readonly effectiveAt: string
  /** Write time (ISO-8601 UTC instant). */
  readonly createdAt: string
  /** True only when a fallback points value was used. */
  readonly estimated?: boolean
  /** Optional family IANA timezone used for streak day-key resolution. */
  readonly timezone?: string
}

export type BehaviourWriteResultV4 = WriterResultV4

/**
 * Build the ONE canonical behaviour V4 event.
 *
 * Pure and deterministic: identical facts always produce a byte-identical
 * event, including its id. Fails closed — the event is run through the
 * canonical `assertValidEventV4` guard before it is returned.
 */
export function buildBehaviourEventV4(facts: BehaviourFactsV4): GamificationEventV4 {
  if (facts === null || typeof facts !== 'object') {
    throw new BehaviourInputError('behaviour facts must be an object')
  }
  assertSegmentV4(facts.familyId, 'familyId')
  assertSegmentV4(facts.memberId, 'memberId')
  assertSegmentV4(facts.logId, 'logId')
  assertSegmentV4(facts.behaviourId, 'behaviourId')
  assertNonNegativeIntegerV4(facts.points, 'points')
  if (facts.direction !== 'positive' && facts.direction !== 'negative') {
    throw new BehaviourInputError("direction must be 'positive' or 'negative'")
  }

  const positive = facts.direction === 'positive'
  const eventType = positive ? 'BEHAVIOUR_POSITIVE' : 'BEHAVIOUR_NEGATIVE'

  if (!positive && facts.xpAward !== undefined && facts.xpAward !== 0) {
    // Negative behaviour must never reduce or award XP (DELTA_RULES_V4).
    throw new BehaviourInputError('negative behaviour must not carry an XP award')
  }
  const xpDelta = positive ? (facts.xpAward ?? facts.points) : 0
  assertNonNegativeIntegerV4(xpDelta, 'xpDelta')

  const event: GamificationEventV4 = {
    schemaVersion: GAMIFICATION_V4_SCHEMA_VERSION,
    eventId: eventIdFor(facts.familyId, facts.memberId, eventType, facts.logId),
    familyId: facts.familyId,
    memberId: facts.memberId,
    eventType,
    sourceType: SOURCE_TYPE.BEHAVIOUR,
    sourceId: facts.logId,
    effectiveAt: facts.effectiveAt,
    createdAt: facts.createdAt,
    rewardPointsDelta: positive ? facts.points : -facts.points,
    xpDelta,
    metadata: {
      behaviourId: facts.behaviourId,
      logId: facts.logId,
      direction: facts.direction,
      awardedPoints: positive ? facts.points : -facts.points,
    },
    estimated: facts.estimated === true,
  }

  assertValidEventV4(event)
  return event
}

/**
 * Apply ONE logged behaviour entry through the V4 engine.
 *
 * Delegates persistence + projection rebuild to the shared Task 7.1 writer core
 * (`applyEventV4`): single event write, deterministic id, duplicate delivery is
 * a no-op, and the stored state always equals `rebuildStateFromLedger` over the
 * member's ledger slice.
 */
export async function applyBehaviourV4(
  db: Firestore,
  facts: BehaviourFactsV4,
): Promise<BehaviourWriteResultV4> {
  assertEmulatorOnly('applyBehaviourV4', { familyId: facts?.familyId })
  const event = buildBehaviourEventV4(facts)
  return applyEventV4(db, event, { timezone: facts.timezone })
}
