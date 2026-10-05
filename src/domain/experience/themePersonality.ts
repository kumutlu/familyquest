/**
 * Theme personality — the NON-COLOUR half of a theme.
 *
 * Why this exists
 * ---------------
 * A theme built from one accent hue plus a painted world plate is a palette
 * swap. Converted to grayscale the three shop themes became nearly identical:
 * the same card rectangles, the same 1px borders, the same flat shadow, the
 * same solid progress bar. Hue was doing all the identity work, and hue is
 * exactly the channel a reviewer loses when they test whether a theme still
 * reads without colour.
 *
 * This module introduces the dimensions that survive grayscale:
 *
 *   surface opacity · surface blur · corner radius · border strength ·
 *   border style · shadow depth · accent glow · motif · motif opacity ·
 *   progress track · progress effect · decorative density · motion scale
 *
 * The contract
 * ------------
 *   - NO COMPONENT BRANCHES ON A THEME NAME. `QuestCards` and
 *     `HoldToCompleteButton` do not know Neon Arcade exists. They read
 *     `--qk-theme-*` custom properties (or the `qk-surface-glass` utility),
 *     and the theme scope decides what those resolve to. Adding a sixth theme
 *     is a data change in `fixtures/themes.ts` plus nothing.
 *   - PRESENTATION ONLY. Nothing here reads or writes eligibility, ownership,
 *     points, XP or persistence. Personality can never affect what a child is
 *     allowed to buy.
 *   - SEMANTIC STATUS COLOURS ARE OUT OF REACH. Success, warning, error,
 *     destructive, reward/XP gold and wallet mint use their own token families
 *     (`--color-xp-*` etc.) which this module does not emit, so a "luminous"
 *     theme can never recolour a child's earned points.
 *   - UNTRUSTED-SHAPE SAFE. Theme documents are read from Firestore, so every
 *     number is clamped into range and every enum is checked against a frozen
 *     allow-list. Nothing here is ever interpolated into a CSS value verbatim,
 *     which is also why the enum-shaped tokens are published as DATA ATTRIBUTES
 *     rather than custom properties: CSS cannot branch on a `var()`, but it can
 *     branch on `[data-qk-shadow='deep']`, and an allow-listed value cannot
 *     inject anything.
 *
 * Emitted shape
 * -------------
 *   numeric tokens  →  `--qk-theme-<name>` custom properties (clamped numbers)
 *   enum tokens     →  `data-qk-<name>` attributes (allow-listed strings)
 *
 * `ChildExperienceShell` publishes both onto the shell element and
 * `ChildThemeBoundary` mirrors them onto `<html>` so the app chrome and every
 * portaled sheet resolve the same personality as the routed page.
 */

/* -------------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------- */

/**
 * How a themed surface casts its shadow.
 *
 * `matte` is a deliberate authoring value rather than a weaker `soft`: it is a
 * tight, almost-flat paper lift with no cast shadow at all. It lets a "calm"
 * theme state its own surface depth instead of inheriting the neutral
 * placeholder's `soft`, which is what makes it distinguishable in grayscale
 * from Queki Classic.
 */
export type ThemeShadow = 'none' | 'matte' | 'soft' | 'halo' | 'lifted' | 'deep';

/**
 * Border rendering treatment.
 *
 * `bevel` and `halo` exist because "1px solid border at two different strengths"
 * is not a form language — a hardware edge and a soft rim need different GEOMETRY,
 * not just different opacity. `bevel` draws a hard inset light line plus an outer
 * hairline (crisp, machined); `halo` draws no hard line at all and lets a soft
 * outward bloom carry the edge (atmospheric). In grayscale these are trivially
 * distinguishable, which is exactly the point.
 */
export type ThemeBorderStyle = 'solid' | 'dashed' | 'bevel' | 'halo';

/**
 * The decorative motif laid over the world plate (never over body copy).
 * `none` means the theme contributes no motif at all.
 */
export type ThemePattern = 'none' | 'grid' | 'scanline' | 'orbit' | 'mist';

/** How a progress bar's unfilled track is rendered. */
export type ThemeProgressTrack = 'matte' | 'soft' | 'inset' | 'deep';

