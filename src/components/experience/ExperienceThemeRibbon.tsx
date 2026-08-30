/**
 * Minimal, observable example of the Experience / Theme Engine.
 *
 * This ribbon is intentionally tiny: one small banner that proves the
 * generic engine resolves the active event/theme through the hook. It
 * shows when the family is in an event window and silently renders
 * nothing when they are not.
 *
 * It must NEVER award points or XP. It must NEVER touch the wallet.
 *
 * Use it as a placeholder until richer event-aware surfaces land (e.g.
 * a banner at the top of the dashboard, a themed card, a confetti
 * preset swap). It is also a smoke test that the resolver is wired into
 * the React tree.
 */

import { useExperienceTheme } from '../../hooks/useExperienceTheme';

interface ExperienceThemeRibbonProps {
  /** Override the default class for layout testing. */
  className?: string;
}

/**
 * A small banner that surfaces which event (if any) is currently active.
 *
 * Visual contract:
 *   - No active event → renders `null`. Existing UI is untouched.
 *   - Active event    → renders a slim, non-interactive chip with the
 *                       event name and a `data-source` attribute for
 *                       integration tests.
 */
export function ExperienceThemeRibbon({ className }: ExperienceThemeRibbonProps) {
  const { source, appliedEventName, theme } = useExperienceTheme();

  if (source === 'base' || appliedEventName === null) return null;

  return (
    <div
      data-testid="experience-theme-ribbon"
      data-source={source}
      data-theme-id={theme.id}
      role="status"
      aria-live="polite"
      className={
        'rounded-md border px-3 py-1 text-xs font-medium ' +
        'bg-amber-50 border-amber-200 text-amber-900 ' +
        'dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-100 ' +
        (className ?? '')
      }
    >
      <span aria-hidden="true">✨</span>{' '}
      <span>{appliedEventName} is live</span>
    </div>
  );
}

export default ExperienceThemeRibbon;