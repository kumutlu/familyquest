/**
 * <ChildExperienceShell /> — productization wrapper for the Child Home.
 *
 * Responsibilities (PRESENTATION ONLY):
 *   - Theme ambient: drives a single CSS custom-property bundle
 *     (--qk-theme-ambient-from/to/accent + scene pattern tokens) from
 *     the resolved experience theme so the world visibly shifts for
 *     base / weekly / seasonal / child-equipped states.
 *   - Mascot composition: renders Queki partially overlapping the hero
 *     surface, with a floating speech bubble. The mascot remains
 *     reactive to the existing Mascot Engine mood/expression/costume.
 *   - Layered surfaces: provides Hero, Mascot, Adventure (centerpiece),
 *     Quests, and Long-Term (Goals / Pet Box) bands with intentional
 *     hierarchy — NOT card soup.
 *
 * Architectural rules
 * -------------------
 *   - NEVER awards XP / points / wallet. NEVER mutates Pet Box money.
 *   - NEVER introduces a parallel completion path. Tap on quest rows
 *     still routes to /tasks so the existing hold-to-complete flow owns
 *     the authoritative completion.
 *   - NEVER calls Firestore directly for decoration. All data sources
 *     are reused from the host.
 *   - Reduced motion contract is honoured by token collapse.
 *
 * This file is intentionally a thin shell: it composes presentation
 * surfaces and exposes the theme bundle to descendants.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ResolvedExperienceTheme } from '../../domain/experience';
import type { MascotPresentation } from '../../domain/mascot';
import { WorldBackground } from './WorldBackground';
import { useExperienceWorld } from '../../hooks/useExperienceWorld';
import { useAppearanceSafe } from './useAppearanceSafe';
import { SeasonalLine } from './SeasonalLine';
import { validThemeTokens } from '../../domain/experience';

export interface ChildExperienceTheme {
  /**
   * The single token bundle applied to the world wrapper. Keys are CSS
   * custom property names, values are CSS strings. Tokens cascade so
   * descendants pick them up without prop drilling.
   */
  readonly tokens: {
    /** Optional accent used for chips / highlights. */
    readonly accent?: string;
    /** Soft ambient gradient stop A. */
    readonly ambientFrom?: string;
    /** Soft ambient gradient stop B. */
    readonly ambientTo?: string;
    /** Pattern density (0..1) — drives subtle decorative motifs. */
    readonly patternDensity?: number;
    /**
     * Optional accent-soft tint applied mid-gradient and behind the
     * mascot. Falls back to ambientTo when omitted so the base world
     * stays calm. Use this to announce seasonal/weekly world changes
     * WITHOUT recolouring every component.
     */
    readonly accentSoft?: string;
  };
}

export interface ChildExperienceContextValue {
  readonly theme: ChildExperienceTheme;
  /**
   * Optional mascot presentation bundle. The shell never inspects
   * internal mascot fields — it only forwards the bundle to the
   * composition. The mascot engine remains the only decision-maker.
   */
  readonly mascotPresentation: MascotPresentation | null;
}

const ChildExperienceContext = createContext<ChildExperienceContextValue | null>(null);

/**
 * Read the surrounding child-experience context. Returns `null` when
 * the caller is outside the shell — callers must handle absence
 * gracefully.
 */
export function useChildExperienceContext(): ChildExperienceContextValue | null {
  return useContext(ChildExperienceContext);
}

export interface ChildExperienceShellProps {
  readonly resolvedTheme: ResolvedExperienceTheme | null;
  readonly mascotPresentation: MascotPresentation | null;
  readonly children: ReactNode;
}

/**
 * Resolve the presentation-side theme bundle from the authoritative
 * resolver output. We never invent tokens — we map keys the resolver
 * already produced, validated through `validThemeTokens` so a partial
 * or malformed token bundle fails safe to the calm base world instead
 * of rendering a broken palette.
 */
function resolveShellTheme(
  resolvedTheme: ResolvedExperienceTheme | null,
): ChildExperienceTheme {
  if (!resolvedTheme) {
    return { tokens: {} };
  }
  const tokens = validThemeTokens(resolvedTheme.theme?.tokens);
  if (!tokens) return { tokens: {} };
  const accent = tokens.accent;
  const ambientFrom = tokens.ambientFrom;
  const ambientTo = tokens.ambientTo;
  const patternDensity = tokens.patternDensity;
  const accentSoft = tokens.accentSoft ?? tokens.accent;
  return {
    tokens: { accent, ambientFrom, ambientTo, patternDensity, accentSoft },
  };
}