/**
 * How a progress fill reads as it advances.
 *
 * `gentle` exists so a "calm" theme can still author a language of its own
 * instead of inheriting the neutral placeholder's `flat`. It is a low-amplitude
 * ease with no bloom and no gradient — visible as motion, but it never draws the
 * eye the way `luminous` does.
 */
export type ThemeProgressEffect = 'flat' | 'gentle' | 'luminous' | 'orbital';

/**
 * How the INSIDE of a themed surface is treated.
 *
 * This is the axis that fixes the last grayscale gap between Neon Arcade and
 * Space Explorer. Edge, depth, blur and opacity already diverged, but a
 * measurement of the card interiors found their local contrast differed by
 * only ~3%: both cards were a smooth rectangle with copy on it, so with the
 * world plate cropped away they still looked like the same object.
 *
 * The distinction is FREQUENCY, not degree:
 *
 *   machined     — hard, small, repeated detail: a top rail, corner brackets,
 *                  a crisp inset seam. Many tiny edges. Reads as hardware.
 *   atmospheric  — no edges at all: one wide soft inner light plus a soft
 *                  inner falloff at the rim. Reads as depth.
 *   flat         — nothing. A quiet theme states that its surfaces are plain.
 *
 * A theme cannot opt into this axis and get a no-op: every value has its own
 * rule, including the reset for `flat`.
 */
export type ThemeInnerTreatment = 'flat' | 'machined' | 'atmospheric';

/**
 * Which tonal family the theme's surfaces belong to.
 *
 * This exists because tonal depth and text legibility are the same problem. A
 * dark-glass theme (Neon Arcade, Space Explorer) physically cannot keep the
 * light scheme's dark ink text: on a surface pulled 72% toward ink, `#17151f`
 * copy would sit at roughly 1.3:1. So a theme that wants dark surfaces must
 * also declare that its surfaces are dark, and the scope then flips the COPY
 * tokens with them. Tonal depth is the single strongest grayscale signal, and
 * this is what lets a theme spend it without breaking AA.
 *
 * `inherit` is the neutral behaviour: the surface uses the neutral tone layer
 * and copy follows the user's appearance setting, exactly as Queki Classic
 * does. Seasonal and weekly event dressing stays on `inherit` so adding
 * personality to shop themes cannot change how an event looks.
 */
export type ThemeSurfaceScheme = 'inherit' | 'light' | 'dark';

export interface ThemePersonality {
  /**
   * 0..1 — which tonal family the surfaces belong to. See
   * {@link ThemeSurfaceScheme} for why this cannot be inferred from opacity.
   */
  surfaceScheme: ThemeSurfaceScheme;
  /**
   * 0..1 — how far surfaces are pulled toward ink (dark scheme) or paper
   * (light scheme). This is the primary grayscale depth signal.
   */
  surfaceDarkness: number;
  /**
   * 0..1 — how opaque a themed surface is. Below 1 the world plate reads
   * through the surface (glass). 1 is fully opaque.
   */
  surfaceOpacity: number;
  /** px — `backdrop-filter: blur()` radius on themed surfaces. 0 disables it. */
  surfaceBlur: number;
  /** px — corner radius override for themed surfaces. */
  surfaceRadius: number;
  /** 0..1 — multiplier on the accent share of themed borders. */
  borderStrength: number;
  /** Border rendering treatment. */
  borderStyle: ThemeBorderStyle;
  /** Shadow depth profile. */
  shadow: ThemeShadow;
  /** 0..1 — accent glow intensity on edges and active states. */
  glow: number;
  /** Decorative motif family over the world plate. */
  pattern: ThemePattern;
  /** 0..1 — motif opacity. 0 disables the motif even when one is declared. */
  patternOpacity: number;
  /** Progress track treatment. */
  progressTrack: ThemeProgressTrack;
  /** Progress fill treatment. */
  progressEffect: ThemeProgressEffect;
  /** Interior surface treatment. See {@link ThemeInnerTreatment}. */
  innerTreatment: ThemeInnerTreatment;
  /** 0..1 — how much decorative furniture the theme adds. */
  decorationDensity: number;
  /** 0..1 — multiplier on decorative animation duration/amplitude. */
  motionScale: number;
}

/* -------------------------------------------------------------------------
 * Allow-lists + clamping
 * ---------------------------------------------------------------------- */

