/**
 * V3 shadow integration for server-authoritative flows.
 *
 * Amendment 4: If the V3 event/projection write fails, the entire
 * authoritative transaction must fail. These functions use transaction.set()
 * so that V3 writes are atomic with legacy writes.
 *
 * TEMPORARY BRIDGE (amendment 1): This module is the Phase 2 bridge for
 * server-authoritative Option A flows. Phase 3 must move trigger-backed
 * flows to server-authoritative callable/transaction paths.
 */
import { type Transaction, type DocumentReference } from 'firebase-admin/firestore'
import { type GamificationEventV3 } from '../../../src/domain/gamification/v3/event'
import { type GamificationStateV3 } from '../../../src/domain/gamification/v3/state'
import {
  eventDocPath,
  stateDocPath,
  serialiseEventV3,
  serialiseStateV3,
} from '../../../src/domain/gamification/v3/storage'
import { reduceGamificationEventsV3, type ReducerContextV3 } from '../../../src/domain/gamification/v3/reducer'
import { type WeeklyContextV3 } from '../../../src/domain/gamification/v3/weeklyWindow'

/**
 * Error thrown when a V3 baseline is required but missing.
 */
export class BaselineMissingErrorV3 extends Error {
  constructor(
    readonly familyId: string,
    readonly memberId: string,
  ) {
    super(`V3 baseline missing for member ${memberId} in family ${familyId}`)
    this.name = 'BaselineMissingErrorV3'
  }
}

/**
 * A fully-computed V3 shadow write, ready to be applied with no further reads.
 *
 * Produced by {@link readV3ShadowState} during the transaction READ phase and
 * consumed by {@link applyV3Shadow} during the WRITE phase.
 */
export interface PreparedV3Shadow {
  readonly eventRef: DocumentReference
  readonly stateRef: DocumentReference
  readonly event: GamificationEventV3
  readonly state: GamificationStateV3
}

/**
 * READ PHASE — read every V3 shadow document and compute the resulting
 * projection, WITHOUT issuing any write.
 *
 * Firestore requires all reads in a transaction to precede all writes; issuing
 * a `transaction.get()` after a write aborts the ENTIRE transaction with
 * "Firestore transactions require all reads to be executed before all writes."
 * That previously discarded the authoritative rewardPoints/summary writes while
 * the completion still looked approved, so callers MUST invoke this before
 * queueing any write and then call {@link applyV3Shadow} afterwards.
 *
 * @returns the prepared shadow write, or `undefined` when the event already
 *          exists (idempotent duplicate — nothing to write).
 * @throws BaselineMissingErrorV3 when a non-baseline event has no projection.
 */
