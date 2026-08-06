/**
 * Gamification V4 — pure projection reducer (Task 1.9).
 *
 * Pure domain module: no Firestore, no Cloud Functions, no clock access, no
 * randomness. Folds an immutable V4 event ledger into the authoritative
 * `GamificationStateV4` projection.
 *
 * Responsibilities are deliberately narrow:
 *   - fold events (canonical order via `canonicalOrder`)
 *   - update authoritative projection fields (rewardPoints, xpTotal, avatars)
 *   - call canonical helpers (levelForXp, computeStreak, deriveAchievements,
 *     deriveUnlockedAvatars) — never duplicate their behaviour
 *   - return immutable state (never mutate caller input)
 *
 * RewardPoints clamping lives in exactly one place (`clampRewardPoints`).
 * XP only decreases through reversal semantics (enforced by
 * `assertXpOnlyDecreasesViaReversal` on every folded event).
 *
 * See docs/gamification-v4-design.md §2.4 and plan Task 1.9.
 */

import type { GamificationEventV4 } from './event'
import type { GamificationStateV4 } from './types'
import { canonicalOrder } from './ordering'
import { levelForXp } from './level'
import { computeStreak, dayKeyFor } from './streak'
import { deriveAchievements, deriveUnlockedAvatars } from './achievements'
import { assertXpOnlyDecreasesViaReversal } from './validators'

/** Context supplied by the caller (no clock access inside the reducer). */
export interface ReduceContextV4 {
  /** ISO-8601 UTC instant stamped on the resulting projection. */
  readonly updatedAt: string
  /** Projection engine version stamped on the resulting projection. */
  readonly projectionVersion: number
  /** Optional explicit "as of" day key for streak; else derived from ledger. */
  readonly asOfDayKey?: string
  /** Optional family IANA timezone for day-key resolution. */
  readonly timezone?: string
}

/** Sentinel day key used only when the ledger is empty and no ctx day is given. */
const EPOCH_DAY_KEY = '1970-01-01'

const BASELINE_STATE: GamificationStateV4 = {
  rewardPoints: 0,
  xpTotal: 0,
  level: 1,
  xpProgressInLevel: 0,
  xpToNextLevel: 1000,
  levelProgressPercentage: 0,
  currentStreak: 0,
  bestStreak: 0,
  lastQualifiedDayKey: null,
  unlockedAchievementIds: [],
  unlockedAvatarIds: [],
  projectionVersion: 0,
  foldedThroughEventId: null,
  updatedAt: EPOCH_DAY_KEY + 'T00:00:00.000Z',
}

/** Single clamping site: rewardPoints is never allowed below zero. */
function clampRewardPoints(value: number): number {
  return value < 0 ? 0 : value
}

function avatarIdFromEvent(event: GamificationEventV4): string | null {
  const id = event.metadata?.avatarId
  return typeof id === 'string' && id.length > 0 ? id : null
}

/**
 * Fold a single event into the authoritative projection.
 *
 * Pure: `state` and `event` are never mutated. Only `rewardPoints`, `xpTotal`,
 * and `unlockedAvatarIds` are accumulated here; the derived fields
 * (level/streak/achievements) are recomputed by `reduceGamificationEventsV4`
 * from the full ledger so they are never stale or duplicated.
 */
export function foldEvent(state: GamificationStateV4, event: GamificationEventV4): GamificationStateV4 {
  // XP may only decrease through reversal semantics (Task 1.8). Reused helper.
  assertXpOnlyDecreasesViaReversal(event)

  const rewardPoints = clampRewardPoints(state.rewardPoints + event.rewardPointsDelta)
  const xpTotal = state.xpTotal + event.xpDelta

  let unlockedAvatarIds = state.unlockedAvatarIds
  const avatarId = avatarIdFromEvent(event)
  if (avatarId !== null && !unlockedAvatarIds.includes(avatarId)) {
    unlockedAvatarIds = [...unlockedAvatarIds, avatarId].sort()
  }

  return {
    ...state,
    rewardPoints,
    xpTotal,
    unlockedAvatarIds,
  }
}

/**
 * Reduce a full V4 ledger into the authoritative projection.
 *
 * Pure and deterministic: identical ledger + ctx always yields byte-identical
 * business fields. The ledger is canonical-ordered, folded, then level/streak/
 * achievements/avatars are derived exclusively via the canonical helpers.
 */
export function reduceGamificationEventsV4(
  events: readonly GamificationEventV4[],
  ctx: ReduceContextV4,
): GamificationStateV4 {
  const ordered = canonicalOrder(events)

  let acc: GamificationStateV4 = { ...BASELINE_STATE }
  for (const event of ordered) {
    acc = foldEvent(acc, event)
  }

  const timezone = ctx.timezone
  const asOfDayKey =
    ctx.asOfDayKey ??
    (ordered.length > 0
      ? dayKeyFor(ordered[ordered.length - 1].effectiveAt, timezone)
      : EPOCH_DAY_KEY)

  // Derived fields — computed exactly once, via canonical helpers only.
  const level = levelForXp(acc.xpTotal)
  const streak = computeStreak(ordered, asOfDayKey, timezone)
  const derived: GamificationStateV4 = {
    ...acc,
    ...level,
    currentStreak: streak.currentStreak,
    bestStreak: streak.bestStreak,
    lastQualifiedDayKey: streak.lastQualifiedDayKey,
  }
  const unlockedAchievementIds = deriveAchievements(derived)
  const unlockedAvatarIds = deriveUnlockedAvatars(derived)

  const foldedThroughEventId = ordered.length > 0 ? ordered[ordered.length - 1].eventId : null

  return {
    ...derived,
    unlockedAchievementIds,
    unlockedAvatarIds,
    projectionVersion: ctx.projectionVersion,
    foldedThroughEventId,
    updatedAt: ctx.updatedAt,
  }
}
