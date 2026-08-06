/**
 * RewardCelebrationOverlay
 * ---------------------------------------------------------------------------
 * Production React recreation of the Canva reward celebration reference
 * (docs/design-references/reward-celebration-canva.html).
 *
 * The Canva export is treated ONLY as a visual/animation reference:
 *  - no Canva SDK, no CDN scripts, no Tailwind CDN, no Google Fonts
 *  - icons come from the app's existing icon library (lucide-react)
 *  - all animation is local CSS + a small canvas confetti loop
 *
 * The overlay is presentational: it never performs a redemption. It is opened
 * by the caller only after the real redemption promise has resolved.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Gift } from 'lucide-react';
import './rewardCelebration.css';

export type RewardCelebrationOverlayProps = {
  open: boolean;
  rewardTitle: string;
  rewardIcon?: React.ReactNode;
  beforePoints: number;
  afterPoints: number;
  parentNotificationSent?: boolean;
  onClose: () => void;
};

const CONFETTI_COLORS = ['#ff6b54', '#ffc84a', '#32d1a0', '#75d7ff', '#ffffff', '#a983ff'];

type Particle = {
  x: number; y: number; size: number; color: string;
  vx: number; vy: number; rotation: number; rotationSpeed: number;
  gravity: number; shape: 'rect' | 'circle';
};

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Optional success chime. Fails silently when Web Audio is unavailable. */
function playSuccessSound(): (() => void) | undefined {
  try {
    const AudioContextClass =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return undefined;

    const audioContext = new AudioContextClass();
    const now = audioContext.currentTime;
    const notes = [
      { frequency: 523.25, time: now, duration: 0.11 },
      { frequency: 659.25, time: now + 0.11, duration: 0.12 },
      { frequency: 783.99, time: now + 0.23, duration: 0.24 },
    ];

    notes.forEach((note) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(note.frequency, note.time);
      gain.gain.setValueAtTime(0.0001, note.time);
      gain.gain.exponentialRampToValueAtTime(0.12, note.time + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, note.time + note.duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(note.time);
      oscillator.stop(note.time + note.duration + 0.03);
    });

    // Returned so the caller can close the context on unmount/dismissal.
    return () => {
      try { audioContext.close(); } catch { /* already closed */ }
    };
  } catch {
    // Sound is an enhancement; the visual celebration remains fully functional.
    return undefined;
  }
}

