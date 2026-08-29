import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { triggerHaptic } from '../../lib/interaction/haptics';
import { playCue } from '../../lib/interaction/sound';
import { QUEKI_MOTION, useReducedMotion } from '../../design/motion';

const SCROLL_CANCEL_DISTANCE_PX = 12;

export interface HoldToCompleteButtonProps {
  onComplete: () => void;
  disabled?: boolean;
  label: string;
  className?: string;
  tone?: 'brand' | 'xp';
}

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
  const activeHoldRef = useRef(false);
  const firedRef = useRef(false);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    activeHoldRef.current = false;
    stopLoop();
    startPointRef.current = null;
    setHolding(false);
    setProgress(0);
    firedRef.current = false;
  }, [stopLoop]);

  useEffect(() => () => stopLoop(), [stopLoop]);

  useEffect(() => {
    if (disabled && holding) reset();
  }, [disabled, holding, reset]);

  const fire = useCallback(() => {
    if (!activeHoldRef.current || firedRef.current) return;
    firedRef.current = true;
    stopLoop();
    setProgress(1);
    triggerHaptic('hold');
    playCue('holdComplete');
    onComplete();
  }, [onComplete, stopLoop]);

  const tick = useCallback(
    (nowMs: number) => {
      if (!activeHoldRef.current || firedRef.current) return;
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
      if (disabled || firedRef.current || activeHoldRef.current) return;
      activeHoldRef.current = true;
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
    activeHoldRef.current = true;
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
        {progress >= 1 || firedRef.current ? <>✓</> : <span aria-hidden="true">⏱</span>}
        <span>{firedRef.current || progress >= 1 ? '' : label}</span>
      </span>
      <span role="status" className="sr-only">{progress >= 1 ? label : ''}</span>
    </button>
  );
}
