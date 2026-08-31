/**
 * Authoritative Surge evaluator.
 *
 * Lives inside the existing `processApprovedCompletion` transaction in
 * `functions/src/gamificationRepository.ts`. It uses the same domain
 * module the client uses (`src/domain/surge`) so client and server
 * agree on every rule, including the half-open window semantics.
 *
 * Writes two immutable records:
 *   1. `families/{familyId}/gamification_events/{eventId}` where
 *      `eventId = surge:{surgeId}:completion:{completionId}`.
 *      Same shape as `TASK_APPROVED` events so the existing V3 mapper
 *      reducer (`mapTaskApproval`) folds it unchanged.
 *   2. `families/{familyId}/surge_evidence/{surgeId}__{completionId}` —
 *      an audit record. Useful for parent-facing history ("House Vacuum
 *      +15 / Surge Bonus +10") and for deterministic reversal linkage.
 *
 * Idempotency:
 *   - The gamification_events doc id is deterministic; a second call
 *     fails with `alreadyExists` and the evaluator returns `duplicate`.
 *   - The surge_evidence doc id is also deterministic; pre-existence
 *     is treated as duplicate for defence-in-depth.
 *
 * Reversal:
 *   - `reverseSurgeBonus` writes a sibling reversal event using the
 *     same SURGE_BONUS_AWARDED shape with a negative delta and
 *     `reversalOfEventId` populated.
 *
 * Trust boundary:
 *   - `completedAt` is the value already on `task_completions/{id}`,
 *     written by the Firestore Rules at create time (the same rule
 *     path the P0 fix gates). The client never re-supplies it.
 */

import { evaluateSurgeEligibility } from '../../../src/domain/surge/eligibility'
import { surgeEventId, surgeReversalEventId } from '../../../src/domain/surge/types'
import type {
  SurgeCompletionContext,
  SurgeEligibilityInput,
  SurgeSnapshot,
  SurgeTaskContext,
  SurgeFamilyPreferences,
} from '../../../src/domain/surge/types'

import type { SurgeCatalog } from './catalog'

/** Minimal transaction surface the evaluator uses. We type it as
 *  `unknown` here and lean on the real Admin SDK types when wired in;
 *  the integration tests use a fake with the same shape. */
export interface SurgeTransactionLike {
  get(ref: { id: string }): Promise<{
    id: string
    exists: boolean
    data(): Record<string, unknown> | undefined
  }>
  create(
    ref: { id: string },
    data: Record<string, unknown>,
  ): Promise<void>
  set(
    ref: { id: string },
    data: Record<string, unknown>,
    options?: { merge?: boolean },
  ): Promise<void>
}

export interface SurgeEvaluatorContext {
  readonly familyId: string
  readonly familyPreferences: SurgeFamilyPreferences
  readonly catalog: SurgeCatalog | null
  readonly completion: SurgeCompletionContext
  readonly task: SurgeTaskContext
  /** Resolved by the caller because the path format depends on the
   *  Firestore client (web vs admin). */
  readonly surgeEventRef: (surgeId: string, completionId: string) => {
    id: string
  }
  readonly surgeEvidenceRef: (surgeId: string, completionId: string) => {
    id: string
  }
  readonly familyDocRef: () => { id: string }
}

export type SurgeAwardResult =
  | { status: 'awarded'; surgeId: string; snapshot: SurgeSnapshot }
  | { status: 'duplicate'; surgeId: string }
  | { status: 'not_eligible'; reason: string }

/** Build the gamification event shape for a Surge bonus. Mirrors the
 *  legacy V3 mapper output (see `taskMapper.ts`) so the existing V3
 *  reducer can fold it without any reducer change. */
function buildSurgeBonusEvent(input: {
  familyId: string
  childId: string
  taskId: string
  completionId: string
  surgeId: string
  snapshot: SurgeSnapshot
  now: number
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    eventType: 'SURGE_BONUS_AWARDED',
    familyId: input.familyId,
    memberId: input.childId,
    sourceType: 'task_completion',
    sourceId: input.completionId,
    effectiveAt: new Date(input.snapshot.completedAt).toISOString(),
    createdAt: new Date(input.now).toISOString(),
    rewardPointsDelta: input.snapshot.rewardAmount,
    xpDelta: 0,
    weeklyPointsDelta: input.snapshot.rewardAmount,
    idempotencyKey: surgeEventId(input.surgeId, input.completionId),
    metadata: {
      surgeId: input.surgeId,
      eventVersion: input.snapshot.eventVersion,
      completedWithinWindow: input.snapshot.completedWithinWindow,
      rewardType: input.snapshot.rewardType,
      rewardAmount: input.snapshot.rewardAmount,
      taskId: input.taskId,
      childId: input.childId,
      completionId: input.completionId,
      completedAt: input.snapshot.completedAt,
    },
  }
}

function buildSurgeEvidence(input: {
  familyId: string
  surgeId: string
  completionId: string
  snapshot: SurgeSnapshot
  taskId: string
  childId: string
  now: number
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    familyId: input.familyId,
    surgeId: input.surgeId,
    completionId: input.completionId,
    taskId: input.taskId,
    childId: input.childId,
    completedAt: input.snapshot.completedAt,
    rewardType: input.snapshot.rewardType,
    rewardAmount: input.snapshot.rewardAmount,
    eventVersion: input.snapshot.eventVersion,
    evaluatedAt: input.now,
  }
}

