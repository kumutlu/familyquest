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
import { WorldPlate } from './WorldPlate';
import { getThemePlate } from '../../domain/experience';
import { useExperienceWorld } from '../../hooks/useExperienceWorld';
import { useAppearanceSafe } from './useAppearanceSafe';
import { SeasonalLine } from './SeasonalLine';
import { validThemeTokens } from '../../domain/experience';
import {
  NEUTRAL_PERSONALITY,
  themePersonalityAttributes,
  themePersonalityCustomProperties,
  validThemePersonality,
  type ThemePersonality,
} from '../../domain/experience/themePersonality';

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
   * The resolved NON-COLOUR personality bundle for this world. Descendants that
   * need theme-specific presentation (a hold-progress treatment, a card edge)
   * read these tokens rather than branching on a theme id. Absent themes resolve
   * to {@link NEUTRAL_PERSONALITY}, which is Queki Classic's own treatment.
   */
  readonly personality: ThemePersonality;
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
  /**
   * Extra classes for the world wrapper. The persistent child boundary uses
   * this to land `.qk-child-theme` on the SAME element that carries the
   * inline `--qk-theme-accent`, so the theme-derived surface ladder resolves
   * against the right accent rather than the root default.
   */
  readonly className?: string;
  /**
   * Resolved theme id, exposed as `data-child-theme` so the runtime scope in
   * child-experience.css can match it. `null`/omitted for theme-less surfaces.
   */
  readonly dataChildTheme?: string | null;
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
  personality: ThemePersonality,
): React.CSSProperties | undefined {
  const tokens = theme.tokens;
  const hasColourTokens =
    !!tokens.accent ||
    !!tokens.ambientFrom ||
    !!tokens.ambientTo ||
    typeof tokens.patternDensity === 'number';
  // Personality always contributes custom properties, so a theme that declares
  // no colour tokens but does declare a personality still gets a themed world.
  if (!hasColourTokens && personality === NEUTRAL_PERSONALITY) {
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
  Object.assign(style, themePersonalityCustomProperties(personality));
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
  className,
  dataChildTheme,
  children,
}: ChildExperienceShellProps) {
  const theme = useMemo(() => resolveShellTheme(resolvedTheme), [resolvedTheme]);
  // The non-colour half of the theme. Validated through `validThemePersonality`
  // for the same reason the colour tokens are: a theme document may be partial
  // or malformed, and a broken personality must degrade to the neutral
  // treatment rather than to an unreadable world.
  const personality = useMemo(
    () => validThemePersonality(resolvedTheme?.theme?.personality) ?? NEUTRAL_PERSONALITY,
    [resolvedTheme],
  );
  const personalityAttrs = useMemo(() => themePersonalityAttributes(personality), [personality]);
  const style = useMemo(() => shellStyle(theme, personality), [theme, personality]);
  // The shell reads the resolved seasonal world through the same hook
  // the rest of the experience surface uses. The hook consumes the
  // resolved theme the host already produced — it NEVER re-derives
  // eligibility. Preview tooling (DEV only) can override the world
  // through `setExperienceWorldOverride`.
  const { world, seasonalLine, isPreviewOverride } = useExperienceWorld();
  // The painted environment for the resolved theme, when one was authored.
  // Shop themes resolve through the recovered Queki World System V2 plates;
  // themes without authored art keep the token-only world and render no
  // plate at all (no fake placeholder is invented for them).
  const plateThemeId = resolvedTheme?.theme?.id;
  const plate = useMemo(() => getThemePlate(plateThemeId) ?? null, [plateThemeId]);
  // `isDark` is read from the appearance store so the world paints the
  // correct palette for the current mode without forcing the host to
  // pipe a prop. The helper is safe in non-React environments.
  const isDark = useAppearanceSafe();
  const value = useMemo<ChildExperienceContextValue>(
    () => ({ theme, mascotPresentation, personality }),
    [theme, mascotPresentation, personality],
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
        // Flags that a painted world owns the base colour, which demotes the
        // ambient gradient to a veil (see worldPlate.css).
        data-experience-plate={plate ? '1' : '0'}
        className={className ? `qk-child-experience relative ${className}` : 'qk-child-experience relative'}
        data-child-theme={dataChildTheme ?? undefined}
        /* Personality enums ride as data attributes because CSS cannot branch on
           a `var()`. Every value is allow-listed upstream in
           `validThemePersonality`, so this cannot inject anything. */
        {...personalityAttrs}
        style={style}
      >
        {/* Painted theme world — the BASE layer, behind the token ambient,
            the pattern and the atmospheric world layer. Decorative only. */}
        {plate ? (
          <WorldPlate
            themeId={plateThemeId}
            plate={plate}
            variant="backdrop"
            scrim
            className="-z-20"
          />
        ) : null}
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