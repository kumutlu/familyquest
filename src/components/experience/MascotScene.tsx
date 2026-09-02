/**
 * <MascotScene /> — productized mascot composition for the Child Home.
 *
 * Renders the Queki mascot as a character, not a row:
 *   - The mascot floats partially OUTSIDE a soft speech-bubble card.
 *   - The speech bubble carries the Mascot Engine's deterministic line
 *     for the current context. We do NOT generate copy at runtime.
 *   - The composition reacts visually to the resolved mood (slight tilt /
 *     breathing scale), without overdoing motion.
 *   - The mascot honours seasonal costumes from the engine via the same
 *     presentation bundle.
 *
 * Rules
 *   - PRESENTATION ONLY. No XP / points / streak mutation. No Firestore
 *     writes. No chat completions.
 *   - Reduced motion collapses both the entrance and the breathing scale.
 *   - The mascot is keyboard-focusable only as an aria-labelled image
 *     (NOT a button). The existing mascot strip is NOT recreated here;
 *     we replace it with this richer composition.
 */

import { useEffect, useMemo, useState } from 'react';
import { Mascot as EngineMascot } from '../mascot/Mascot';
import { MascotMessage } from '../mascot/MascotMessage';
import type { MascotPresentation } from '../../domain/mascot';
import { cn } from '../../lib/utils';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export interface MascotSceneProps {
  /** Authoritative mascot presentation from the Mascot Engine. */
  readonly presentation: MascotPresentation | null;
  /** Pre-formatted deterministic line from the engine. NEVER user text. */
  readonly message: string;
  /** Optional override greeting prefix (e.g. "Morning, Mostium..."). */
  readonly greeting?: string;
  readonly className?: string;
}

/**
 * Map the mascot mood onto a very small set of visual treatments. The
 * mood itself is NOT inspected for behaviour here — only for the
 * gentle breathing/tilt cue.
 */
function moodCue(mood: MascotPresentation['mood'] | undefined): string {
  switch (mood) {
    case 'celebrating':
    case 'excited':
      return 'qk-mascot-cue--cheer';
    case 'welcome_back':
      return 'qk-mascot-cue--wave';
    case 'sleepy':
    case 'sad':
      return 'qk-mascot-cue--soft';
    case 'curious':
    case 'suspicious':
      return 'qk-mascot-cue--tilt';
    default:
      return '';
  }
}

/**
 * Render the mascot as a character. The composition is intentionally
 * compact so it never overwhelms the rest of the page.
 */
export function MascotScene({
  presentation,
  message,
  greeting,
  className,
}: MascotSceneProps) {
  const cue = useMemo(() => moodCue(presentation?.mood), [presentation?.mood]);

  // Reduced motion is a hydration-sensitive value: we read it on mount
  // and re-check on change so a user toggling the OS setting gets the
  // right path.
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReducedMotion(mql.matches);
    apply();
    mql.addEventListener?.('change', apply);
    return () => mql.removeEventListener?.('change', apply);
  }, []);

  return (
    <section
      aria-label="Queki"
      data-testid="mascot-scene"
      data-mascot-mood={presentation?.mood ?? 'friendly'}
      className={cn('qk-mascot-scene relative', className)}
    >
      {/* Speech bubble — floats over the mascot shoulder */}
      <div
        data-testid="mascot-scene-bubble"
        className={cn(
          'qk-mascot-bubble relative rounded-card qk-bg-card qk-border-subtle qk-shadow-card border',
          'pl-20 sm:pl-24',
          reducedMotion ? '' : 'qk-mascot-bubble--enter',
        )}
      >
        {/* Optional greeting prefix above the message body. */}
        {greeting ? (
          <p
            data-testid="mascot-scene-greeting"
            className="text-meta font-semibold uppercase tracking-wide qk-text-secondary"
          >
            {greeting}
          </p>
        ) : null}
        <MascotMessage
          presentation={presentation}
          message={message}
          className="qk-text-primary mt-0.5 text-body font-semibold"
          testId="mascot-scene-message"
        />
      </div>

      {/* Mascot character — partially OUTSIDE the bubble. The negative
          margin lets the head & shoulders peek above the surface. */}
      <div
        data-testid="mascot-scene-character"
        className={cn(
          'qk-mascot-character pointer-events-none absolute',
          'left-3 sm:left-5',
          '-top-7 sm:-top-9',
          reducedMotion ? '' : cue,
        )}
      >
        <EngineMascot
          presentation={presentation}
          size={64}
          className="drop-shadow-md"
        />
      </div>
    </section>
  );
}

export default MascotScene;