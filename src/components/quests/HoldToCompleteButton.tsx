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
  /* Split so the PRESSED state can keep the fill and the on-brand ink while
     swapping only the shadow. Previously `holding` replaced the whole tone
     string, which dropped `bg-primary-500` AND `text-white` together: the
     button went transparent and its label fell back to inherited ink. On the
     dark-surface themes that was invisible (inherited ink is light), but on a
     LIGHT-surface theme — Calm Pastel — the label became dark ink sitting on
     the dark accent fill, which is how a washed-out CTA happens.

     The tone split keeps reward/XP gold byte-identical: `xp` still fills
     `bg-xp-400` with `text-xp-700` in both states, so no theme can recolour
     earned points. Timing, gesture and completion logic are untouched. */
  const toneFill = tone === 'xp' ? 'bg-xp-400' : 'bg-primary-500';
  const toneInk = tone === 'xp' ? 'text-xp-700' : 'text-white';
  const toneRestShadow =
    tone === 'xp' ? 'shadow-[0_6px_0_0_var(--color-xp-600)]' : 'shadow-[0_6px_0_0_var(--color-primary-700)]';

  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={disabled}
      data-testid="hold-to-complete"
      data-holding={holding || undefined}
      /* Presentation hooks only. The track/fill treatment is themed by the
         child theme scope through `data-qk-progress-track` /
         `data-qk-progress-effect`; the component never learns a theme name, and
         the hold TIMING, press gesture, scroll cancellation and completion
         logic below are untouched. `tone="xp"` deliberately does NOT get these
         hooks: reward/XP gold keeps its own semantic meaning. */
      data-qk-tone={tone}
      className={cn(
        'qk-hold relative isolate flex min-h-14 w-full select-none items-center justify-center gap-2 rounded-2xl px-6',
        'font-button transition-[transform,box-shadow,opacity] duration-[var(--animate-duration-tap)] ease-tap',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        toneFill,
        toneInk,
        holding ? 'translate-y-[4px] shadow-[0_2px_0_0_rgba(0,0,0,0.25)]' : toneRestShadow,
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
      {/* Track + fill: purely decorative presentation layers. The theme scope
          styles them from `data-qk-progress-track` / `data-qk-progress-effect`.
          `aria-hidden`, `pointer-events: none`, and never rendered for
          `tone="xp"` so reward/XP gold keeps its own semantics. */}
      {tone !== 'xp' && (
        <span
          aria-hidden="true"
          data-testid="hold-track"
          className="qk-hold-track pointer-events-none absolute inset-0 rounded-2xl"
        />
      )}
      {tone !== 'xp' && progress > 0 && (
        <span
          aria-hidden="true"
          data-testid="hold-fill"
          className="qk-hold-fill pointer-events-none absolute inset-0 rounded-2xl"
          style={{
            /* Width is the only thing driven by state here — the same progress
               value the completion logic already computed. */
            clipPath: `inset(0 ${(1 - progress) * 100}% 0 0 round 1rem)`,
            /* The theme scope may re-point this at a darker mix: the fill is
               the one surface the light on-brand label is painted ON, so on a
               dark-surface theme the light accent ink would drop it to ~1.4:1.
               Falls back to the existing accent ink, which is what Queki
               Classic and every neutral theme keep. */
            backgroundColor: 'var(--qk-hold-fill, var(--qk-accent-ink))',
          }}
        />
      )}
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
