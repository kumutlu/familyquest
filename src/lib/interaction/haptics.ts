/**
 * Queki v2 haptics abstraction.
 *
 * The web platform has exactly one practical primitive: `navigator.vibrate`
 * (Android Chrome; unsupported on iOS Safari). This module:
 *  - capability-detects once and never calls the API when absent,
 *  - wraps every call in try/catch (some engines throw on invalid patterns),
 *  - keeps patterns subtle (≤ 20ms for taps) and clamps durations,
 *  - exposes `hapticsSupported()` so settings UI can be honest about what the
 *    platform can do instead of faking haptics with intrusive behaviour.
 *
 * There is intentionally no global on/off toggle yet: feedback is subtle-only
 * and platform-constrained. A user preference arrives with Wave 2 settings.
 */

export type QuekiHapticPattern =
  | 'tap'
  | 'success'
  | 'celebrate'
  | 'error'
  // Wave 2 semantic patterns (quest → completion → approval loop):
  | 'hold'
  | 'submit'
  | 'approve'
  | 'reject'
  | 'queueComplete'
  // Wave 3 semantic patterns (reward redemption + family transfers):
  /** Deliberate redemption confirmation accepted. */
  | 'redeemConfirm'
  /** Confirmed reward unlock moment. */
  | 'rewardUnlock'
  /** Send/request handed to the approval pipeline. */
  | 'transferSent'
  /** Authoritative incoming transfer observed on the ledger. */
  | 'transferReceived';

const PATTERNS: Record<QuekiHapticPattern, number[]> = {
  tap: [8],
  success: [12, 40, 12],
  celebrate: [10, 30, 10, 30, 18],
  error: [18],
  // Wave 2 — subtle, distinct, still ≤60ms per segment.
  hold: [10],
  submit: [10, 30, 14],
  approve: [12, 35, 12],
  reject: [16],
  queueComplete: [10, 25, 10, 25, 14],
  // Wave 3 — reward + wallet moments. Same subtlety contract.
  redeemConfirm: [12, 30, 12],
  rewardUnlock: [10, 25, 10, 25, 18],
  transferSent: [10, 30, 12],
  transferReceived: [12, 25, 12, 25, 16],
};

const MAX_DURATION_MS = 60;

function vibrate(): ((pattern: number | number[]) => boolean) | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as unknown as { vibrate?: (p: number | number[]) => boolean };
  return typeof nav.vibrate === 'function' ? nav.vibrate.bind(nav) : null;
}

/** True only when the current platform exposes a usable vibration API. */
export function hapticsSupported(): boolean {
  return vibrate() !== null;
}

/**
 * Fire a subtle haptic pattern. Safe no-op everywhere the platform cannot or
 * will not vibrate. Never throws.
 */
export function triggerHaptic(pattern: QuekiHapticPattern): void {
  const fn = vibrate();
  if (!fn) return;
  const raw = PATTERNS[pattern];
  // Clamp every segment so no engine rejects an over-long pattern and the
  // sensation stays "subtle feedback", never an alert.
  const clamped = raw.map(segment => Math.min(Math.max(0, Math.round(segment)), MAX_DURATION_MS));
  try {
    fn(clamped);
  } catch {
    /* ignore: haptics must never break an interaction */
  }
}
