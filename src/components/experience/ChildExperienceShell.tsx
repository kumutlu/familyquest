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
 * already produced. Anything missing collapses to undefined (no
 * decoration at all) so a calm base state stays calm.
 */
function resolveShellTheme(
  resolvedTheme: ResolvedExperienceTheme | null,
): ChildExperienceTheme {
  if (!resolvedTheme) {
    return { tokens: {} };
  }
  const tokens = resolvedTheme.theme?.tokens as
    | Record<string, unknown>
    | undefined;
  if (!tokens) return { tokens: {} };
  const accent = typeof tokens.accent === 'string' ? tokens.accent : undefined;
  const ambientFrom =
    typeof tokens.ambientFrom === 'string' ? tokens.ambientFrom : undefined;
  const ambientTo =
    typeof tokens.ambientTo === 'string' ? tokens.ambientTo : undefined;
  const patternDensity =
    typeof tokens.patternDensity === 'number'
      ? Math.min(1, Math.max(0, tokens.patternDensity))
      : undefined;
  const accentSoft =
    typeof tokens.accentSoft === 'string' && tokens.accentSoft.length > 0
      ? tokens.accentSoft
      : typeof tokens.accent === 'string'
        ? tokens.accent
        : undefined;
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
  const value = useMemo<ChildExperienceContextValue>(
    () => ({ theme, mascotPresentation }),
    [theme, mascotPresentation],
  );

  return (
    <ChildExperienceContext.Provider value={value}>
      <div
        data-testid="child-experience-shell"
        data-experience-theme-kind={
          resolvedTheme?.weeklyEvent ? 'weekly' : resolvedTheme?.seasonalEvent ? 'seasonal' : 'base'
        }
        className="qk-child-experience relative"
        style={style}
      >
        {/* Ambient layer — sits behind every surface. Honours reduced
            motion because no animation lives here. */}
        <div
          aria-hidden="true"
          data-testid="child-experience-ambient"
          className="qk-child-experience-ambient pointer-events-none absolute inset-0 -z-10"
        />
        <div className="qk-child-experience-pattern pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
        {children}
      </div>
    </ChildExperienceContext.Provider>
  );
}

export default ChildExperienceShell;