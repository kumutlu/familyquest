import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { getFirestore } from 'firebase-admin/firestore'
import { mapRedemption } from './sourceMappers/rewardMapper'
import { mapAvatarUnlock } from './sourceMappers/avatarMapper'
import { mapReversal } from './sourceMappers/reversalMapper'
import { mapManualAdjustment } from './sourceMappers/manualAdjustmentMapper'
import { writeShadowEvent, type ShadowWriterDependencies } from './shadowWriter'
import { AdminV3EventRepository } from './eventRepository'
import { AdminV3ProjectionRepository } from './projectionRepository'
import { AdminV3FailureRecorder } from './failures'
import { DEFAULT_WEEKLY_CONTEXT, resolveWeeklyContext } from '../../../src/domain/gamification/v3/weeklyWindow'

/**
 * V3 shadow trigger bridge for client-authoritative flows.
 *
 * TEMPORARY BRIDGE (amendment 1): These triggers observe client-created
 * documents and write V3 shadow events. They are a temporary Phase 2 bridge.
 * Phase 3 must move these flows to server-authoritative callable/transaction
 * paths before this bridge is removed.
 *
 * Bridge version identifier for failure records.
 */
const BRIDGE_VERSION = 'phase-2-bridge-v1'

function createShadowDeps() {
  const db = getFirestore()
  return {
    eventRepo: new AdminV3EventRepository(db),
    projectionRepo: new AdminV3ProjectionRepository(db),
    now: () => new Date().toISOString(),
    weeklyContext: DEFAULT_WEEKLY_CONTEXT,
  }
}

function createFailureRecorder() {
  return new AdminV3FailureRecorder(getFirestore())
}

/**
 * Helper: wrap a shadow write with failure recording.
 * For trigger-bridge flows, the legacy action may already be committed,
 * so a durable failure/dead-letter record is mandatory.
 */
async function writeWithFailureRecording(
  deps: ShadowWriterDependencies,
  failureRecorder: AdminV3FailureRecorder,
  sourceFlow: string,
  sourceDocumentId: string,
  legacyCommittedAt: string,
  writeFn: () => Promise<{ status: string; eventId: string; error?: string }>,
): Promise<void> {
  const shadowObservedAt = deps.now()
  try {
    const result = await writeFn()
    if (result.status === 'failed') {
      await failureRecorder.recordFailure({
        familyId: '',
        memberId: '',
        sourceType: sourceFlow,
        sourceId: sourceDocumentId,
        failureStage: 'event_write',
        errorMessage: result.error ?? 'Unknown shadow write error',
        sourceSnapshot: {},
        failedAt: shadowObservedAt,
        retryCount: 0,
        resolved: false,
        sourceFlow,
        sourceDocumentId,
        legacyCommittedAt,
        shadowObservedAt,
        bridgeVersion: BRIDGE_VERSION,
        reconciliationStatus: 'pending',
      })
    }
  } catch (error) {
    await failureRecorder.recordFailure({
      familyId: '',
      memberId: '',
      sourceType: sourceFlow,
      sourceId: sourceDocumentId,
      failureStage: 'mapping',
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      sourceSnapshot: {},
      failedAt: shadowObservedAt,
      retryCount: 0,
      resolved: false,
      sourceFlow,
      sourceDocumentId,
      legacyCommittedAt,
      shadowObservedAt,
      bridgeVersion: BRIDGE_VERSION,
      reconciliationStatus: 'pending',
    })
  }
}

// ---------------------------------------------------------------------------
// Redemption trigger
// ---------------------------------------------------------------------------
export const onRedemptionCreatedV3 = onDocumentCreated(
  'families/{familyId}/redemptions/{redemptionId}',
  async (event) => {
    const data = event.data?.data()
    if (!data) return
    const familyId = event.params.familyId
    const redemptionId = event.params.redemptionId
    const memberId = typeof data.childId === 'string' ? data.childId : ''
    if (!memberId) return

    const deps = createShadowDeps()
    const failureRecorder = createFailureRecorder()
    const legacyCommittedAt = data.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString()

    await writeWithFailureRecording(
      deps, failureRecorder,
      'reward_redemption', redemptionId, legacyCommittedAt,
      async () => {
        const source = {
          familyId,
          memberId,
          redemptionId,
          costPoints: typeof data.costPoints === 'number' ? data.costPoints : 0,
          redeemedAt: data.redeemedAt?.toDate?.()?.toISOString() ?? legacyCommittedAt,
          createdAt: legacyCommittedAt,
        }
        const v3Event = mapRedemption(source)
        return writeShadowEvent(deps, v3Event)
      },
    )
  },
)

