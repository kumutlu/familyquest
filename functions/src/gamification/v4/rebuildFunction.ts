/**
 * Gamification V4 — deterministic projection rebuild server function (Task 4.3).
 *
 * Server-only. Reads the full family-partitioned V4 event ledger, reduces it
 * purely through the canonical Stage 1 reducer, and writes each member's
 * authoritative projection to the canonical family-scoped state path in ONE
 * transaction.
 *
 * Composition (no second arithmetic path):
 *   readLedger (Task 4.1 repository)
 *     → rebuildAllMembers (Stage 1 rebuild, which calls reduceGamificationEventsV4)
 *     → write all member states via canonical stateDocPath in a single txn.
 *
 * Safety:
 *   - assertEmulatorOnly (Task 4.1) fails closed unless FIRESTORE_EMULATOR_HOST
 *     is a local address. No applicationDefault / production credentials.
 *   - Cross-family / malformed events abort the whole rebuild (zero writes).
 *   - A transaction failure rolls back; no partial state is left behind.
 *   - No wallet collection is ever read or written.
 *   - No legacy V2/V3 collection is ever touched.
 *
 * See docs/gamification-v4-design.md §2.4 and plan Task 4.3.
 */

import type { DocumentData, DocumentReference, Firestore } from 'firebase-admin/firestore'
import type { GamificationEventV4 } from '../../../../src/domain/gamification/v4/event'
import type { GamificationStateV4 } from '../../../../src/domain/gamification/v4/types'
import { rebuildAllMembers } from '../../../../src/domain/gamification/v4/rebuild'
import type { ReduceContextV4 } from '../../../../src/domain/gamification/v4/reducer'
import { stateDocPath } from '../../../../src/domain/gamification/v4/storage'
import {
  CrossFamilyEventError,
  assertEmulatorOnly,
  readLedger,
  rejectCrossFamily,
} from './repository'

/** Context for a rebuild: clock + projection version stamped on each state. */
export type RebuildProjectionContext = ReduceContextV4

/**
 * Rebuild every member's authoritative V4 projection for a family from its
 * immutable event ledger, writing the result to the canonical
 * `families/{familyId}/gamification_state/{memberId}` path in a single
 * transaction.
 *
 * Returns the per-member rebuilt states (identical to what was persisted).
 *
 * The `db` handle is injected (never constructed via getFirestore /
 * applicationDefault) so the function can only ever target a local Firestore
 * emulator, satisfying the emulator-only guard.
 */
export async function rebuildProjection(
  db: Firestore,
  familyId: string,
  ctx: RebuildProjectionContext,
): Promise<Record<string, GamificationStateV4>> {
  assertEmulatorOnly('rebuildProjection')
  if (typeof familyId !== 'string' || familyId.length === 0) {
    throw new CrossFamilyEventError('familyId must be a non-empty string')
  }

  // 1. Read the family-partitioned ledger (no cross-family events possible).
  const ledger = (await readLedger(db, familyId)) as GamificationEventV4[]

  // 2. Defense in depth: reject any event that does not belong to this family
  //    partition or whose deterministic id is inconsistent. Aborting here means
  //    ZERO state writes for the whole family (no partial/cross-family state).
  for (const event of ledger) {
    if (event.familyId !== familyId) {
      throw new CrossFamilyEventError(
        `event ${event.eventId} belongs to family ${event.familyId}, not ${familyId}`,
      )
    }
    rejectCrossFamily(event)
  }

  // 3. Reduce purely from the ledger via the canonical reducer (no second path).
  //    Malformed events throw inside rebuildAllMembers → zero writes.
  const states = rebuildAllMembers(ledger, ctx)

  // 4. Persist every member's projection in ONE transaction. If any write
  //    fails, the transaction rolls back and no partial state is left behind.
  await db.runTransaction(async (tx) => {
    for (const [memberId, state] of Object.entries(states)) {
      const ref: DocumentReference = db.doc(stateDocPath(familyId, memberId))
      tx.set(ref, state as DocumentData)
    }
  })

  return states
}
