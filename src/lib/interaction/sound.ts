/**
 * Queki v2 sound controller.
 *
 * Architecture goals (Wave 1):
 *  - globally enable/disable, persisted per device;
 *  - never blocks bootstrap and never loads audio assets up front — cues are
 *    synthesised with a lazily-created WebAudio context on the first user
 *    gesture, so there is no autoplay-on-page-load and no network cost;
 *  - graceful failure: every entry point is a safe no-op when WebAudio is
 *    unavailable, suspended, or the cue fails.
 *
 * Real sound assets (downloaded + cached via the existing service worker) can
 * replace `playCue`'s synthesis later without touching call sites.
 */

export type QuekiSoundCue =
  | 'tap'
  | 'success'
  | 'celebrate'
  | 'error'
  // Wave 2 semantic cues (quest → completion → approval loop):
  | 'holdComplete'
  | 'submit'
  | 'approve'
  | 'reject'
  | 'queueComplete'
  // Wave 3 semantic cues (reward shop → redemption → wallet transfers):
  /** Deliberate redemption confirmation accepted. */
  | 'redeemConfirm'
  /** Confirmed reward unlock moment. */
  | 'rewardUnlock'
  /** Send/request handed to the approval pipeline. */
  | 'transferSent'
  /** Authoritative incoming transfer observed on the ledger. */
  | 'transferReceived'
  // Wave 4 semantic cues (family world → quest milestone → achievements):
  | 'questMilestone'
  | 'questClaim'
  | 'achievement'
  | 'familyCelebration';

const STORAGE_KEY = 'queki.sound.enabled';
const DEFAULT_ENABLED = false; // opt-in: never surprise users with sound

let enabled: boolean | null = null;
let audioContext: AudioContext | null = null;

function readStoredPreference(): boolean {
  if (typeof localStorage === 'undefined') return DEFAULT_ENABLED;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? DEFAULT_ENABLED : raw === 'true';
  } catch {
    return DEFAULT_ENABLED;
  }
}

function persist(value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  } catch {
    /* private mode etc. — preference simply won't persist */
  }
}

/** Current global enablement (defaults to off until the user opts in). */
export function isSoundEnabled(): boolean {
  if (enabled === null) enabled = readStoredPreference();
  return enabled;
}

/** Globally enable/disable all cues. Persists the choice. */
export function setSoundEnabled(value: boolean): void {
  enabled = value;
  persist(value);
}

function resolveContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    if (!audioContext) audioContext = new Ctor();
    // A suspended context (autoplay policy) resumes only inside a user
    // gesture — which is exactly where cues are fired from.
    if (audioContext.state === 'suspended') void audioContext.resume().catch(() => undefined);
    return audioContext.state === 'closed' ? null : audioContext;
  } catch {
    return null;
  }
}

interface CueSpec {
  frequency: number;
  durationMs: number;
  type: OscillatorType;
  gain: number;
  /** Optional terminal frequency for a short pitch slide. */
  slideTo?: number;
}

const CUES: Record<QuekiSoundCue, CueSpec> = {
  tap: { frequency: 520, durationMs: 60, type: 'sine', gain: 0.04 },
  success: { frequency: 620, durationMs: 160, type: 'sine', gain: 0.06, slideTo: 880 },
  celebrate: { frequency: 660, durationMs: 260, type: 'triangle', gain: 0.07, slideTo: 990 },
  error: { frequency: 300, durationMs: 140, type: 'sine', gain: 0.05 },
  // Wave 2 — short, restrained, non-blocking. Same synthesis engine as Wave 1.
  holdComplete: { frequency: 440, durationMs: 70, type: 'sine', gain: 0.04 },
  submit: { frequency: 540, durationMs: 140, type: 'sine', gain: 0.05, slideTo: 760 },
  approve: { frequency: 600, durationMs: 170, type: 'triangle', gain: 0.06, slideTo: 900 },
  reject: { frequency: 340, durationMs: 120, type: 'sine', gain: 0.04, slideTo: 260 },
  queueComplete: { frequency: 620, durationMs: 240, type: 'triangle', gain: 0.06, slideTo: 930 },
  // Wave 3 — reward + wallet moments. Still ≤300ms, opt-in, non-blocking.
  redeemConfirm: { frequency: 560, durationMs: 150, type: 'sine', gain: 0.05, slideTo: 820 },
  rewardUnlock: { frequency: 660, durationMs: 280, type: 'triangle', gain: 0.07, slideTo: 1040 },
  transferSent: { frequency: 500, durationMs: 160, type: 'sine', gain: 0.05, slideTo: 740 },
  transferReceived: { frequency: 700, durationMs: 220, type: 'triangle', gain: 0.06, slideTo: 980 },
  // Wave 4 — family world & quest milestones
  questMilestone: { frequency: 580, durationMs: 180, type: 'sine', gain: 0.06, slideTo: 840 },
  questClaim: { frequency: 640, durationMs: 220, type: 'triangle', gain: 0.07, slideTo: 980 },
  achievement: { frequency: 700, durationMs: 250, type: 'triangle', gain: 0.07, slideTo: 1100 },
  familyCelebration: { frequency: 660, durationMs: 300, type: 'triangle', gain: 0.08, slideTo: 1050 },
};

/**
 * Play a UI cue. Fire-and-forget: resolves immediately, never throws, and is a
 * no-op while sound is disabled or WebAudio is unavailable. Intended to be
 * called from interaction handlers (tap/celebration), never on page load.
 */
export function playCue(cue: QuekiSoundCue): void {
  if (!isSoundEnabled()) return;
  const ctx = resolveContext();
  if (!ctx || ctx.state !== 'running') return;

  const spec = CUES[cue];
  try {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    const now = ctx.currentTime;
    const durationSec = spec.durationMs / 1000;

    oscillator.type = spec.type;
    oscillator.frequency.setValueAtTime(spec.frequency, now);
    if (spec.slideTo) {
      oscillator.frequency.exponentialRampToValueAtTime(spec.slideTo, now + durationSec);
    }

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(spec.gain, now + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + durationSec + 0.02);
    oscillator.onended = () => {
      oscillator.disconnect();
      gainNode.disconnect();
    };
  } catch {
    /* audio must never break an interaction */
  }
}

/** Test hook: reset module state between tests. */
export function resetSoundControllerForTests(): void {
  enabled = null;
  audioContext = null;
}
