/**
 * Gamification V4 — authoritative AVATAR_UNLOCKED writer (Stage 7, Task 7.6).
 *
 * V4 side of the avatar-unlock cutover (legacy: `src/lib/api.ts#unlockAvatar`,
 * a browser-trusted client write). Reached ONLY when the Stage 7 route resolver
 * returns `v4` for the `avatar_unlock` writer. Not imported by
 * `functions/src/index.ts`, so it can never become a deployed production write
 * path before activation (pinned by `tools/architecture/v4-cutover-boundary.test.ts`).
 * The client keeps its fail-closed `requireLegacyClientRoute` guard until then.
 *
 * Semantics (docs/gamification-v4-design.md §2.1–§2.4):
 *   - ONE canonical AVATAR_UNLOCKED event per (member, avatar). The avatar id
 *     IS the idempotency anchor, so an avatar can never be bought twice.
 *   - Deterministic event id: `eventIdFor(familyId, memberId, 'AVATAR_UNLOCKED',
 *     avatarId)`.
 *   - An unlock is a points CHARGE: `rewardPointsDelta <= 0`, `xpDelta === 0`.
 *     A free avatar is a zero-cost unlock (still exactly one ledger event).
 *   - `metadata.avatarId` is the single mechanism by which the reducer folds the
 *     avatar into `unlockedAvatarIds` — this writer never edits that array.
 *   - Affordability is checked against the AUTHORITATIVE V4 projection; an
 *     unaffordable unlock fails closed and writes nothing.
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

/** Thrown when the avatar-unlock facts handed to the V4 writer are unusable. */
export class AvatarUnlockInputError extends WriterInputErrorV4 {
  constructor(message: string) {
    super(message)
    this.name = 'AvatarUnlockInputError'
  }
}

/** Thrown when the member cannot afford the avatar (fail closed, no write). */
export class InsufficientPointsForAvatarError extends Error {
  constructor(
    readonly available: number,
    readonly cost: number,
  ) {
    super(`insufficient reward points: balance ${available} < avatar cost ${cost}`)
    this.name = 'InsufficientPointsForAvatarError'
  }
}

/** The already-validated facts of ONE avatar unlock. */
export interface AvatarUnlockFactsV4 {
  readonly familyId: string
  readonly memberId: string
  /** Avatar catalogue id — the canonical idempotency anchor. */
  readonly avatarId: string
  /** Points COST of the avatar (>= 0). Charged as a negative delta. */
  readonly cost: number
  /** Business time of the unlock (ISO-8601 UTC instant). */
  readonly effectiveAt: string
  /** Write time (ISO-8601 UTC instant). */
  readonly createdAt: string
  /** True only when a fallback cost value was used. */
  readonly estimated?: boolean
  /** Optional family IANA timezone used for streak day-key resolution. */
  readonly timezone?: string
}

export type AvatarUnlockWriteResultV4 = WriterResultV4

/**
 * Build the ONE canonical AVATAR_UNLOCKED V4 event.
 *
 * Pure and deterministic; fails closed via `assertValidEventV4`.
 */
export function buildAvatarUnlockedEventV4(facts: AvatarUnlockFactsV4): GamificationEventV4 {
  if (facts === null || typeof facts !== 'object') {
    throw new AvatarUnlockInputError('avatar unlock facts must be an object')
  }
  assertSegmentV4(facts.familyId, 'familyId')
  assertSegmentV4(facts.memberId, 'memberId')
  assertSegmentV4(facts.avatarId, 'avatarId')
  assertNonNegativeIntegerV4(facts.cost, 'cost')

  const event: GamificationEventV4 = {
    schemaVersion: GAMIFICATION_V4_SCHEMA_VERSION,
    eventId: eventIdFor(facts.familyId, facts.memberId, 'AVATAR_UNLOCKED', facts.avatarId),
    familyId: facts.familyId,
    memberId: facts.memberId,
    eventType: 'AVATAR_UNLOCKED',
    sourceType: SOURCE_TYPE.AVATAR,
    sourceId: facts.avatarId,
    effectiveAt: facts.effectiveAt,
    createdAt: facts.createdAt,
    rewardPointsDelta: -facts.cost,
    // Cosmetic purchases must never touch lifetime progression.
    xpDelta: 0,
    metadata: {
      // The reducer folds unlockedAvatarIds from THIS field only.
      avatarId: facts.avatarId,
      cost: facts.cost,
    },
    estimated: facts.estimated === true,
  }

  assertValidEventV4(event)
  return event
}

/**
 * Apply ONE avatar unlock through the V4 engine.
 *
 * Duplicate probe runs BEFORE the affordability check so re-unlocking an avatar
 * already owned is a no-op rather than a spurious failure.
 */
export async function applyAvatarUnlockV4(
  db: Firestore,
  facts: AvatarUnlockFactsV4,
): Promise<AvatarUnlockWriteResultV4> {
  assertEmulatorOnly('applyAvatarUnlockV4', { familyId: facts?.familyId })

  const event = buildAvatarUnlockedEventV4(facts)

  const existing = await readEvent(db, event.familyId, event.eventId)
  if (existing !== null) {
    return { status: 'duplicate', eventId: event.eventId, event: existing, state: null }
  }

  const current = await readState(db, facts.familyId, facts.memberId)
  const available = current?.rewardPoints ?? 0
  if (available < facts.cost) {
    throw new InsufficientPointsForAvatarError(available, facts.cost)
  }

  return applyEventV4(db, event, { timezone: facts.timezone })
}