/**
 * Build the inline `style` payload applied to the world wrapper so the
 * CSS variables cascade down. We keep this object tiny — only the
 * tokens the design system actually uses.
 */
function shellStyle(
  theme: ChildExperienceTheme,
): React.CSSProperties | undefined {
  const tokens = theme.tokens;
  if (
    !tokens.accent &&
    !tokens.ambientFrom &&
    !tokens.ambientTo &&
    typeof tokens.patternDensity !== 'number'
  ) {
    return undefined;
  }
  const style: Record<string, string> = {};
  if (tokens.accent) style['--qk-theme-accent'] = tokens.accent;
  if (tokens.ambientFrom) style['--qk-theme-ambient-from'] = tokens.ambientFrom;
  if (tokens.ambientTo) style['--qk-theme-ambient-to'] = tokens.ambientTo;
  if (typeof tokens.patternDensity === 'number') {
    style['--qk-theme-pattern-density'] = String(tokens.patternDensity);
  }
  if (tokens.accentSoft) style['--qk-theme-accent-soft'] = tokens.accentSoft;
  return style as React.CSSProperties;
}

/**
 * World wrapper. Provides:
 *   - ambient gradient + token cascade
 *   - the seasonal world layer (atmosphere + decoration + particles)
 *   - context bundle for descendants
 *   - aria-label so screen readers see the page as one coherent world
 */
export function ChildExperienceShell({
  resolvedTheme,
  mascotPresentation,
  children,
}: ChildExperienceShellProps) {
  const theme = useMemo(() => resolveShellTheme(resolvedTheme), [resolvedTheme]);
  const style = useMemo(() => shellStyle(theme), [theme]);
  // The shell reads the resolved seasonal world through the same hook
  // the rest of the experience surface uses. The hook consumes the
  // resolved theme the host already produced — it NEVER re-derives
  // eligibility. Preview tooling (DEV only) can override the world
  // through `setExperienceWorldOverride`.
  const { world, seasonalLine, isPreviewOverride } = useExperienceWorld();
  // `isDark` is read from the appearance store so the world paints the
  // correct palette for the current mode without forcing the host to
  // pipe a prop. The helper is safe in non-React environments.
  const isDark = useAppearanceSafe();
  const value = useMemo<ChildExperienceContextValue>(
    () => ({ theme, mascotPresentation }),
    [theme, mascotPresentation],
  );

  return (
    <ChildExperienceContext.Provider value={value}>
      <div
        data-testid="child-experience-shell"
        // Theme kind is now derived from the world source. The world
        // consumes the resolved theme; seasonal-event / weekly-event /
        // equipped-theme are mutually exclusive. `preview-override` and
        // `base` collapse to `base` for the visual test.
        data-experience-theme-kind={
          world.source === 'seasonal-event'
            ? 'seasonal'
            : world.source === 'weekly-event'
              ? 'weekly'
              : world.source === 'equipped-theme'
                ? 'equipped'
                : 'base'
        }
        data-experience-world={world.definition.id}
        data-experience-world-source={world.source}
        data-experience-world-preview-override={isPreviewOverride ? '1' : '0'}
        className="qk-child-experience relative"
        style={style}
      >
        {/* Seasonal world layer — atmospheric gradient + decoration +
            particles. ALWAYS behind every content surface. aria-hidden,
            pointer-events: none, never changes layout dimensions. */}
        <WorldBackground world={world} isDark={isDark} />

        {/* Ambient layer — sits behind every surface. Honours reduced
            motion because no animation lives here. */}
        <div
          aria-hidden="true"
          data-testid="child-experience-ambient"
          className="qk-child-experience-ambient pointer-events-none absolute inset-0 -z-10"
        />
        <div className="qk-child-experience-pattern pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />

        {/* Optional short seasonal line. Restrained, decorative — NOT a
            heading, NOT a button, NOT an Adventure. Hidden under
            reduced motion only if the host explicitly opts in (the
            shell does NOT opt in by default; QA tooling can). */}
        {seasonalLine ? (
          <SeasonalLine
            worldId={world.definition.id}
            line={seasonalLine}
            className="relative z-0 mx-auto mt-3 flex w-fit max-w-full justify-center px-4"
          />
        ) : null}

        {children}
      </div>
    </ChildExperienceContext.Provider>
  );
}

export default ChildExperienceShell;