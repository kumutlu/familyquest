import { useEffect, useState } from 'react';

/**
 * Queki v2 motion tokens — mirrored from `src/design/tokens.css`.
 *
 * CSS owns the actual animation timing (via the `--animate-duration-*` and
 * `--ease-*` variables, which collapse to `0ms` under `prefers-reduced-motion`).
 * These constants exist for JS-driven transitions (sheets, celebrations) so
 * TypeScript code and stylesheets can never drift apart.
 */
export const QUEKI_MOTION = {
  duration: {
    tap: 120,
    enter: 240,
    exit: 180,
    sheet: 320,
    card: 260,
    success: 450,
    celebration: 700,
    // Wave 2 (quest → completion → approval loop):
    /** Hold-to-complete fill duration (pointer held). */
    hold: 900,
    /** Review-card fly-off after a committed swipe/button decision. */
    swipeExit: 240,
    /** Next review card entering the deck. */
    nextCardEnter: 260,
    /** Short completion moment overlay before it dismisses itself. */
    completionMoment: 1400,
    // Wave 3 (reward shop → redemption → wallet transfers):
    /** Reward detail surface expanding over the shop grid. */
    rewardDetail: 320,
    /** Numeric balance/points count-up transition after authoritative change. */
    balanceCount: 600,
    /** Staged send-flow step transition (WHO → AMOUNT → REVIEW). */
    stageEnter: 240,
    /** Coin token travelling sender → recipient in the arrival moment. */
    tokenTravel: 700,
  },
  easing: {
    tap: 'cubic-bezier(0.2, 0, 0, 1)',
    enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)',
    sheet: 'cubic-bezier(0.32, 0.72, 0, 1)',
    celebrate: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    /** Direct-manipulation drag release / card exit. */
    swipeExit: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  },
} as const;

/** Swipe Review gesture thresholds (fractions of card width). */
export const SWIPE_REVIEW = {
  /** |dx| beyond this fraction of the card width commits the intent. */
  commitThreshold: 0.32,
  /** Drag resistance factor applied past the threshold (rubber-banding). */
  resistance: 0.35,
  /** Max rotation in degrees at the commit threshold. */
  maxRotationDeg: 8,
} as const;

const QUERY = '(prefers-reduced-motion: reduce)';

/** Synchronous capability check (safe on servers / old browsers). */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(QUERY).matches;
  } catch {
    return false;
  }
}

/** Subscribe to reduced-motion changes. Returns an unsubscribe function. */
export function subscribeReducedMotion(callback: (reduced: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  try {
    const mql = window.matchMedia(QUERY);
    const handler = (event: MediaQueryListEvent) => callback(event.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  } catch {
    return () => undefined;
  }
}

/**
 * React hook exposing the live reduced-motion preference. Centralises the
 * detection so no component ever talks to `matchMedia` directly.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    setReduced(prefersReducedMotion());
    return subscribeReducedMotion(setReduced);
  }, []);

  return reduced;
}
