/**
 * <MascotMessage /> — renders a single mascot line using the curated catalog.
 *
 * The component is the SOLE renderer for mascot copy. It does NOT generate
 * text at runtime, does NOT pass strings through `dangerouslySetInnerHTML`,
 * does NOT render raw user content. The text comes from the deterministic
 * template catalog (`src/domain/mascot/messages.ts`).
 *
 * No write side effects. No notification dispatch. No XP/points/streak
 * mutation. The mascot engine is presentation/reaction only.
 */

import { cn } from '../../lib/utils';
import { describeMascotMessageKey, type MascotMood, type MascotPresentation } from '../../domain/mascot';

export interface MascotMessageProps {
  /**
   * The presentation bundle produced by the Mascot Engine. Required —
   * the message key lives on it.
   */
  presentation: MascotPresentation | null | undefined;
  /**
   * The pre-formatted line from the hook. When omitted, the component
   * falls back to a safe default. NEVER pass user-typed text here.
   */
  message: string;
  /** Optional mood override — defaults to the presentation's mood. */
  mood?: MascotMood;
  /** Optional className for layout. */
  className?: string;
  /** Optional override for the test id. */
  testId?: string;
}

const MOOD_TONE: Record<MascotMood, string> = {
  friendly: 'text-foreground',
  excited: 'text-foreground',
  proud: 'text-foreground',
  sleepy: 'text-foreground',
  curious: 'text-foreground',
  suspicious: 'text-foreground',
  grumpy: 'text-foreground',
  sad: 'text-foreground',
  shocked: 'text-foreground',
  celebrating: 'text-foreground',
  welcome_back: 'text-foreground',
};

/**
 * Render a single mascot line.
 *
 * Pure presentation. No side effects. No raw HTML.
 */
export function MascotMessage({
  presentation,
  message,
  mood,
  className,
  testId = 'mascot-message',
}: MascotMessageProps) {
  const effectiveMood: MascotMood = mood ?? presentation?.mood ?? 'friendly';
  const messageKey = presentation?.messageKey;
  const meta = messageKey ? describeMascotMessageKey(messageKey) : null;

  return (
    <p
      data-testid={testId}
      data-mascot-mood={effectiveMood}
      data-mascot-message-key={messageKey ?? 'unknown'}
      data-mascot-locale-key-count-en={meta?.enVariantCount ?? 0}
      data-mascot-locale-key-count-tr={meta?.trVariantCount ?? 0}
      className={cn('text-body font-semibold', MOOD_TONE[effectiveMood], className)}
    >
      {message}
    </p>
  );
}

export default MascotMessage;