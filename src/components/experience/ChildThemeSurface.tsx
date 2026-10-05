/**
 * <ChildThemeSurface /> — mount the world shell only if one is not already up.
 *
 * History / why
 * -------------
 * The first implementation of child theming mounted `ChildExperienceShell`
 * INSIDE each page. So Home got a shell, the Theme Shop got a shell, and every
 * other child route got nothing at all — which is exactly why a child could
 * pick Space Explorer, tap "Quests", and land on a plain lavender app. The
 * theme looked like it had been switched off.
 *
 * The fix is a single persistent shell owned by `ChildThemeBoundary` above the
 * router outlet. This component is the delegation shim that makes that change
 * safe for screens which already compose a shell:
 *
 *   - No shell above us (unit tests, standalone renders, preview harness) →
 *     mount one, exactly as before. Nothing that already worked is broken.
 *   - Shell already up (the real app) → render children straight into it. No
 *     second plate, no second ambient layer, no artwork decoded twice.
 *
 * `publishPreview` additionally lets a screen nominate the theme the boundary
 * should preview while it is mounted — used by the Theme Shop so a child can
 * still see the world they are considering, without a second shell.
 */

import type { ReactNode } from 'react';
import type { ResolvedExperienceTheme } from '../../domain/experience';
import type { MascotPresentation } from '../../domain/mascot';
import { ChildExperienceShell, useChildExperienceContext } from './ChildExperienceShell';
import { useThemePreviewPublisher } from '../../domain/experience/themePreviewOverride';

export interface ChildThemeSurfaceProps {
  readonly resolvedTheme: ResolvedExperienceTheme | null;
  readonly mascotPresentation: MascotPresentation | null;
  /**
   * When a shell is already mounted above, publish `resolvedTheme` as the
   * theme to preview. Ignored when this component is the one mounting the
   * shell (it just passes the theme through instead).
   */
  readonly publishPreview?: boolean;
  readonly children: ReactNode;
}

export function ChildThemeSurface({
  resolvedTheme,
  mascotPresentation,
  publishPreview = false,
  children,
}: ChildThemeSurfaceProps) {
  // Always called — the hook order must not depend on whether a shell exists.
  const enclosing = useChildExperienceContext();
  useThemePreviewPublisher(publishPreview && enclosing !== null ? resolvedTheme : null);

  if (enclosing !== null) return <>{children}</>;

  return (
    <ChildExperienceShell
      resolvedTheme={resolvedTheme}
      mascotPresentation={mascotPresentation}
    >
      {children}
    </ChildExperienceShell>
  );
}

export default ChildThemeSurface;