const SHADOWS: readonly ThemeShadow[] = ['none', 'matte', 'soft', 'halo', 'lifted', 'deep'];
const BORDER_STYLES: readonly ThemeBorderStyle[] = ['solid', 'dashed', 'bevel', 'halo'];
const PATTERNS: readonly ThemePattern[] = ['none', 'grid', 'scanline', 'orbit', 'mist'];
const PROGRESS_TRACKS: readonly ThemeProgressTrack[] = ['matte', 'soft', 'inset', 'deep'];
const PROGRESS_EFFECTS: readonly ThemeProgressEffect[] = [
  'flat',
  'gentle',
  'luminous',
  'orbital',
];
const SURFACE_SCHEMES: readonly ThemeSurfaceScheme[] = ['inherit', 'light', 'dark'];
const INNER_TREATMENTS: readonly ThemeInnerTreatment[] = ['flat', 'machined', 'atmospheric'];

/**
 * Every enum axis and every value it accepts.
 *
 * Published so the CSS-coverage guard can assert the stylesheet branches on
 * all of them. Without that check a new member of, say, `ThemeShadow` type-checks
 * and validates, then silently does nothing at runtime — the exact failure Calm
 * had when it inherited the neutral placeholder instead of authoring its own.
 */
export const PERSONALITY_ENUM_VALUES = Object.freeze({
  surfaceScheme: SURFACE_SCHEMES,
  borderStyle: BORDER_STYLES,
  shadow: SHADOWS,
  pattern: PATTERNS,
  progressTrack: PROGRESS_TRACKS,
  progressEffect: PROGRESS_EFFECTS,
  innerTreatment: INNER_TREATMENTS,
});

const isEnum = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

/** Clamp to [min, max]; non-finite input falls back to `fallback`. */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/* -------------------------------------------------------------------------
 * Neutral default
 * ---------------------------------------------------------------------- */

/**
 * Queki's neutral personality — the baseline Queki Classic already has.
 *
 * This matters for two reasons. A theme with no personality block (the
 * seasonal and weekly worlds, which are event dressing rather than a
 * purchasable identity) falls back to exactly this, so adding personality to
 * shop themes cannot change how an event looks. And it gives the contract test
 * a fourth column: a themed surface must differ from this baseline, or the
 * personality is decorative rather than load-bearing.
 */
export const NEUTRAL_PERSONALITY: ThemePersonality = Object.freeze({
  surfaceScheme: 'inherit',
  surfaceDarkness: 0,
  surfaceOpacity: 1,
  surfaceBlur: 0,
  surfaceRadius: 16,
  borderStrength: 1,
  borderStyle: 'solid',
  shadow: 'soft',
  glow: 0,
  pattern: 'none',
  patternOpacity: 0,
  progressTrack: 'soft',
  progressEffect: 'flat',
  innerTreatment: 'flat',
  decorationDensity: 0,
  motionScale: 1,
});

/* -------------------------------------------------------------------------
 * Validation
 * ---------------------------------------------------------------------- */

/**
 * Validate a raw personality bundle from an untrusted theme document.
 *
 * Every field falls back to the neutral baseline independently, so a partially
 * populated document yields a coherent theme rather than a broken one. Returns
 * `undefined` when the shape is not an object at all, which lets callers
 * distinguish "no personality" (use neutral) from "malformed" (same treatment).
 */
