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
 * Write a V3 shadow event inside an existing Firestore transaction.
 *
 * The event is written atomically with legacy writes. If the V3 write fails,
 * the entire transaction fails (Amendment 4 atomicity guarantee).
 *
 * The projection is written as a simple incremental update: apply the event's
 * deltas to the current stored projection. If no projection exists, the next
 * shadow write or reconciliation process will rebuild from the full ledger.
 *
 * @param transaction - The active Firestore transaction
 * @param db - Firestore instance (for creating document references)
 * @param input - V3 shadow write input
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
  const { familyId, memberId, event, weeklyContext, asOf } = input

  // 1. Check idempotency: read existing V3 event
  const eventRef = docRef(eventDocPath(familyId, event.eventId))
  const existingEventDoc = await transaction.get(eventRef)
  if (existingEventDoc.exists) {
    return // Duplicate — no-op inside transaction
  }

  // 2. Read existing V3 projection
  const stateRef = docRef(stateDocPath(familyId, memberId))
  const existingStateDoc = await transaction.get(stateRef)

  // 3. Compute new state
  const { deserialiseStateV3 } = await import('../../../src/domain/gamification/v3/storage')
  let newState: GamificationStateV3
  if (existingStateDoc.exists) {
    // Read existing events plus this new one, rebuild
    const existingState = deserialiseStateV3(existingStateDoc.data()!)
    newState = reduceGamificationEventsV3([event], {
      weekly: weeklyContext,
      asOf,
      familyId,
      memberId,
    })
    // Merge: apply deltas from newState onto existing state
    newState = {
      ...existingState,
      rewardPoints: newState.rewardPoints,
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

  // 4. Write event and projection atomically
  transaction.set(eventRef, serialiseEventV3(event))
  transaction.set(stateRef, serialiseStateV3(newState))
}