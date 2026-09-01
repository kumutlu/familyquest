/**
 * Authoritative Comeback evaluator.
 *
 * Lives inside the existing `processApprovedCompletion` transaction in
 * `functions/src/gamificationRepository.ts`. The resolver is the pure
 * `resolveComeback` from `src/domain/comeback`; this module wraps it
 * with authoritative document writes.
 *
 * Writes (one per eligible child per local date):
 *   1. `families/{familyId}/gamification_events/{eventId}` where
 *      `eventId = comeback:{childId}:{localDate}:{tier}`.
 *      Event type is `COMEBACK_MISSION_XP_AWARDED` and the xpDelta is
 *      the per-tier reward from the default table (or override).
 *   2. `families/{familyId}/comeback_evidence/{childId}__{localDate}__{tier}`
 *      — server-owned audit record. Idempotent.
 *
 * Idempotency:
 *   - Both doc ids are deterministic. The evidence doc pre-existence
 *     short-circuits BEFORE the gamification_events write.
 *
 * Reversal:
 *   - XP is reversible via a sibling reversal event with negative
 *     xpDelta and `reversalOfEventId`. Streaks are NEVER mutated.
 */

import {
  comebackEventId,
  comebackEvidenceId,
  comebackReversalEventId,
  comebackXpReward,
  familyLocalDateKey,
  resolveComeback,
  type ComebackTier,
  type ResolveComebackInput,
} from '../../../src/domain/comeback/eligibility'

