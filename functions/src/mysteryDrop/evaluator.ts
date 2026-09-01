/**
 * Authoritative Mystery Drop evaluator.
 *
 * Lives inside the existing `processApprovedCompletion` transaction in
 * `functions/src/gamificationRepository.ts`. It uses the same domain
 * module the client uses (`src/domain/mysteryDrop`) so client and server
 * agree on every rule, including the half-open window semantics.
 *
 * Writes (per eligible drop, per child):
 *   1. `families/{familyId}/gamification_events/{eventId}` where
 *      `eventId = mystery-drop:{dropId}:child:{childId}`.
 *      Shape is `MYSTERY_DROP_XP_AWARDED` for xp rewards, with metadata
 *      carrying the drop id, version, and qualifying completion. This
 *      rides the existing `foldXpEvents` reducer via the standard
 *      `xpDelta` field (see `src/domain/gamification/xp.ts`).
 *   2. `users/{childId}/inventory/{itemId}` for `cosmetic_unlock` and
 *      `collection_item` rewards — idempotent via the inventory item id
 *      encoding `itemId__childId`. The merge=true semantics mean an
 *      already-owned item is a no-op.
 *   3. `families/{familyId}/mystery_drop_evidence/{dropId}__{childId}`
 *      — server-owned audit record; never deleted.
 *
 * Idempotency:
 *   - The gamification_events doc id is deterministic; a second call
 *     fails with `alreadyExists` and the evaluator returns `duplicate`.
 *   - The mystery_drop_evidence doc id is also deterministic; its
 *     pre-existence short-circuits BEFORE the gamification_events write
 *     so re-runs never even attempt to mint.
 *
 * Reversal:
 *   - XP rewards are reversible via a sibling `MYSTERY_DROP_XP_REVERSED`
 *     event with negative `xpDelta` and `reversalOfEventId`. Cosmetic
 *     ownership is PERMANENT in V1 (see design doc §10).
 */

import { evaluateMysteryDropEligibility, isSupportedReward } from '../../../src/domain/mysteryDrop/eligibility'
import {
  mysteryDropEvidenceId,
  mysteryDropEventId,
  mysteryDropInventoryItemId,
  mysteryDropReversalEventId,
  type MysteryDropCompletionContext,
  type MysteryDropDefinition,
  type MysteryDropEligibilityInput,
  type MysteryDropReward,
  type MysteryDropResolverInput,
} from '../../../src/domain/mysteryDrop/types';

// Re-exports for callers that want a single import surface
export {
  mysteryDropEventId,
  mysteryDropReversalEventId,
  mysteryDropInventoryItemId,
  type MysteryDropDefinition,
  type MysteryDropCompletionContext,
  type MysteryDropEligibilityInput,
  type MysteryDropReward,
  type MysteryDropResolverInput,
};

/** Minimal transaction surface the evaluator uses. Mirrors the
 *  Surge evaluator interface for reuse inside the existing
 *  `processApprovedCompletion` transaction. */
export interface MysteryDropTransactionLike {
  get(ref: { id: string }): Promise<{
    id: string
    exists: boolean
    data(): Record<string, unknown> | undefined
  }>
  create(ref: { id: string }, data: Record<string, unknown>): Promise<void>
  set(ref: { id: string }, data: Record<string, unknown>, options?: { merge?: boolean }): Promise<void>
}

export interface MysteryDropCatalog {
  readonly familyId: string
  readonly drops: readonly MysteryDropDefinition[]
}

export interface MysteryDropEvaluatorContext {
  readonly familyId: string
  readonly childId: string
  readonly catalog: MysteryDropCatalog | null
  readonly completion: MysteryDropCompletionContext
  readonly now: number
  /** Resolved by the caller because the path format depends on the
   *  Firestore client. */
  readonly mysteryDropEventRef: (dropId: string, childId: string) => { id: string }
  readonly mysteryDropEvidenceRef: (dropId: string, childId: string) => { id: string }
  readonly inventoryItemRef: (itemId: string, childId: string) => { id: string }
}

export type MysteryDropAwardResult =
  | { status: 'awarded'; dropId: string; reward: MysteryDropReward; eventId: string }
  | { status: 'duplicate'; dropId: string }
  | { status: 'not_eligible'; reason: string; dropId: string }
  | { status: 'no_catalog' }

/**
 * Evaluate all Mystery Drops for the supplied approved completion.
 * Each drop is independent — if one fails (e.g. due to a transient
 * concurrent write), the others still complete. Returns one result
 * per drop, in declaration order.
 */
