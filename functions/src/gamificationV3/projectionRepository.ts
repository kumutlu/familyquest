import { type Firestore } from 'firebase-admin/firestore'
import { type GamificationEventV3 } from '../../../src/domain/gamification/v3/event'
import { type GamificationStateV3 } from '../../../src/domain/gamification/v3/state'
import {
  stateDocPath,
  STATE_V3_COLLECTION_ID,
  serialiseStateV3,
  deserialiseStateV3,
} from '../../../src/domain/gamification/v3/storage'
import {
  reduceGamificationEventsV3,
  type ReducerContextV3,
} from '../../../src/domain/gamification/v3/reducer'

// ---------------------------------------------------------------------------
// Interface consumed by shadowWriter.ts
// ---------------------------------------------------------------------------

export interface V3ProjectionRepository {
  /** Read current projection for a member. Returns null if not yet created. */
  readProjection(familyId: string, memberId: string): Promise<GamificationStateV3 | null>

  /** Write projection. Used for incremental fold. */
  writeProjection(familyId: string, state: GamificationStateV3): Promise<void>

  /** Delete projection (for rebuild). */
  deleteProjection(familyId: string, memberId: string): Promise<void>

  /** Rebuild projection from full member event ledger. Uses the pure reducer. */
  rebuildProjection(
    familyId: string,
    memberId: string,
    events: readonly GamificationEventV3[],
    context: ReducerContextV3,
  ): GamificationStateV3
}

// ---------------------------------------------------------------------------
// Admin SDK implementation
// ---------------------------------------------------------------------------

export class AdminV3ProjectionRepository implements V3ProjectionRepository {
  constructor(private readonly db: Firestore) {}

  async readProjection(familyId: string, memberId: string): Promise<GamificationStateV3 | null> {
    const doc = await this.db.doc(stateDocPath(familyId, memberId)).get()
    if (!doc.exists) return null
    return deserialiseStateV3(doc.data()!)
  }

  async writeProjection(familyId: string, state: GamificationStateV3): Promise<void> {
    await this.db.doc(stateDocPath(familyId, state.memberId)).set(serialiseStateV3(state))
  }

  async deleteProjection(familyId: string, memberId: string): Promise<void> {
    await this.db.doc(stateDocPath(familyId, memberId)).delete()
  }

  rebuildProjection(
    familyId: string,
    memberId: string,
    events: readonly GamificationEventV3[],
    context: ReducerContextV3,
  ): GamificationStateV3 {
    return reduceGamificationEventsV3(events, {
      ...context,
      familyId,
      memberId,
    })
  }
}