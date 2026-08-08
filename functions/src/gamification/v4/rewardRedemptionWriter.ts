/**
 * Gamification V4 — authoritative REWARD_REDEEMED writer (Stage 7, Task 7.4).
 *
 * V4 side of the reward-redemption cutover (legacy: `src/lib/api.ts#redeemReward`,
 * a browser-trusted client write — the highest-risk writer in the audit).
 * Reached ONLY when the Stage 7 route resolver returns `v4` for the
 * `reward_redemption` writer. Not imported by `functions/src/index.ts`, so it
 * can never become a deployed production write path before activation (pinned
 * by `tools/architecture/v4-cutover-boundary.test.ts`). The client keeps its
 * fail-closed `requireLegacyClientRoute` guard until activation.
 *
 * Semantics (docs/gamification-v4-design.md §2.1–§2.4):
 *   - ONE canonical REWARD_REDEEMED event per redemption document.
 *   - Deterministic event id: `eventIdFor(familyId, memberId, 'REWARD_REDEEMED',
 *     redemptionId)` — the same anchor the Stage 2 replay reader derives, so a
 *     retried redemption can never double-charge.
 *   - A redemption is a pure points CHARGE: `rewardPointsDelta <= 0` and
 *     `xpDelta === 0` (DELTA_RULES_V4). Spending never reduces progression.
 *   - Affordability is checked against the AUTHORITATIVE V4 projection before
 *     the charge event is written; an unaffordable redemption fails closed and
 *     writes nothing (the reducer's clamp is a safety net, not the check).
 *   - Duplicate delivery is a NO-OP; state is rebuilt by the canonical
 *     `rebuildStateFromLedger` (see `writerCore.applyEventV4`).
 *   - No legacy rewardPoints write, no wallet document.
 *
 * Emulator only: every exported async entry point asserts `assertEmulatorOnly`.
 */

import type { Firestore } from 'firebase-admin/firestore'

import {
  applyEventV4,
  assertSegmentV4,
  assertNonNegativeIntegerV4,
  WriterInputErrorV4,
  type WriterResultV4,
} from './writerCore'
import { assertEmulatorOnly, readEvent, readState } from './repository'
import { eventIdFor } from '../../../../src/domain/gamification/v4/ids'
import {
  GAMIFICATION_V4_SCHEMA_VERSION,
  SOURCE_TYPE,
} from '../../../../src/domain/gamification/v4/types'
import type { GamificationEventV4 } from '../../../../src/domain/gamification/v4/event'
import { assertValidEventV4 } from '../../../../src/domain/gamification/v4/validators'

/** Thrown when the redemption facts handed to the V4 writer are unusable. */
export class RewardRedemptionInputError extends WriterInputErrorV4 {
  constructor(message: string) {
    super(message)
    this.name = 'RewardRedemptionInputError'
  }
}

/** Thrown when the member cannot afford the redemption (fail closed, no write). */
export class InsufficientRewardPointsError extends Error {
  constructor(
    readonly available: number,
    readonly cost: number,
  ) {
    super(`insufficient reward points: balance ${available} < cost ${cost}`)
    this.name = 'InsufficientRewardPointsError'
  }
}

/** The already-validated facts of ONE reward redemption. */
export interface RewardRedemptionFactsV4 {
  readonly familyId: string
  readonly memberId: string
  /** Redemption document id — the canonical idempotency anchor. */
  readonly redemptionId: string
  /** Reward catalogue id (metadata only). */
  readonly rewardId: string
  /** Points COST of the reward (>= 0). Charged as a negative delta. */
  readonly cost: number
  /** Business time of the redemption (ISO-8601 UTC instant). */
  readonly effectiveAt: string
  /** Write time (ISO-8601 UTC instant). */
  readonly createdAt: string
  /** True only when a fallback cost value was used. */
  readonly estimated?: boolean
  /** Optional family IANA timezone used for streak day-key resolution. */
  readonly timezone?: string
}

export type RewardRedemptionWriteResultV4 = WriterResultV4

/**
 * Build the ONE canonical REWARD_REDEEMED V4 event.
 *
 * Pure and deterministic; fails closed via `assertValidEventV4`.
 */
export function buildRewardRedeemedEventV4(
  facts: RewardRedemptionFactsV4,
): GamificationEventV4 {
  if (facts === null || typeof facts !== 'object') {
    throw new RewardRedemptionInputError('reward redemption facts must be an object')
  }
  assertSegmentV4(facts.familyId, 'familyId')
  assertSegmentV4(facts.memberId, 'memberId')
  assertSegmentV4(facts.redemptionId, 'redemptionId')
  assertSegmentV4(facts.rewardId, 'rewardId')
  assertNonNegativeIntegerV4(facts.cost, 'cost')

  const event: GamificationEventV4 = {
    schemaVersion: GAMIFICATION_V4_SCHEMA_VERSION,
    eventId: eventIdFor(facts.familyId, facts.memberId, 'REWARD_REDEEMED', facts.redemptionId),
    familyId: facts.familyId,
    memberId: facts.memberId,
    eventType: 'REWARD_REDEEMED',
    sourceType: SOURCE_TYPE.REWARD_REDEMPTION,
    sourceId: facts.redemptionId,
    effectiveAt: facts.effectiveAt,
    createdAt: facts.createdAt,
    rewardPointsDelta: -facts.cost,
    // Spending points must never touch lifetime progression.
    xpDelta: 0,
    metadata: {
      rewardId: facts.rewardId,
      redemptionId: facts.redemptionId,
      cost: facts.cost,
    },
    estimated: facts.estimated === true,
  }

  assertValidEventV4(event)
  return event
}

/**
 * Apply ONE reward redemption through the V4 engine.
 *
 * Order matters:
 *   1. Duplicate probe FIRST. A retried delivery of an already-charged
 *      redemption is a no-op even though the balance has since dropped below
 *      the cost — otherwise a retry would spuriously fail.
 *   2. Affordability is then evaluated against the stored V4 projection (the
 *      single authoritative balance). If the member cannot afford the reward
 *      the writer throws and NOTHING is written — the redemption is rejected
 *      rather than silently clamped to zero.
 */
export async function applyRewardRedemptionV4(
  db: Firestore,
  facts: RewardRedemptionFactsV4,
): Promise<RewardRedemptionWriteResultV4> {
  assertEmulatorOnly('applyRewardRedemptionV4', { familyId: facts?.familyId })

  const event = buildRewardRedeemedEventV4(facts)

  const existing = await readEvent(db, event.familyId, event.eventId)
  if (existing !== null) {
    return { status: 'duplicate', eventId: event.eventId, event: existing, state: null }
  }

  const current = await readState(db, facts.familyId, facts.memberId)
  const available = current?.rewardPoints ?? 0
  if (available < facts.cost) {
    throw new InsufficientRewardPointsError(available, facts.cost)
  }

  return applyEventV4(db, event, { timezone: facts.timezone })
}