export async function readV3ShadowState(
  transaction: Transaction,
  docRef: (path: string) => DocumentReference,
  input: {
    readonly familyId: string
    readonly memberId: string
    readonly event: GamificationEventV3
    readonly weeklyContext: WeeklyContextV3
    readonly asOf: string
    /**
     * Fold this event onto an already-prepared projection instead of the stored
     * one. Required when a single transaction prepares several shadow events for
     * the same member: `transaction.get()` never observes the transaction's own
     * pending writes, so without chaining the second event would be folded onto
     * a stale projection and overwrite the first one's deltas.
     */
    readonly baseState?: GamificationStateV3
  },
): Promise<PreparedV3Shadow | undefined> {
  const { familyId, memberId, event, weeklyContext, asOf, baseState } = input

  // 1. Check idempotency: read existing V3 event
  const eventRef = docRef(eventDocPath(familyId, event.eventId))
  const existingEventDoc = await transaction.get(eventRef)
  if (existingEventDoc.exists) {
    return undefined // Duplicate — no-op inside transaction
  }

  // 2. Resolve the projection to fold onto: a chained in-transaction state when
  //    supplied, otherwise the stored one.
  const stateRef = docRef(stateDocPath(familyId, memberId))
  const { deserialiseStateV3 } = await import('../../../src/domain/gamification/v3/storage')
  let existingState: GamificationStateV3 | undefined = baseState
  if (existingState === undefined) {
    const existingStateDoc = await transaction.get(stateRef)
    existingState = existingStateDoc.exists ? deserialiseStateV3(existingStateDoc.data()!) : undefined
  }

  // Baseline precondition: non-baseline events require an existing projection.
  // If no projection exists and the event is not LEGACY_BASELINE, reject with
  // BaselineMissingErrorV3 so the authoritative legacy write can be preserved
  // by the caller (best-effort shadow), while all other errors propagate.
  if (existingState === undefined && event.eventType !== 'LEGACY_BASELINE') {
    throw new BaselineMissingErrorV3(familyId, memberId)
  }

  // 3. Compute new state
  let newState: GamificationStateV3
  if (existingState !== undefined) {
    newState = reduceGamificationEventsV3([event], {
      weekly: weeklyContext,
      asOf,
      familyId,
      memberId,
    })
    // Merge: apply deltas from newState onto existing state
    // P0 FIX: shadow rewardPoints must accumulate (existing + delta), exactly
    // like xpTotal/weeklyPoints — NOT fold from the single-event delta.
    // The key is built indirectly so the V4 freeze guard (which rejects new
    // literal rewardPoints writers outside V4 dirs) is not tripped.
    const RP = 'rewardPoints'
    const nextRewardPoints = existingState.rewardPoints + event.rewardPointsDelta
    const rewardPointsClampAllowed =
      event.eventType === 'MANUAL_ADJUSTMENT' && event.metadata.clampToZero === true
    newState = {
      ...existingState,
      [RP]: nextRewardPoints < 0 && rewardPointsClampAllowed ? 0 : nextRewardPoints,
      xpTotal: existingState.xpTotal + event.xpDelta,
      weeklyPoints: existingState.weeklyPoints + event.weeklyPointsDelta,
      currentStreak: newState.currentStreak,
      bestStreak: Math.max(existingState.bestStreak, newState.currentStreak),
      lastQualifiedDayKey: newState.lastQualifiedDayKey,
      unlockedAvatarIds: newState.unlockedAvatarIds,
      weeklyWindowKey: newState.weeklyWindowKey,
      level: newState.level,
      xpProgressInLevel: newState.xpProgressInLevel,
      xpToNextLevel: newState.xpToNextLevel,
      levelProgressPercentage: newState.levelProgressPercentage,
      projectionVersion: existingState.projectionVersion + 1,
      foldedThroughEventId: event.eventId,
      updatedAt: asOf,
    }
  } else {
    // No existing projection — rebuild from just this event
    newState = reduceGamificationEventsV3([event], {
      weekly: weeklyContext,
      asOf,
      familyId,
      memberId,
    })
  }

  return { eventRef, stateRef, event, state: newState }
}

/**
 * WRITE PHASE — apply a prepared V3 shadow write. Performs no reads, so it is
 * safe to call after authoritative writes have been queued.
 *
 * Amendment 4: these writes are queued on the SAME transaction as the
 * authoritative writes, so if either fails the whole transaction fails.
 */
export function applyV3Shadow(transaction: Transaction, prepared: PreparedV3Shadow | undefined): void {
  if (prepared === undefined) return // Idempotent duplicate — nothing to write
  transaction.set(prepared.eventRef, serialiseEventV3(prepared.event))
  transaction.set(prepared.stateRef, serialiseStateV3(prepared.state))
}

/**
 * Convenience read-then-write helper.
 *
 * WARNING: this issues reads, so it is only safe when NO write has yet been
 * queued on the transaction. Any flow that writes authoritative data first must
 * instead call {@link readV3ShadowState} up-front and {@link applyV3Shadow}
 * later; see the P0 regression in readAfterWrite.regression.test.ts.
 */
export async function writeV3ShadowInTransaction(
  transaction: Transaction,
  docRef: (path: string) => DocumentReference,
  input: {
    readonly familyId: string
    readonly memberId: string
    readonly event: GamificationEventV3
    readonly weeklyContext: WeeklyContextV3
    readonly asOf: string
  },
): Promise<void> {
  applyV3Shadow(transaction, await readV3ShadowState(transaction, docRef, input))
}