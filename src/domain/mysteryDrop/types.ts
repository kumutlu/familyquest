/**
 * Mystery Drops V1 — pure type contracts.
 *
 * Engagement creates opportunities; gamification awards value.
 *
 * These types are the single source of truth for the Mystery Drop model.
 * They are imported by the client-side engagement resolver (for
 * presentation) and by the server-side authoritative evaluator (for
 * awarding). They MUST NOT import from Firestore, React, or any
 * side-effecting module.
 *
 * Boundary semantics (pinned by tests):
 *   completedAt ∈ [startsAt, endsAt)   → eligible for unlock
 *   completedAt === endsAt              → not eligible
 *   completedAt <  startsAt             → not eligible
 *
 * Approval delay MUST NOT change the result. The reward snapshot is
 * captured at evaluation time and never rebinds.
 *
 * V1 rewards: `cosmetic_unlock`, `collection_item`, `xp_bonus`.
 * V1 disallowed: cash, wallet money, paid loot boxes, point jackpots.
 */

export type MysteryDropRarity = 'common' | 'rare' | 'epic'

export type MysteryDropReward =
  | { readonly type: 'cosmetic_unlock'; readonly itemId: string }
  | { readonly type: 'collection_item'; readonly itemId: string }
  | { readonly type: 'xp_bonus'; readonly amount: number }

export interface MysteryDropEligibility {
  /** Minimum authoritative child XP / level. V1 is closed-form
   *  (no parent-config). The server evaluator treats this as informational
   *  only and never fails eligibility because of it (the close-list of
   *  eligible task ids is the actual gate). */
  readonly minimumLevel?: number
  /** Whether the drop fires at most once per child. */
  readonly oncePerChild?: boolean
}

export type MysteryDropUnlockCondition =
  /** Eligible when the child has at least `count` approved completions
   *  across the drop window — but in V1 we simplify: the drop is
   *  unlocked the moment the resolver sees `count` qualifying
   *  completion ids inside the same drop window for that child. */
  | { readonly type: 'complete_any_quest'; readonly count: number }
  /** Eligible only when a specific task has been approved within the
   *  window. The `taskId` is canonical (matches `task.id`). */
  | { readonly type: 'complete_specific_task'; readonly taskId: string }

export interface MysteryDropPresentation {
  readonly rarity?: MysteryDropRarity
  /** i18n key for the AVAILABLE / PROGRESS state copy. */
  readonly messageKey: string
  /** i18n key for the READY / reveal state copy. */
  readonly revealMessageKey: string
}

/**
 * Generic mystery drop definition.
 *
 * In production this rides inside `EventDefinition.metadata.mysteryDrop`
 * so the existing Event Engine governs date windows. For pure-domain
 * tests we instantiate it directly.
 */
export interface MysteryDropDefinition {
  readonly id: string
  readonly version: number
  readonly startsAt: number
  readonly endsAt: number
  readonly eligibility: MysteryDropEligibility
  readonly unlockCondition: MysteryDropUnlockCondition
  readonly reward: MysteryDropReward
  readonly presentation: MysteryDropPresentation
}

/** Resolved per-child context: who is claiming, when, and which task. */
export interface MysteryDropCompletionContext {
  readonly id: string
  readonly childId: string
  readonly taskId: string
  readonly completedAt: number
  readonly approvedAt?: number
  /** True when the task required parent approval and it has been given.
   *  Approval-required tasks satisfy `complete_specific_task` /
   *  `complete_any_quest` ONLY when authoritative approval happened
   *  (completed-at is a server-stored timestamp bound to Firestore
   *  rules). */
  readonly requiresApproval: boolean
}

export interface MysteryDropResolverInput {
  readonly drop: MysteryDropDefinition
  readonly completion: MysteryDropCompletionContext
  /** Already-claimed drops for this child (drop ids). */
  readonly alreadyClaimedDropIds?: readonly string[]
}

/** Alias kept for backwards compatibility with existing imports. */
export type MysteryDropEligibilityInput = MysteryDropResolverInput

export type MysteryDropReason =
  | 'eligible'
  | 'outside_window'
  | 'completion_mismatch'
  | 'unassigned_or_sibling'
  | 'requires_approval_pending'
  | 'invalid_definition'
  | 'duplicate'
  | 'unsupported_reward'

export interface MysteryDropResult {
  readonly eligible: boolean
  readonly reason: MysteryDropReason
  readonly idempotencyKey?: string
  readonly reward?: MysteryDropReward
}

/* -------------------------------------------------------------------------- */
/* Idempotency keys                                                           */
/* -------------------------------------------------------------------------- */

export function mysteryDropEventId(dropId: string, childId: string): string {
  assertSegment(dropId, 'dropId')
  assertSegment(childId, 'childId')
  return `mystery-drop:${dropId}:child:${childId}`
}

export function mysteryDropReversalEventId(dropId: string, childId: string): string {
  return `${mysteryDropEventId(dropId, childId)}:reversal`
}

export function mysteryDropEvidenceId(dropId: string, childId: string): string {
  assertSegment(dropId, 'dropId')
  assertSegment(childId, 'childId')
  return `${dropId}__${childId}`
}

export function mysteryDropInventoryItemId(itemId: string, childId: string): string {
  assertSegment(itemId, 'itemId')
  assertSegment(childId, 'childId')
  return `${itemId}__${childId}`
}

/* -------------------------------------------------------------------------- */
/* Deterministic eligibility helper                                           */
/* -------------------------------------------------------------------------- */

/**
 * Stable hash: same input always yields the same integer in [0, 2^32).
 * Used for `stableHash(dropId + childId) % 100 < rolloutPercentage`.
 *
 * FNV-1a 32-bit. Mirrors the existing notification-catalog hash so the
 * codebase uses one hashing strategy.
 */
export function stableHash(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/** Returns true when the child is in the deterministic bucket. */
export function childInRollout(dropId: string, childId: string, rolloutPercentage: number): boolean {
  if (rolloutPercentage <= 0) return false
  if (rolloutPercentage >= 100) return true
  return stableHash(`${dropId}|${childId}`) % 100 < rolloutPercentage
}

/* -------------------------------------------------------------------------- */
/* Defensive parsing                                                          */
/* -------------------------------------------------------------------------- */

function assertSegment(value: string, label: string): void {
  if (value.length === 0 || value.includes('/')) {
    throw new Error(`${label} must be a non-empty Firestore segment`)
  }
}

/**
 * Half-open window check identical to `isInWindow` in
 * `src/domain/surge/types.ts`. The Mystery Drop module pins its own
 * implementation to avoid an accidental coupling change to the Surge
 * package — both halves of the engagement package rely on the same
 * boundary semantics.
 */
export function isInMysteryDropWindow(now: number, startsAt: number, endsAt: number): boolean {
  if (
    typeof now !== 'number' || !Number.isFinite(now) ||
    typeof startsAt !== 'number' || !Number.isFinite(startsAt) ||
    typeof endsAt !== 'number' || !Number.isFinite(endsAt)
  ) {
    return false
  }
  if (endsAt <= startsAt) return false
  return now >= startsAt && now < endsAt
}