/**
 * Evaluate a completion for a Surge bonus and, if eligible, write the
 * immutable event + audit record in the supplied transaction.
 *
 * MUST be called inside the same transaction that awarded the base
 * task reward so that an approved completion either writes both events
 * or neither.
 */
export async function evaluateAndAwardSurgeBonus(
  transaction: SurgeTransactionLike,
  context: SurgeEvaluatorContext,
): Promise<SurgeAwardResult> {
  const catalog = context.catalog
  if (!catalog || !Array.isArray(catalog.surges)) {
    return { status: 'not_eligible', reason: 'no_catalog' }
  }

  // Filter candidate Surges by task id BEFORE delegating to the resolver
  // so we can short-circuit cheaply when no Surge mentions the task.
  const candidates = catalog.surges.filter(
    s => s.surge.eligibleTaskIds.includes(context.completion.taskId),
  )
  if (candidates.length === 0) {
    return { status: 'not_eligible', reason: 'no_matching_surge' }
  }

  for (const candidate of candidates) {
    const input: SurgeEligibilityInput = {
      surgeId: candidate.surgeId,
      surge: candidate.surge,
      surgeWindow: candidate.window,
      task: context.task,
      completion: context.completion,
      familyPreferences: context.familyPreferences,
    }
    const result = evaluateSurgeEligibility(input)
    if (!result.eligible || !result.rewardSnapshot) continue

    const eventRef = context.surgeEventRef(candidate.surgeId, context.completion.id)
    const evidenceRef = context.surgeEvidenceRef(candidate.surgeId, context.completion.id)

    // Idempotency: read both audit records before writing. Either one
    // existing ⇒ already awarded.
    const [existingEvent, existingEvidence] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(evidenceRef),
    ])
    if (existingEvent.exists || existingEvidence.exists) {
      return { status: 'duplicate', surgeId: candidate.surgeId }
    }

    const now = Date.now()
    await transaction.create(
      eventRef,
      buildSurgeBonusEvent({
        familyId: context.familyId,
        childId: context.completion.childId,
        taskId: context.completion.taskId,
        completionId: context.completion.id,
        surgeId: candidate.surgeId,
        snapshot: result.rewardSnapshot,
        now,
      }),
    )
    await transaction.create(
      evidenceRef,
      buildSurgeEvidence({
        familyId: context.familyId,
        surgeId: candidate.surgeId,
        completionId: context.completion.id,
        snapshot: result.rewardSnapshot,
        taskId: context.completion.taskId,
        childId: context.completion.childId,
        now,
      }),
    )
    return { status: 'awarded', surgeId: candidate.surgeId, snapshot: result.rewardSnapshot }
  }

  return { status: 'not_eligible', reason: 'all_candidates_failed' }
}

/**
 * Reverse a Surge bonus that was previously awarded for a completion.
 *
 * Writes a sibling reversal event in `gamification_events` with the
 * negative rewardPointsDelta and `reversalOfEventId` pointing at the
 * original bonus event. The `surge_evidence` record is preserved as
 * historical evidence (it is a snapshot of what was earned, not what is
 * currently active).
 *
 * Idempotent: if the reversal already exists, returns `duplicate`.
 */
export async function reverseSurgeBonus(
  transaction: SurgeTransactionLike,
  context: {
    familyId: string
    childId: string
    taskId: string
    completionId: string
    surgeId: string
    rewardAmount: number
    rewardType: 'bonus_points'
    now: number
    surgeReversalEventRef: (surgeId: string, completionId: string) => { id: string }
    surgeEventRef: (surgeId: string, completionId: string) => { id: string }
  },
): Promise<{ status: 'reversed' | 'duplicate' | 'not_found' }> {
  const reversalRef = context.surgeReversalEventRef(context.surgeId, context.completionId)
  const existingReversal = await transaction.get(reversalRef)
  if (existingReversal.exists) return { status: 'duplicate' }

  const originalRef = context.surgeEventRef(context.surgeId, context.completionId)
  const original = await transaction.get(originalRef)
  if (!original.exists) return { status: 'not_found' }

  await transaction.create(reversalRef, {
    schemaVersion: 1,
    eventType: 'SURGE_BONUS_REVERSED',
    familyId: context.familyId,
    memberId: context.childId,
    sourceType: 'task_completion',
    sourceId: context.completionId,
    effectiveAt: new Date(context.now).toISOString(),
    createdAt: new Date(context.now).toISOString(),
    rewardPointsDelta: -context.rewardAmount,
    xpDelta: 0,
    weeklyPointsDelta: -context.rewardAmount,
    idempotencyKey: surgeReversalEventId(context.surgeId, context.completionId),
    reversalOfEventId: surgeEventId(context.surgeId, context.completionId),
    metadata: {
      surgeId: context.surgeId,
      rewardType: context.rewardType,
      rewardAmount: context.rewardAmount,
      taskId: context.taskId,
      childId: context.childId,
      completionId: context.completionId,
    },
  })

  return { status: 'reversed' }
}