import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { triggerHaptic } from '../../lib/interaction/haptics';
import { playCue } from '../../lib/interaction/sound';
import { QUEKI_MOTION, useReducedMotion } from '../../design/motion';

const SCROLL_CANCEL_DISTANCE_PX = 12;

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

/**
 * HoldToCompleteButton — the deliberate quest-completion control.
 *
 * Pointer/touch: press → button depresses → progress ring fills over
 * QUEKI_MOTION.duration.hold ms → threshold fires `onComplete` exactly once.
 * Release early or move far enough to indicate scrolling → clean cancel.
 *
 * Accessibility: the control is a real <button>. Keyboard users (Enter/Space)
 * activate it directly — no hold required — which routes through the exact
 * same single-shot guard. Reduced-motion keeps the deliberate hold duration
 * but suppresses the animated progress sweep.
 *
 * Idempotency: an internal `firedRef` guarantees one call per interaction
 * cycle even under repeated pointer events or re-renders; the parent is
 * expected to disable the control while submitting/pending.
 */
export function HoldToCompleteButton({
  onComplete,
  disabled = false,
  label,
  className,
  tone = 'brand',
}: HoldToCompleteButtonProps) {
  const reducedMotion = useReducedMotion();
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);

  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stopLoop();
    startPointRef.current = null;
    setHolding(false);
    setProgress(0);
    firedRef.current = false;
  }, [stopLoop]);

  useEffect(() => () => stopLoop(), [stopLoop]);

  // Disabled state must never leave a stuck hold behind.
  useEffect(() => {
    if (disabled && holding) reset();
  }, [disabled, holding, reset]);

  const fire = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    stopLoop();
    setProgress(1);
    triggerHaptic('hold');
    playCue('holdComplete');
    onComplete();
  }, [onComplete, stopLoop]);

  const tick = useCallback(
    (nowMs: number) => {
      if (firedRef.current) return;
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

  const beginHold = useCallback(
    (clientX: number, clientY: number) => {
      if (disabled || firedRef.current) return;
      startPointRef.current = { x: clientX, y: clientY };
      setHolding(true);
      setProgress(0);
      startRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    },
    [disabled, tick],
  );

  const cancelHold = useCallback(() => {
    if (firedRef.current) return;
    reset();
  }, [reset]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (disabled || firedRef.current) return;
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
        'relative flex min-h-14 w-full select-none items-center justify-center gap-2 rounded-2xl px-6',
        'font-button transition-[transform,box-shadow,opacity] duration-[var(--animate-duration-tap)] ease-tap',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        holding ? 'translate-y-[4px] shadow-[0_2px_0_0_rgba(0,0,0,0.25)]' : toneClasses,
        className,
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        beginHold(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        const startPoint = startPointRef.current;
        if (!startPoint || firedRef.current) return;
        const distance = Math.hypot(event.clientX - startPoint.x, event.clientY - startPoint.y);
        if (distance <= SCROLL_CANCEL_DISTANCE_PX) return;
        cancelHold();
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture?.(event.pointerId);
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
      {/* Reduced-motion preserves the safety hold but removes the animated sweep. */}
      {!reducedMotion && holding && progress > 0 && (
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
      <span role="status" className="sr-only">
        {progress >= 1 ? label : ''}
      </span>
    </button>
  );
}