/** Minimal transaction surface. Mirrors the Surge evaluator interface. */
export interface ComebackTransactionLike {
  get(ref: { id: string }): Promise<{
    id: string
    exists: boolean
    data(): Record<string, unknown> | undefined
  }>
  create(ref: { id: string }, data: Record<string, unknown>): Promise<void>
  set(ref: { id: string }, data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void>
}

export interface ComebackEvaluatorContext {
  readonly familyId: string
  readonly childId: string
  readonly timezone: string
  readonly now: number
  readonly lastMeaningfulActivityAt?: number | null
  readonly alreadyCompletedTiersForDate: readonly ComebackTier[]
  readonly comebackEventRef: (childId: string, localDate: string, tier: ComebackTier) => { id: string }
  readonly comebackEvidenceRef: (childId: string, localDate: string, tier: ComebackTier) => { id: string }
  readonly completionId: string
  readonly completionCompletedAt: number
}

export type ComebackAwardResult =
  | { status: 'awarded'; tier: ComebackTier; xpDelta: number; eventId: string; localDate: string }
  | { status: 'duplicate'; tier: ComebackTier }
  | { status: 'not_eligible'; reason: string; tier: ComebackTier }
  | { status: 'no_tier' }

/**
 * Tiers with zero XP. For these we record only the evidence stub
 * (no gamification_events doc) so a duplicate attempt is still
 * suppressed, but no XP is awarded.
 */
function isZeroRewardTier(tier: ComebackTier): boolean {
  return tier === 'return_1d' || tier === 'none'
}

export async function evaluateAndAwardComeback(
  transaction: ComebackTransactionLike,
  context: ComebackEvaluatorContext,
): Promise<ComebackAwardResult> {
  const localDate = familyLocalDateKey(context.now, context.timezone)
  const input: ResolveComebackInput = {
    timezone: context.timezone,
    now: context.now,
    lastMeaningfulActivityAt: context.lastMeaningfulActivityAt,
    completedTiersForDate: context.alreadyCompletedTiersForDate,
  }
  const resolved = resolveComeback(input)
  if (resolved.tier === 'none') {
    return { status: 'no_tier' }
  }
  if (resolved.missionCompleted) {
    return { status: 'duplicate', tier: resolved.tier }
  }

  const evidenceRef = context.comebackEvidenceRef(context.childId, localDate, resolved.tier)
  const existing = await transaction.get(evidenceRef)
  if (existing.exists) {
    return { status: 'duplicate', tier: resolved.tier }
  }

  const xpDelta = comebackXpReward(resolved.tier)

  if (!isZeroRewardTier(resolved.tier)) {
    const eventRef = context.comebackEventRef(context.childId, localDate, resolved.tier)
    const eventDoc = buildXpAwardedEvent({
      familyId: context.familyId,
      childId: context.childId,
      tier: resolved.tier,
      xpDelta,
      completionId: context.completionId,
      completionCompletedAt: context.completionCompletedAt,
      localDate,
      now: context.now,
    })
    await transaction.create(eventRef, eventDoc)
  }
  await transaction.create(evidenceRef, buildEvidence({
    familyId: context.familyId,
    childId: context.childId,
    tier: resolved.tier,
    xpDelta,
    completionId: context.completionId,
    localDate,
    now: context.now,
  }))

  return {
    status: 'awarded',
    tier: resolved.tier,
    xpDelta,
    localDate,
    eventId: comebackEventId(context.childId, localDate, resolved.tier),
  }
}

/* -------------------------------------------------------------------------- */
/* Document builders                                                           */
/* -------------------------------------------------------------------------- */

function buildXpAwardedEvent(input: {
  familyId: string
  childId: string
  tier: ComebackTier
  xpDelta: number
  completionId: string
  completionCompletedAt: number
  localDate: string
  now: number
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    eventType: 'COMEBACK_MISSION_XP_AWARDED',
    familyId: input.familyId,
    memberId: input.childId,
    sourceType: 'task_completion',
    sourceId: input.completionId,
    effectiveAt: new Date(input.completionCompletedAt).toISOString(),
    createdAt: new Date(input.now).toISOString(),
    rewardPointsDelta: 0,
    xpDelta: input.xpDelta,
    weeklyPointsDelta: 0,
    idempotencyKey: comebackEventId(input.childId, input.localDate, input.tier),
    metadata: {
      childId: input.childId,
      tier: input.tier,
      localDate: input.localDate,
      completionId: input.completionId,
      rewardXp: input.xpDelta,
    },
  }
}

function buildEvidence(input: {
  familyId: string
  childId: string
  tier: ComebackTier
  xpDelta: number
  completionId: string
  localDate: string
  now: number
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    familyId: input.familyId,
    childId: input.childId,
    tier: input.tier,
    localDate: input.localDate,
    completionId: input.completionId,
    rewardXp: input.xpDelta,
    evaluatedAt: input.now,
  }
}

/* -------------------------------------------------------------------------- */
/* Reversal                                                                    */
/* -------------------------------------------------------------------------- */

export interface ComebackReverseContext {
  readonly familyId: string
  readonly childId: string
  readonly localDate: string
  readonly tier: ComebackTier
  readonly amount: number
  readonly now: number
  readonly comebackEventRef: (childId: string, localDate: string, tier: ComebackTier) => { id: string }
  readonly comebackReversalEventRef: (childId: string, localDate: string, tier: ComebackTier) => { id: string }
}

export async function reverseComebackXp(
  transaction: ComebackTransactionLike,
  context: ComebackReverseContext,
): Promise<{ status: 'reversed' | 'duplicate' | 'not_found' }> {
  const reversalRef = context.comebackReversalEventRef(context.childId, context.localDate, context.tier)
  const existingReversal = await transaction.get(reversalRef)
  if (existingReversal.exists) return { status: 'duplicate' }

  const originalRef = context.comebackEventRef(context.childId, context.localDate, context.tier)
  const original = await transaction.get(originalRef)
  if (!original.exists) return { status: 'not_found' }

  await transaction.create(reversalRef, {
    schemaVersion: 1,
    eventType: 'COMEBACK_MISSION_XP_REVERSED',
    familyId: context.familyId,
    memberId: context.childId,
    sourceType: 'task_completion',
    sourceId: `${context.childId}__${context.localDate}__${context.tier}`,
    effectiveAt: new Date(context.now).toISOString(),
    createdAt: new Date(context.now).toISOString(),
    rewardPointsDelta: 0,
    xpDelta: -context.amount,
    weeklyPointsDelta: 0,
    idempotencyKey: comebackReversalEventId(context.childId, context.localDate, context.tier),
    reversalOfEventId: comebackEventId(context.childId, context.localDate, context.tier),
    metadata: {
      childId: context.childId,
      tier: context.tier,
      localDate: context.localDate,
      rewardXp: context.amount,
    },
  })
  return { status: 'reversed' }
}

/** Format the canonical Firestore document id for evidence records. */
export function comebackEvidenceDocId(childId: string, localDate: string, tier: ComebackTier): string {
  return comebackEvidenceId(childId, localDate, tier)
}
/* Re-exports for callers that want a single import surface */
export { comebackEventId, familyLocalDateKey, type ComebackTier, type ResolveComebackInput, type ResolveComebackResult } from '../../../src/domain/comeback/types';
