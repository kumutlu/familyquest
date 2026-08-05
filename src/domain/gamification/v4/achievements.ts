/**
 * Gamification V4 — achievement & avatar derivation (Task 1.7).
 *
 * Pure, deterministic projection of `unlockedAchievementIds` and
 * `unlockedAvatarIds` from the authoritative V4 state. No UI unlock logic,
 * no Firestore, no Cloud Functions, no clock access.
 *
 * Per design §3.5, achievements are derived exclusively from `xpTotal`,
 * `level`, `streak` (bestStreak), and `unlockedAvatarIds`. Reward Points are
 * explicitly NOT an achievement input in V4 (they drive affordability only).
 *
 * Invariant: same state -> identical derived ids, byte for byte. The caller's
 * `state` is never mutated.
 *
 * See docs/gamification-v4-design.md §3.5 and
 * docs/superpowers/plans/2026-08-05-gamification-v4-rewrite.md Task 1.7.
 */

import type { GamificationStateV4 } from './types'
import { assertValidStateV4 } from './validators'

/** Canonical V4 achievement definition (design §3.5). */
export interface AchievementDefinitionV4 {
  /** Stable, unique achievement id. */
  readonly id: string
  /** Human-readable name (UI label only; never used for derivation). */
  readonly name: string
  /** Pure predicate over the authoritative V4 state. */
  readonly check: (state: GamificationStateV4) => boolean
}

/**
 * Canonical V4 achievement catalogue. Single source of truth for badge
 * unlock logic — the UI only renders labels/icons from these ids. Derived
 * exclusively from `xpTotal`, `level`, and `bestStreak` (the V4 "streak").
 */
export const ACHIEVEMENTS_V4: readonly AchievementDefinitionV4[] = Object.freeze([
  {
    id: 'first_steps',
    name: 'First Steps',
    check: (s) => s.xpTotal >= 50,
  },
  {
    id: 'centurion',
    name: 'Centurion',
    check: (s) => s.xpTotal >= 1000,
  },
  {
    id: 'champion',
    name: 'Family Champion',
    check: (s) => s.xpTotal >= 5000,
  },
  {
    id: 'streak_starter',
    name: 'On Fire',
    check: (s) => s.bestStreak >= 3,
  },
  {
    id: 'streak_master',
    name: 'Streak Master',
    check: (s) => s.bestStreak >= 7,
  },
  {
    id: 'level_five',
    name: 'Rising Star',
    check: (s) => s.level >= 5,
  },
])

/**
 * Derive the unlocked achievement ids for a V4 state.
 *
 * Pure and deterministic: identical `state` always yields the same sorted id
 * list. Malformed state fails loudly via `assertValidStateV4` (never silently
 * coerced). The caller's `state` is never mutated.
 */
export function deriveAchievements(state: GamificationStateV4): string[] {
  assertValidStateV4(state)

  const ids: string[] = []
  for (const def of ACHIEVEMENTS_V4) {
    if (def.check(state)) ids.push(def.id)
  }
  // Deterministic, stable order independent of catalogue ordering.
  return ids.sort()
}

/**
 * Derive the unlocked avatar ids for a V4 state.
 *
 * The unlocked avatars are a projection-derived fact already present on the
 * state (`unlockedAvatarIds`); this returns a defensive copy so callers can
 * never mutate the authoritative projection. Malformed state fails loudly.
 */
export function deriveUnlockedAvatars(state: GamificationStateV4): string[] {
  assertValidStateV4(state)
  // Defensive copy: never return the caller's (or state's) live array.
  return [...state.unlockedAvatarIds]
}
