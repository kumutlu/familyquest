/**
 * Gamification V4 — canonical level calculation (Task 1.5).
 *
 * Single source of truth for level progression. Derived exclusively from
 * `xpTotal` (design §3.3). No UI formula, no client arithmetic, no Firestore,
 * no configurable parameters — the V4 curve is defined explicitly here so it
 * can never drift from a duplicated V2/V3 formula.
 *
 * Invariant: same `xpTotal` -> identical progression fields, byte for byte.
 *
 * See docs/gamification-v4-design.md §3.3 and
 * docs/superpowers/plans/2026-08-05-gamification-v4-rewrite.md Task 1.5.
 */

/** Fixed V4 level span. Explicit (not a parameter) so the curve is canonical. */
export const XP_PER_LEVEL_V4 = 1000 as const

/** Canonical progression derived from `xpTotal` only. */
export interface LevelProgressV4 {
  /** 1-based level, derived as floor(xpTotal / XP_PER_LEVEL_V4) + 1. */
  readonly level: number
  /** XP accumulated inside the current level (0 .. XP_PER_LEVEL_V4 - 1). */
  readonly xpProgressInLevel: number
  /** Remaining XP until the next level (XP_PER_LEVEL_V4 - xpProgressInLevel). */
  readonly xpToNextLevel: number
  /** Integer 0..100, floor(progress / span * 100), drift-free via BigInt. */
  readonly levelProgressPercentage: number
}

function assertValidXpTotal(xpTotal: number): void {
  if (!Number.isSafeInteger(xpTotal) || xpTotal < 0) {
    throw new Error(
      `xpTotal must be a non-negative safe integer (received ${String(xpTotal)})`,
    )
  }
}

/**
 * Canonical V4 level derivation. Pure and deterministic: identical `xpTotal`
 * always yields identical progression fields. Rejects invalid XP inputs per the
 * approved contract (non-negative safe integer).
 */
export function levelForXp(xpTotal: number): LevelProgressV4 {
  assertValidXpTotal(xpTotal)

  const level = Math.floor(xpTotal / XP_PER_LEVEL_V4) + 1
  const xpProgressInLevel = xpTotal % XP_PER_LEVEL_V4
  const xpToNextLevel = XP_PER_LEVEL_V4 - xpProgressInLevel

  // Integer floor via BigInt — never a floating-point percentage.
  const rawPercentage = Number(
    (BigInt(xpProgressInLevel) * 100n) / BigInt(XP_PER_LEVEL_V4),
  )
  const levelProgressPercentage = Math.min(100, Math.max(0, rawPercentage))

  return {
    level,
    xpProgressInLevel,
    xpToNextLevel,
    levelProgressPercentage,
  }
}