export async function evaluateAndAwardMysteryDrop(
  transaction: MysteryDropTransactionLike,
  context: MysteryDropEvaluatorContext,
): Promise<readonly MysteryDropAwardResult[]> {
  const catalog = context.catalog
  if (!catalog || !Array.isArray(catalog.drops) || catalog.drops.length === 0) {
    return [{ status: 'no_catalog' }]
  }

  const results: MysteryDropAwardResult[] = []

  for (const drop of catalog.drops) {
    try {
      const result = await evaluateSingleDrop(transaction, context, drop)
      results.push(result)
    } catch (error) {
      // Mystery Drop is additive. Failures MUST NOT block the base task
      // approval — log and continue. The caller surfaces this in a
      // diagnostic warning so audit is preserved.
      results.push({
        status: 'not_eligible',
        reason: `evaluator_failure: ${(error as Error).message ?? 'unknown'}`,
        dropId: drop.id,
      })
    }
  }

  return results
}

async function evaluateSingleDrop(
  transaction: MysteryDropTransactionLike,
  context: MysteryDropEvaluatorContext,
  drop: MysteryDropDefinition,
): Promise<MysteryDropAwardResult> {
  if (!isSupportedReward(drop.reward)) {
    return { status: 'not_eligible', reason: 'unsupported_reward', dropId: drop.id }
  }

  const evidenceRef = context.mysteryDropEvidenceRef(drop.id, context.childId)
  const existingEvidence = await transaction.get(evidenceRef)
  if (existingEvidence.exists) {
    return { status: 'duplicate', dropId: drop.id }
  }

  const input: MysteryDropEligibilityInput = {
    drop,
    completion: context.completion,
  }
  const eligibility = evaluateMysteryDropEligibility(input)
  if (!eligibility.eligible || !eligibility.idempotencyKey || !eligibility.reward) {
    return { status: 'not_eligible', reason: eligibility.reason, dropId: drop.id }
  }

  // XP reward path: write the gamification_events doc + evidence doc.
  if (eligibility.reward.type === 'xp_bonus') {
    const eventRef = context.mysteryDropEventRef(drop.id, context.childId)
    const eventDoc = buildXpAwardedEvent({
      familyId: context.familyId,
      childId: context.childId,
      dropId: drop.id,
      dropVersion: drop.version,
      completion: context.completion,
      amount: eligibility.reward.amount,
      now: context.now,
    })
    await transaction.create(eventRef, eventDoc)
    await transaction.create(evidenceRef, buildEvidence({
      familyId: context.familyId,
      dropId: drop.id,
      childId: context.childId,
      reward: eligibility.reward,
      completion: context.completion,
      now: context.now,
    }))
    return { status: 'awarded', dropId: drop.id, reward: eligibility.reward, eventId: mysteryDropEventId(drop.id, context.childId) }
  }

  // Cosmetic / collection unlock path: write inventory ownership.
  const itemRef = context.inventoryItemRef(eligibility.reward.itemId, context.childId)
  const inventoryDoc = buildInventoryOwnershipDoc({
    itemId: eligibility.reward.itemId,
    childId: context.childId,
    dropId: drop.id,
    now: context.now,
    rewardType: eligibility.reward.type,
  })
  await transaction.set(itemRef, inventoryDoc, { merge: true })
  await transaction.create(evidenceRef, buildEvidence({
    familyId: context.familyId,
    dropId: drop.id,
    childId: context.childId,
    reward: eligibility.reward,
    completion: context.completion,
    now: context.now,
  }))
  return { status: 'awarded', dropId: drop.id, reward: eligibility.reward, eventId: mysteryDropEventId(drop.id, context.childId) }
}

/* -------------------------------------------------------------------------- */
/* Document builders                                                           */
/* -------------------------------------------------------------------------- */

function buildXpAwardedEvent(input: {
  familyId: string
  childId: string
  dropId: string
  dropVersion: number
  completion: MysteryDropCompletionContext
  amount: number
  now: number
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    eventType: 'MYSTERY_DROP_XP_AWARDED',
    familyId: input.familyId,
    memberId: input.childId,
    sourceType: 'task_completion',
    sourceId: input.completion.id,
    effectiveAt: new Date(input.completion.completedAt).toISOString(),
    createdAt: new Date(input.now).toISOString(),
    rewardPointsDelta: 0,
    xpDelta: input.amount,
    weeklyPointsDelta: 0,
    idempotencyKey: mysteryDropEventId(input.dropId, input.childId),
    metadata: {
      dropId: input.dropId,
      dropVersion: input.dropVersion,
      childId: input.childId,
      completionId: input.completion.id,
      taskId: input.completion.taskId,
      completedAt: input.completion.completedAt,
      rewardType: 'xp_bonus',
      rewardAmount: input.amount,
    },
  }
}

