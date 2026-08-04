import { type Firestore } from 'firebase-admin/firestore'
import { type GamificationStateV3 } from '../../../src/domain/gamification/v3/state'
import { type ReducerContextV3 } from '../../../src/domain/gamification/v3/reducer'
import {
  compareMemberShadow,
  type ShadowClassification,
  type ShadowDifference,
  type LegacyProjectionSnapshot,
} from '../../../src/domain/gamification/v3/shadowCompare'
import { type V3EventRepository } from './eventRepository'
import { type V3ProjectionRepository } from './projectionRepository'

export interface ComparisonReport {
  readonly familyId: string
  readonly memberId: string
  readonly classification: ShadowClassification
  readonly differences: readonly ShadowDifference[]
  readonly legacySnapshot: LegacyProjectionSnapshot
  readonly v3Projection: GamificationStateV3 | null
  readonly eventCount: number
  readonly ledgerComplete: boolean
}

export interface ComparisonDependencies {
  readonly eventRepo: V3EventRepository
  readonly projectionRepo: V3ProjectionRepository
  readonly db: Firestore
}

/**
 * Compare a member's legacy projection against the V3 shadow projection.
 *
 * Reads legacy data from the `users` document and `gamification_summaries`
 * subcollection, then delegates to the pure `compareMemberShadow` function.
 */
export async function compareMember(
  deps: ComparisonDependencies,
  familyId: string,
  memberId: string,
  context: ReducerContextV3,
): Promise<ComparisonReport> {
  // Read legacy data
  const userDoc = await deps.db.doc(`users/${memberId}`).get()
  const user = userDoc.data()
  if (!user) {
    return {
      familyId,
      memberId,
      classification: 'malformed_data',
      differences: [],
      legacySnapshot: { familyId, memberId, rewardPoints: 0, xpTotal: 0, weeklyPoints: 0, currentStreak: 0 },
      v3Projection: null,
      eventCount: 0,
      ledgerComplete: false,
    }
  }

  const summaryDoc = await deps.db.doc(`families/${familyId}/gamification_summaries/${memberId}`).get()
  const summary = summaryDoc.data()

  const legacySnapshot: LegacyProjectionSnapshot = {
    familyId,
    memberId,
    rewardPoints: typeof user.rewardPoints === 'number' ? user.rewardPoints : 0,
    xpTotal: typeof summary?.xpTotal === 'number' ? summary.xpTotal : typeof user.lifetimeXP === 'number' ? user.lifetimeXP : 0,
    weeklyPoints: typeof summary?.weeklyPoints === 'number' ? summary.weeklyPoints : 0,
    currentStreak: typeof summary?.currentStreak === 'number' ? summary.currentStreak : 0,
  }

  // Read V3 events
  const events = await deps.eventRepo.readMemberEvents(familyId, memberId)

  // Check if ledger is complete (has LEGACY_BASELINE)
  const ledgerComplete = events.some(e => e.eventType === 'LEGACY_BASELINE')

  // Read V3 projection
  const v3Projection = await deps.projectionRepo.readProjection(familyId, memberId)

  // Delegate to pure comparison
  const result = compareMemberShadow(
    { legacy: legacySnapshot, events, ledgerComplete },
    { ...context, familyId, memberId },
  )

  return {
    familyId,
    memberId,
    classification: result.classification,
    differences: result.differences,
    legacySnapshot,
    v3Projection,
    eventCount: events.length,
    ledgerComplete,
  }
}