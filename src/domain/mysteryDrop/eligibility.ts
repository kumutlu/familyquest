/**
 * Mystery Drop resolver — single source of truth.
 *
 * Pure function. Same inputs ⇒ same outputs. No clock access, no
 * randomness, no Firestore, no React. Imported by the client engagement
 * resolver (for presentation) and the authoritative server evaluator
 * (for awarding).
 *
 * Architectural law:
 *   Engagement Engine creates opportunities.
 *   Gamification Engine awards value.
 *
 * This resolver ONLY decides. Awarding lives in the gamification
 * pipeline (functions/src/mysteryDrop/evaluator.ts).
 *
 * Boundary semantics — PINNED by tests:
 *   completedAt ∈ [startsAt, endsAt)   → eligible
 *   completedAt === endsAt              → not eligible
 *
 * Approval semantics — PINNED by tests:
 *   - Approval-required completions must carry `requiresApproval: true`.
 *     The completion context must also carry `approvedAt`. The
 *     resolver checks a single explicit flag: `requiresApproval === true
 *     && approvedAt is undefined` ⇒ `requires_approval_pending`.
 *
 * Idempotency:
 *   - Already-claimed drop ids are treated as `duplicate` BEFORE the
 *     window / task-eligibility checks so re-runs never mint twice.
 */

import {
  isInMysteryDropWindow,
  mysteryDropEventId,
  type MysteryDropEligibilityInput,
  type MysteryDropReason,
  type MysteryDropResult,
  type MysteryDropReward,
} from './types'

export function evaluateMysteryDropEligibility(
  input: MysteryDropEligibilityInput,
): MysteryDropResult {
  const { drop, completion } = input

  // 1. Reward shape must be a supported V1 type.
  if (!isSupportedReward(drop.reward)) {
    return ineligible('unsupported_reward')
  }

  // 2. Completion identity must be self-consistent (string ids, finite times).
  if (!isCompleteContext(input)) {
    return ineligible('invalid_definition')
  }

  // 3. Idempotency: already-claimed drop ⇒ no-op.
  const claimed = input.alreadyClaimedDropIds ?? []
  if (claimed.includes(drop.id)) {
    return {
      eligible: false,
      reason: 'duplicate',
      idempotencyKey: mysteryDropEventId(drop.id, completion.childId),
    }
  }

  // 4. Window half-open check using the AUTHORITATIVE completion time.
  if (!isInMysteryDropWindow(completion.completedAt, drop.startsAt, drop.endsAt)) {
    return ineligible('outside_window')
  }

  // 5. Task eligibility depends on the unlock condition.
  switch (drop.unlockCondition.type) {
    case 'complete_specific_task':
      if (completion.taskId !== drop.unlockCondition.taskId) {
        return ineligible('completion_mismatch')
      }
      break
    case 'complete_any_quest':
      // The resolver sees a single completion at a time; the count is
      // enforced upstream by the caller (server evaluator compares
      // accumulated completion ids within the window). We simply
      // require a non-empty completion record here.
      if (completion.id.length === 0) {
        return ineligible('invalid_definition')
      }
      break
    default:
      return ineligible('unsupported_reward')
  }

  // 6. Approval-required tasks must be approved. Pure-domain signal:
  //    the resolver checks the explicit `requiresApproval` flag.
  if (completion.requiresApproval === true && completion.approvedAt === undefined) {
    return ineligible('requires_approval_pending')
  }

  // 7. Eligible — capture the deterministic idempotency key now.
  return {
    eligible: true,
    reason: 'eligible',
    idempotencyKey: mysteryDropEventId(drop.id, completion.childId),
    reward: drop.reward,
  }
}

/** Cheap check for supported V1 reward shapes. */
export function isSupportedReward(reward: MysteryDropReward): boolean {
  switch (reward.type) {
    case 'cosmetic_unlock':
    case 'collection_item':
      return typeof reward.itemId === 'string' && reward.itemId.length > 0
    case 'xp_bonus':
      return Number.isSafeInteger(reward.amount) && reward.amount > 0
    default:
      return false
  }
}

function isCompleteContext(input: MysteryDropEligibilityInput): boolean {
  const { drop, completion } = input
  if (typeof drop.id !== 'string' || drop.id.length === 0) return false
  if (typeof completion.id !== 'string' || completion.id.length === 0) return false
  if (typeof completion.childId !== 'string' || completion.childId.length === 0) return false
  if (typeof completion.taskId !== 'string' || completion.taskId.length === 0) return false
  if (typeof completion.completedAt !== 'number' || !Number.isFinite(completion.completedAt)) return false
  if (typeof drop.startsAt !== 'number' || !Number.isFinite(drop.startsAt)) return false
  if (typeof drop.endsAt !== 'number' || !Number.isFinite(drop.endsAt)) return false
  return true
}

function ineligible(reason: MysteryDropReason): MysteryDropResult {
  return { eligible: false, reason }
}
/* -------------------------------------------------------------------------- */
/* Re-exports for callers that want a single import surface                   */
/* -------------------------------------------------------------------------- */

export {
  childInRollout,
  isInMysteryDropWindow,
  mysteryDropEventId,
  mysteryDropEvidenceId,
  mysteryDropInventoryItemId,
  mysteryDropReversalEventId,
  stableHash,
  type MysteryDropCompletionContext,
  type MysteryDropDefinition,
  type MysteryDropEligibility,
  type MysteryDropEligibilityInput,
  type MysteryDropPresentation,
  type MysteryDropRarity,
  type MysteryDropReason,
  type MysteryDropResolverInput,
  type MysteryDropResult,
  type MysteryDropReward,
  type MysteryDropUnlockCondition,
} from './types'