function buildEvidence(input: {
  familyId: string
  dropId: string
  childId: string
  reward: MysteryDropReward
  completion: MysteryDropCompletionContext
  now: number
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    familyId: input.familyId,
    dropId: input.dropId,
    childId: input.childId,
    completionId: input.completion.id,
    taskId: input.completion.taskId,
    completedAt: input.completion.completedAt,
    rewardType: input.reward.type,
    ...(input.reward.type === 'xp_bonus'
      ? { rewardAmount: input.reward.amount }
      : { itemId: input.reward.itemId }),
    evaluatedAt: input.now,
  }
}

function buildInventoryOwnershipDoc(input: {
  itemId: string
  childId: string
  dropId: string
  now: number
  rewardType: 'cosmetic_unlock' | 'collection_item'
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    itemId: input.itemId,
    childId: input.childId,
    type: input.rewardType === 'cosmetic_unlock' ? 'cosmetic' : 'collection',
    source: 'mystery_drop',
    sourceId: input.dropId,
    acquiredAt: input.now,
    inventoryItemId: mysteryDropInventoryItemId(input.itemId, input.childId),
  }
}

/* -------------------------------------------------------------------------- */
/* Reversal                                                                    */
/* -------------------------------------------------------------------------- */

export interface MysteryDropReverseContext {
  readonly familyId: string
  readonly childId: string
  readonly dropId: string
  readonly amount: number
  readonly now: number
  /** Source completion that originally triggered the award. */
  readonly completionId: string
  /** The set of completion ids that still qualify as approved
   *  for this drop/child after authoritative re-evaluation. With V1
   *  count=1 the drop is qualified iff this set is non-empty. */
  readonly qualifyingCompletionIds: readonly string[]
  readonly mysteryDropEventRef: (dropId: string, childId: string) => { id: string }
  readonly mysteryDropReversalEventRef: (dropId: string, childId: string) => { id: string }
}

export type MysteryDropReverseResult =
  | { status: 'reversed' }
  | { status: 'kept_qualified' }
  | { status: 'duplicate' }
  | { status: 'not_found' }

/**
 * Reverse a previously-awarded Mystery Drop XP. Writes a sibling
 * reversal event with negative `xpDelta` and `reversalOfEventId`.
 * Inventory ownership is NOT revoked in V1 (see design doc §10).
 *
 * Re-evaluation: with V1 count=1, the reward is qualified iff any
 * approved completion within the drop window remains. We accept a
 * `qualifyingCompletionIds` set from the caller so the authoritative
 * evaluator can decide whether the drop should still be qualified
 * after the invalidated completion has been removed.
 */
export async function reverseMysteryDropXp(
  transaction: MysteryDropTransactionLike,
  context: MysteryDropReverseContext,
): Promise<MysteryDropReverseResult> {
  const reversalRef = context.mysteryDropReversalEventRef(context.dropId, context.childId)
  const existingReversal = await transaction.get(reversalRef)
  if (existingReversal.exists) return { status: 'duplicate' }

  const originalRef = context.mysteryDropEventRef(context.dropId, context.childId)
  const original = await transaction.get(originalRef)
  if (!original.exists) return { status: 'not_found' }

  // V1 only supports count=1. The drop remains qualified iff any
  // qualifying completion remains after the invalidated completion
  // has been removed from the set.
  const stillQualifying = context.qualifyingCompletionIds.filter(id => id !== context.completionId).length
  if (stillQualifying > 0) {
    return { status: 'kept_qualified' }
  }

  await transaction.create(reversalRef, {
    schemaVersion: 1,
    eventType: 'MYSTERY_DROP_XP_REVERSED',
    familyId: context.familyId,
    memberId: context.childId,
    sourceType: 'task_completion',
    sourceId: `${context.dropId}__${context.childId}`,
    effectiveAt: new Date(context.now).toISOString(),
    createdAt: new Date(context.now).toISOString(),
    rewardPointsDelta: 0,
    xpDelta: -context.amount,
    weeklyPointsDelta: 0,
    idempotencyKey: `${mysteryDropEventId(context.dropId, context.childId)}:reversal`,
    reversalOfEventId: mysteryDropEventId(context.dropId, context.childId),
    metadata: {
      dropId: context.dropId,
      childId: context.childId,
      rewardType: 'xp_bonus',
      rewardAmount: context.amount,
      sourceCompletionId: context.completionId,
      qualifyingCompletionIds: [...context.qualifyingCompletionIds],
    },
  })
  return { status: 'reversed' }
}

/**
 * Format the canonical Firestore document id for the evidence record.
 * Exported for tests and for the Firestore Rules path helper.
 */
export function mysteryDropEvidenceDocId(dropId: string, childId: string): string {
  return mysteryDropEvidenceId(dropId, childId)
}