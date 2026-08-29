import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { triggerHaptic } from '../../lib/interaction/haptics';
import { playCue } from '../../lib/interaction/sound';
import { QUEKI_MOTION } from '../../design/motion';

export interface HoldToCompleteButtonProps {
  /** Fires EXACTLY once per successful hold / keyboard activation. */
  onComplete: () => void;
  disabled?: boolean;
  /** Accessible name (e.g. "Complete: Feed the cat"). */
  label: string;
  className?: string;
  /** Visual variant of the big completion control. */
  tone?: 'brand' | 'xp';
}

const MOVE_CANCEL_THRESHOLD_PX = 10;

/**
 * HoldToCompleteButton — the deliberate quest-completion control.
 *
 * Pointer/touch: press → button depresses → progress ring fills over
 * QUEKI_MOTION.duration.hold ms → threshold fires `onComplete` exactly once.
 * Release early, pointer cancellation, or a scroll-sized pointer movement →
 * clean cancel (progress resets).
 *
 * The 900ms hold is an interaction-safety requirement, not decorative motion,
 * so `prefers-reduced-motion` never bypasses the threshold. Keyboard users can
 * still activate with Enter/Space without a timed hold.
 *
 * Idempotency: internal refs guarantee one call per interaction cycle and make
 * stale/cancelled animation frames harmless. The parent disables the control
 * while submitting/pending.
 */
export function HoldToCompleteButton({
  onComplete,
  disabled = false,
  label,
  className,
  tone = 'brand',
}: HoldToCompleteButtonProps) {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);

  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const firedRef = useRef(false);
  const holdActiveRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    holdActiveRef.current = false;
    activePointerIdRef.current = null;
    pointerStartRef.current = null;
    stopLoop();
    setHolding(false);
    setProgress(0);
    firedRef.current = false;
  }, [stopLoop]);

  useEffect(() => () => {
    holdActiveRef.current = false;
    stopLoop();
  }, [stopLoop]);

  // Disabled state must never leave a stuck hold behind.
  useEffect(() => {
    if (disabled && holdActiveRef.current) reset();
  }, [disabled, reset]);

  const fire = useCallback(() => {
    if (firedRef.current || !holdActiveRef.current) return;
    firedRef.current = true;
    holdActiveRef.current = false;
    stopLoop();
    setProgress(1);
    triggerHaptic('hold');
    playCue('holdComplete');
    onComplete();
  }, [onComplete, stopLoop]);

  const tick = useCallback(
    (nowMs: number) => {
      // A cancelled rAF can race with pointer cancellation on some WebViews.
      // Treat the interaction ref as the authority so a stale frame can never
      // complete a task after the child has started scrolling.
      if (!holdActiveRef.current || firedRef.current) return;
      const elapsed = nowMs - startRef.current;
      const fraction = Math.min(1, elapsed / QUEKI_MOTION.duration.hold);
      setProgress(fraction);
      if (fraction >= 1) {
        fire();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    },
    [fire],
  );

  const beginHold = useCallback(() => {
    if (disabled || firedRef.current || holdActiveRef.current) return;
    holdActiveRef.current = true;
    setHolding(true);
    setProgress(0);
    startRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
  }, [disabled, tick]);

  const cancelHold = useCallback(() => {
    if (!holdActiveRef.current || firedRef.current) return;
    reset();
  }, [reset]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (disabled || firedRef.current) return;

    // Keyboard activation is the accessible alternative to a timed pointer
    // hold. Mark a synthetic interaction active so it shares the single-shot
    // fire guard without weakening pointer/touch safety.
    holdActiveRef.current = true;
    fire();
  };

  const ringDegrees = Math.round(progress * 360);
  const toneClasses =
    tone === 'xp'
      ? 'bg-xp-400 text-xp-700 shadow-[0_6px_0_0_var(--color-xp-600)]'
      : 'bg-primary-500 text-white shadow-[0_6px_0_0_var(--color-primary-700)]';

  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={disabled}
      data-testid="hold-to-complete"
      data-holding={holding || undefined}
      disabled={disabled}
      className={cn(
        'relative flex min-h-14 w-full touch-pan-y select-none items-center justify-center gap-2 rounded-2xl px-6',
        'font-button transition-[transform,box-shadow,opacity] duration-[var(--animate-duration-tap)] ease-tap',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        holding ? 'translate-y-[4px] shadow-[0_2px_0_0_rgba(0,0,0,0.25)]' : toneClasses,
        className,
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // Do NOT capture touch pointers here. Native vertical scrolling must be
        // free to take ownership and emit pointercancel when the gesture pans.
        activePointerIdRef.current = event.pointerId;
        pointerStartRef.current = { x: event.clientX, y: event.clientY };
        beginHold();
      }}
      onPointerMove={(event) => {
        if (!holdActiveRef.current || firedRef.current) return;
        if (
          activePointerIdRef.current !== null &&
          event.pointerId !== activePointerIdRef.current
        ) {
          return;
        }
        const start = pointerStartRef.current;
        if (!start) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.hypot(dx, dy) >= MOVE_CANCEL_THRESHOLD_PX) {
          cancelHold();
        }
      }}
      onPointerUp={() => {
        if (firedRef.current) {
          reset();
          return;
        }
        cancelHold();
      }}
      onPointerCancel={cancelHold}
      onPointerLeave={() => {
        if (!firedRef.current) cancelHold();
      }}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* Progress sweep — conic gradient driven by hold progress. */}
      {holding && progress > 0 && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-2xl opacity-40"
          style={{
            background: `conic-gradient(currentColor ${ringDegrees}deg, transparent ${ringDegrees}deg)`,
          }}
        />
      )}
      <span className="relative z-10 inline-flex items-center gap-2">
        {progress >= 1 || firedRef.current ? (
          <>✓</>
        ) : (
          <span aria-hidden="true">⏱</span>
        )}
        <span>{firedRef.current || progress >= 1 ? '' : label}</span>
      </span>
      {/* Screen-reader announcement channel for state changes. */}
      <span role="status" className="sr-only">
        {progress >= 1 ? label : ''}
      </span>
    </button>
  );
}
