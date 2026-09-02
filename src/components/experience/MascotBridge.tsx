/**
 * <MascotBridge /> — the V2 compact mascot bridge between the Identity Hero
 * and Today's Adventure.
 *
 * Architectural rules
 * -------------------
 *   - Consumes the existing Mascot Engine presentation bundle; the engine
 *     remains the ONLY decision-maker for mood, expression, message, and
 *     seasonal costume. This file renders; it never decides.
 *   - The mascot appears as Queki's companion, not as a static profile
 *     emoji. The same `Mascot` component is reused so the character is
 *     identical everywhere on the product.
 *   - The bubble carries the engine's deterministic message line. We NEVER
 *     generate copy at runtime. The host passes the pre-formatted line
 *     produced by `useMascotPresentationFor`.
 *   - Mood-driven visual cues (breathe / tilt) are inherited from the
 *     existing `.qk-mascot-cue--*` classes. No new motion is invented here.
 *   - Compact by design. The composition never consumes more than ~64px
 *     vertical height so the first viewport still exposes Identity +
 *     Adventure + meaningful entry to Today's Quests.
 *   - Reduced motion: every duration is token-driven and collapses to 0ms
 *     under `prefers-reduced-motion: reduce` (see `tokens.css`).
 */

import { useTranslation } from 'react-i18next';
import { Mascot as EngineMascot } from '../mascot/Mascot';
import { MascotMessage } from '../mascot/MascotMessage';
import type { MascotPresentation } from '../../domain/mascot';
import { cn } from '../../lib/utils';

export interface MascotBridgeProps {
  /** Authoritative mascot presentation from the Mascot Engine. */
  readonly presentation: MascotPresentation | null;
  /** Pre-formatted deterministic line from the engine. */
  readonly message: string;
  /** Optional override greeting prefix (e.g. "Morning, …"). */
  readonly greeting?: string;
  /** Optional class on the outer section. */
  readonly className?: string;
}

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

export function MascotBridge({
  presentation,
  message,
  greeting,
  className,
}: MascotBridgeProps) {
  const { t } = useTranslation('home');
  const cue = moodCue(presentation?.mood);

  return (
    <section
      aria-label={t('child.mascot.bridgeAria', { defaultValue: 'Queki says hello' })}
      data-testid="mascot-bridge"
      data-mascot-mood={presentation?.mood ?? 'friendly'}
      className={cn('qk-mascot-bridge', className)}
    >
      <div
        data-testid="mascot-bridge-character"
        className={cn('qk-mascot-bridge__character', cue)}
        aria-hidden="true"
      >
        <EngineMascot presentation={presentation} size={28} className="drop-shadow-sm" />
      </div>
      <div
        data-testid="mascot-bridge-bubble"
        className="qk-mascot-bridge__bubble"
        role="note"
      >
        {greeting ? (
          <span
            data-testid="mascot-bridge-greeting"
            className="mr-1 text-meta font-bold uppercase tracking-wide qk-text-secondary"
          >
            {greeting}
          </span>
        ) : null}
        <MascotMessage
          presentation={presentation}
          message={message}
          className="inline"
          testId="mascot-bridge-message"
        />
      </div>
    </section>
  );
}

export default MascotBridge;