// ---------------------------------------------------------------------------
// Avatar unlock trigger
// ---------------------------------------------------------------------------
export const onAvatarUnlockCreatedV3 = onDocumentCreated(
  'families/{familyId}/avatar_unlocks/{unlockId}',
  async (event) => {
    const data = event.data?.data()
    if (!data) return
    const familyId = event.params.familyId
    const unlockId = event.params.unlockId
    const memberId = typeof data.childId === 'string' ? data.childId : ''
    if (!memberId) return

    const deps = createShadowDeps()
    const failureRecorder = createFailureRecorder()
    const legacyCommittedAt = data.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString()

    await writeWithFailureRecording(
      deps, failureRecorder,
      'avatar_unlock', unlockId, legacyCommittedAt,
      async () => {
        const source = {
          familyId,
          memberId,
          avatarId: typeof data.avatarId === 'string' ? data.avatarId : '',
          costPoints: typeof data.costPoints === 'number' ? data.costPoints : 0,
          unlockedAt: data.unlockedAt?.toDate?.()?.toISOString() ?? legacyCommittedAt,
          createdAt: legacyCommittedAt,
        }
        const v3Event = mapAvatarUnlock(source)
        return writeShadowEvent(deps, v3Event)
      },
    )
  },
)

// ---------------------------------------------------------------------------
// Reversal trigger (for client-side reversals)
// ---------------------------------------------------------------------------
export const onReversalCreatedV3 = onDocumentCreated(
  'families/{familyId}/reversals/{reversalId}',
  async (event) => {
    const data = event.data?.data()
    if (!data) return
    const familyId = event.params.familyId
    const reversalId = event.params.reversalId
    const memberId = typeof data.childId === 'string' ? data.childId : ''
    if (!memberId) return

    const deps = createShadowDeps()
    const failureRecorder = createFailureRecorder()
    const legacyCommittedAt = data.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString()

    await writeWithFailureRecording(
      deps, failureRecorder,
      'reversal', reversalId, legacyCommittedAt,
      async () => {
        const source = {
          familyId,
          memberId,
          reversalId,
          originalEventId: typeof data.originalEventId === 'string' ? data.originalEventId : '',
          rewardPointsDelta: typeof data.rewardPointsDelta === 'number' ? data.rewardPointsDelta : 0,
          xpDelta: typeof data.xpDelta === 'number' ? data.xpDelta : 0,
          weeklyPointsDelta: typeof data.weeklyPointsDelta === 'number' ? data.weeklyPointsDelta : 0,
          reversedAt: data.reversedAt?.toDate?.()?.toISOString() ?? legacyCommittedAt,
          createdAt: legacyCommittedAt,
        }
        const v3Event = mapReversal(source)
        return writeShadowEvent(deps, v3Event)
      },
    )
  },
)

// ---------------------------------------------------------------------------
// Manual adjustment trigger
// ---------------------------------------------------------------------------
export const onManualAdjustmentCreatedV3 = onDocumentCreated(
  'families/{familyId}/manual_adjustments/{adjustmentId}',
  async (event) => {
    const data = event.data?.data()
    if (!data) return
    const familyId = event.params.familyId
    const adjustmentId = event.params.adjustmentId
    const memberId = typeof data.childId === 'string' ? data.childId : ''
    if (!memberId) return

    const deps = createShadowDeps()
    const failureRecorder = createFailureRecorder()
    const legacyCommittedAt = data.createdAt?.toDate?.()?.toISOString() ?? new Date().toISOString()

    await writeWithFailureRecording(
      deps, failureRecorder,
      'manual_adjustment', adjustmentId, legacyCommittedAt,
      async () => {
        const source = {
          familyId,
          memberId,
          adjustmentId,
          rewardPointsDelta: typeof data.points === 'number' ? data.points : 0,
          reason: typeof data.reason === 'string' ? data.reason : '',
          clampToZero: data.clampToZero === true,
          adjustedAt: data.adjustedAt?.toDate?.()?.toISOString() ?? legacyCommittedAt,
          createdAt: legacyCommittedAt,
        }
        const v3Event = mapManualAdjustment(source)
        return writeShadowEvent(deps, v3Event)
      },
    )
  },
)