export function validThemePersonality(raw: unknown): ThemePersonality | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as Record<string, unknown>;
  return {
    surfaceScheme: isEnum(SURFACE_SCHEMES, p.surfaceScheme)
      ? p.surfaceScheme
      : NEUTRAL_PERSONALITY.surfaceScheme,
    surfaceDarkness: clampNumber(
      p.surfaceDarkness,
      0,
      0.88,
      NEUTRAL_PERSONALITY.surfaceDarkness,
    ),
    surfaceOpacity: clampNumber(p.surfaceOpacity, 0.2, 1, NEUTRAL_PERSONALITY.surfaceOpacity),
    surfaceBlur: clampNumber(p.surfaceBlur, 0, 32, NEUTRAL_PERSONALITY.surfaceBlur),
    surfaceRadius: clampNumber(p.surfaceRadius, 0, 40, NEUTRAL_PERSONALITY.surfaceRadius),
    borderStrength: clampNumber(p.borderStrength, 0, 2, NEUTRAL_PERSONALITY.borderStrength),
    borderStyle: isEnum(BORDER_STYLES, p.borderStyle)
      ? p.borderStyle
      : NEUTRAL_PERSONALITY.borderStyle,
    shadow: isEnum(SHADOWS, p.shadow) ? p.shadow : NEUTRAL_PERSONALITY.shadow,
    glow: clampNumber(p.glow, 0, 1, NEUTRAL_PERSONALITY.glow),
    pattern: isEnum(PATTERNS, p.pattern) ? p.pattern : NEUTRAL_PERSONALITY.pattern,
    patternOpacity: clampNumber(p.patternOpacity, 0, 1, NEUTRAL_PERSONALITY.patternOpacity),
    progressTrack: isEnum(PROGRESS_TRACKS, p.progressTrack)
      ? p.progressTrack
      : NEUTRAL_PERSONALITY.progressTrack,
    progressEffect: isEnum(PROGRESS_EFFECTS, p.progressEffect)
      ? p.progressEffect
      : NEUTRAL_PERSONALITY.progressEffect,
    innerTreatment: isEnum(INNER_TREATMENTS, p.innerTreatment)
      ? p.innerTreatment
      : NEUTRAL_PERSONALITY.innerTreatment,
    decorationDensity: clampNumber(
      p.decorationDensity,
      0,
      1,
      NEUTRAL_PERSONALITY.decorationDensity,
    ),
    motionScale: clampNumber(p.motionScale, 0, 1, NEUTRAL_PERSONALITY.motionScale),
  };
}

/* -------------------------------------------------------------------------
 * CSS emission
 * ---------------------------------------------------------------------- */

/** Numeric personality tokens → `--qk-theme-*` custom properties. */
const NUMERIC_TOKENS = [
  'surfaceDarkness',
  'surfaceOpacity',
  'surfaceBlur',
  'surfaceRadius',
  'borderStrength',
  'glow',
  'patternOpacity',
  'decorationDensity',
  'motionScale',
] as const satisfies readonly (keyof ThemePersonality)[];

/** Enum personality tokens → `data-qk-*` attributes (CSS can branch on these). */
const ENUM_TOKENS = [
  'surfaceScheme',
  'borderStyle',
  'shadow',
  'pattern',
  'progressTrack',
  'progressEffect',
  'innerTreatment',
] as const satisfies readonly (keyof ThemePersonality)[];

/**
 * `surfaceScheme` → `surface-scheme`.
 *
 * The emitted attribute names are kebab-case so they match the selectors
 * authored in `child-experience.css` (`[data-qk-progress-effect='orbital']`).
 * This was a real bug first time round: the emitter produced
 * `data-qk-progressEffect` while the CSS read `data-qk-progress-effect`, so
 * every single-word attribute (shadow, pattern) matched by luck while all
 * three multi-word ones silently never applied.
 */
function kebab(token: string): string {
  return token.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

/**
 * Build the custom-property half of a personality bundle for a React inline
 * style. Values are the clamped numbers rendered as plain strings — safe to
 * serialise because `validThemePersonality` already bounded them.
 */
export function themePersonalityCustomProperties(
  personality: ThemePersonality,
): Record<string, string> {
  const style: Record<string, string> = {};
  for (const token of NUMERIC_TOKENS) {
    style[`--qk-theme-${kebab(token)}`] = String(personality[token]);
  }
  return style;
}

/** The `data-qk-*` attribute half, ready for JSX spread or `setAttribute`. */
export function themePersonalityAttributes(
  personality: ThemePersonality,
): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const token of ENUM_TOKENS) {
    attrs[`data-qk-${kebab(token)}`] = personality[token] as string;
  }
  return attrs;
}

/** Every published property/attribute name, so the mirror cannot drift. */
export const PERSONALITY_CUSTOM_PROPERTIES: readonly string[] = Object.freeze(
  NUMERIC_TOKENS.map((token) => `--qk-theme-${kebab(token)}`),
);

export const PERSONALITY_ATTRIBUTES: readonly string[] = Object.freeze(
  ENUM_TOKENS.map((token) => `data-qk-${kebab(token)}`),
);