export function RewardCelebrationOverlay({
  open,
  rewardTitle,
  rewardIcon,
  beforePoints,
  afterPoints,
  parentNotificationSent = false,
  onClose,
}: RewardCelebrationOverlayProps) {
  const [revealed, setRevealed] = useState(false);
  const [ready, setReady] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const timersRef = useRef<number[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const closeAudioRef = useRef<(() => void) | undefined>(undefined);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const stopConfetti = useCallback(() => {
    // Called unconditionally: the confetti loop must never survive dismissal.
    cancelAnimationFrame(frameRef.current ?? 0);
    frameRef.current = null;
    particlesRef.current = [];
    const canvas = canvasRef.current;
    const context = canvas?.getContext?.('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  }, []);

  const teardown = useCallback(() => {
    clearTimers();
    stopConfetti();
    closeAudioRef.current?.();
    closeAudioRef.current = undefined;
  }, [clearTimers, stopConfetti]);

  // -------------------------------------------------------------- lifecycle
  useEffect(() => {
    if (!open) {
      teardown();
      setRevealed(false);
      setReady(false);
      return;
    }

    previouslyFocusedRef.current =
      (document.activeElement as HTMLElement | null) ?? null;

    const reduced = prefersReducedMotion();

    if (reduced) {
      // No confetti, no sound, no staged timing: show the final state at once.
      setRevealed(true);
      setReady(true);
      buttonRef.current?.focus();
    } else {
      closeAudioRef.current = playSuccessSound();
      startConfetti();
      timersRef.current.push(window.setTimeout(() => setRevealed(true), 420));
      timersRef.current.push(
        window.setTimeout(() => {
          setReady(true);
          buttonRef.current?.focus();
        }, 2350),
      );
    }

    return () => {
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Unmount safety net: nothing may keep running after the overlay goes away.
  useEffect(() => () => teardown(), [teardown]);

  const handleClose = useCallback(() => {
    teardown();
    const restoreTo = previouslyFocusedRef.current;
    onClose();
    if (restoreTo && typeof restoreTo.focus === 'function') restoreTo.focus();
  }, [onClose, teardown]);

  // Escape closes; Tab is trapped on the single actionable control.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, handleClose]);

  // -------------------------------------------------------------- confetti
  function resizeCanvas() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext?.('2d');
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * ratio;
    canvas.height = window.innerHeight * ratio;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function animateConfetti() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext?.('2d');
    if (!canvas || !context) return;

    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    particlesRef.current.forEach((particle) => {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += particle.gravity;
      particle.rotation += particle.rotationSpeed;

      context.save();
      context.translate(particle.x, particle.y);
      context.rotate(particle.rotation);
      context.fillStyle = particle.color;
      if (particle.shape === 'circle') {
        context.beginPath();
        context.arc(0, 0, particle.size * 0.55, 0, Math.PI * 2);
        context.fill();
      } else {
        context.fillRect(-particle.size / 2, -particle.size * 0.3, particle.size, particle.size * 0.6);
      }
      context.restore();
    });

    particlesRef.current = particlesRef.current.filter(
      (particle) => particle.y < window.innerHeight + 36,
    );

    frameRef.current = particlesRef.current.length
      ? requestAnimationFrame(animateConfetti)
      : null;
  }

  function startConfetti() {
    if (!canvasRef.current?.getContext?.('2d')) return;
    resizeCanvas();
    particlesRef.current = Array.from({ length: 170 }, (_, index) => ({
      x: Math.random() * window.innerWidth,
      y: -30 - Math.random() * window.innerHeight * 0.45,
      size: 6 + Math.random() * 8,
      color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
      vx: -2.5 + Math.random() * 5,
      vy: 2.4 + Math.random() * 4.6,
      rotation: Math.random() * Math.PI,
      rotationSpeed: -0.16 + Math.random() * 0.32,
      gravity: 0.075 + Math.random() * 0.07,
      shape: Math.random() > 0.22 ? 'rect' : 'circle',
    }));
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(animateConfetti);
  }

  if (!open) return null;

  const overlay = (
    <div
      className={[
        'rc-overlay',
        'is-open',
        revealed ? 'is-revealed' : '',
        ready ? 'is-ready' : '',
      ].filter(Boolean).join(' ')}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reward-celebration-title"
      data-testid="reward-celebration-overlay"
      data-reduced-motion={prefersReducedMotion() ? 'true' : 'false'}
    >
      <canvas ref={canvasRef} className="rc-canvas" aria-hidden="true" data-testid="reward-celebration-confetti" />

      <section className="rc-panel">
        <div className="rc-gift" aria-hidden="true" data-testid="reward-celebration-gift">
          <div className="rc-gift-bow" />
          <div className="rc-gift-lid" />
          <div className="rc-gift-box" />
        </div>

        <div className="rc-reveal">
          <div className="rc-reward-icon" aria-hidden="true">
            {rewardIcon ?? <Gift size={38} />}
          </div>
          <p className="rc-reward-title" data-testid="reward-celebration-reward-title">
            {rewardTitle}
          </p>
        </div>

        <h2 className="rc-title" id="reward-celebration-title">Reward Requested!</h2>
        <p className="rc-kicker">Nice choice!</p>

        <div
          className="rc-points"
          data-testid="reward-celebration-points"
          aria-label={`Points changed from ${beforePoints} to ${afterPoints}`}
        >
          <strong data-testid="reward-celebration-points-before">{beforePoints}</strong>
          <ArrowRight size={20} aria-hidden="true" />
          <strong data-testid="reward-celebration-points-after">{afterPoints}</strong>
        </div>

        {parentNotificationSent && (
          <p className="rc-message" data-testid="reward-celebration-parent-note">
            Your parent has been notified.
          </p>
        )}

        <button
          type="button"
          ref={buttonRef}
          className="rc-button"
          onClick={handleClose}
          data-testid="reward-celebration-awesome"
        >
          Awesome!
        </button>
      </section>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(overlay, document.body)
    : overlay;
}

export default RewardCelebrationOverlay;
