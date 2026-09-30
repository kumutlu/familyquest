/**
 * FamilyQuest / Queki — Seasonal World Layer (V1).
 *
 * The Engagement / Theme Engine already decides whether a celebration
 * is live. The Seasonal World Layer is PRESENTATION-ONLY: it consumes
 * the resolved event/theme and produces a small, declarative
 * `WorldDefinition` that the renderer paints behind the page.
 *
 * Architecture law
 * ----------------
 *   1. The world layer NEVER decides eligibility. It only reads what
 *      the Experience Theme resolver already produced.
 *   2. Worlds are content, not code. Adding Diwali / Hanukkah / Lunar
 *      New Year is a one-line addition to `WORLD_CATALOG`.
 *   3. The renderer is a single, generic component. It does not branch
 *      on `if (world === 'christmas')` — it walks the declarative spec.
 *   4. Asset paths are semantic. The renderer resolves them through the
 *      Vite asset pipeline; nothing inline-base64s a 4 MB background.
 *   5. The world layer is the LAST visual layer above the ambient
 *      gradient and BELOW every content surface. It is decorative.
 *   6. Reduced motion collapses particle motion but keeps the world
 *      visually complete.
 *
 * No write surface. No XP / points / wallet / theme-purchase code.
 */

import type { EventDefinition, ThemeDefinition } from '../experience/types';

/* -------------------------------------------------------------------------- */
/* Identifier                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The closed set of built-in seasonal worlds.
 *
 * The catalog is open-ended by design — new worlds register a new id and
 * the renderer accepts them automatically. We still type the common
 * values so component code can switch on them exhaustively when needed.
 */
export type WorldId =
  | 'world.normal'
  | 'world.christmas'
  | 'world.halloween'
  | 'world.eid'
  | 'world.ramadan'
  | 'world.neon'
  | 'world.space'
  | 'world.rainbow'
  | 'world.pixel'
  | 'world.calm';

/* -------------------------------------------------------------------------- */
/* Decoration spec                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Where a decoration sits in the world. Corners are explicit so the
 * renderer can swap mobile vs desktop variants without inventing layout
 * logic.
 */
export type DecorationSlot =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-edge'
  | 'bottom-edge'
  | 'horizon';

/**
 * A single decorative element. The renderer is responsible for scaling,
 * positioning and reduced-motion collapse. It does NOT inspect the
 * `id` for behaviour.
 */
export interface WorldDecoration {
  /** Stable identifier for tests / QA labels. */
  readonly id: string;
  /** Slot the decoration occupies. */
  readonly slot: DecorationSlot;
  /**
   * Optional SVG asset path (relative to `src/assets/worlds/<world>/`).
   * `undefined` means the decoration is generated entirely from CSS
   * (e.g. radial-gradient bokeh, dotted horizon).
   */
  readonly asset?: string;
  /**
   * Optional inline SVG markup. The renderer mounts it as-is inside a
   * strictly-aria-hidden, pointer-events-none container. Inline SVG is
   * kept tiny on purpose.
   */
  readonly inlineSvg?: string;
  /** Opacity in the 0..1 range. Renderer clamps. */
  readonly opacity?: number;
  /** Render width fraction in the 0..1 range (e.g. 0.4 = 40% of width). */
  readonly widthFraction?: number;
  /** Render height fraction in the 0..1 range. */
  readonly heightFraction?: number;
  /**
   * When true, the decoration is shown on desktop only. Mobile uses a
   * reduced variant or omits it entirely.
   */
  readonly desktopOnly?: boolean;
  /**
   * When true, the decoration is shown on mobile only. Used to keep
   * small screens legible by simplifying the silhouette.
   */
  readonly mobileOnly?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Particles                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Built-in particle kinds. Each kind is a single CSS animation the
 * renderer mounts N times. The renderer is responsible for keeping the
 * count low (≤ ~24 elements).
 */
export type ParticleKind =
  | 'none'
  | 'sparkle'
  | 'snow'
  | 'fog-mote'
  | 'gold-dust'
  | 'star-twinkle';

/**
 * Particle configuration. The renderer reads `density` and clamps it
 * to a small, child-safe number. Animations collapse to 0ms under
 * `prefers-reduced-motion: reduce`.
 */
export interface WorldParticles {
  readonly kind: ParticleKind;
  /** Relative density in the 0..1 range. */
  readonly density: number;
  /** Optional vertical drift in the 0..1 range (1 = full viewport height). */
  readonly drift?: number;
}

/* -------------------------------------------------------------------------- */
/* World definition                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A seasonal world. Pure data. Drives the WorldBackground renderer.
 *
 * The renderer never inspects `id` for behaviour. It reads palette +
 * texture + decorations + particles and paints.
 */
export interface WorldDefinition {
  readonly id: WorldId;
  /** Display name (UI may surface it as a label, never as a heading). */
  readonly name: string;
  /**
   * Optional originating event. The renderer does NOT use it for
   * eligibility — only for diagnostic display in QA tooling.
   */
  readonly eventId?: string;
  /**
   * Light-mode palette overrides. Tokens follow the project convention:
   *   - `ambientFrom`   : top of the world gradient
   *   - `ambientTo`     : bottom of the world gradient
   *   - `accentSoft`    : optional mid-stop tint
   *   - `accent`        : decorative highlight (icons, mascot environment)
   *   - `glowA`         : radial highlight colour A
   *   - `glowB`         : radial highlight colour B
   */
  readonly lightPalette: WorldPalette;
  /**
   * Dark-mode palette overrides. Worlds MUST ship a dark variant so
   * the world reads correctly in both modes.
   */
  readonly darkPalette: WorldPalette;
  /** Optional texture name. The renderer maps this to a CSS class. */
  readonly texture?: WorldTexture;
  /** Decorative elements. The renderer places them in z-order. */
  readonly decorations: readonly WorldDecoration[];
  /** Particle configuration. */
  readonly particles: WorldParticles;
  /**
   * Optional short, deterministic seasonal line. The renderer exposes
   * it as `worldSeasonalLine`. It is NOT a heading, NOT a button
   * label, NOT an Adventure.
   */
  readonly seasonalLine?: string;
}

/**
 * A colour bundle for one mode of a world. Values are CSS strings.
 */
export interface WorldPalette {
  readonly ambientFrom: string;
  readonly ambientTo: string;
  readonly accent: string;
  readonly accentSoft: string;
  readonly glowA: string;
  readonly glowB: string;
}

/**
 * The set of texture identifiers. The renderer maps each to a CSS
 * class. Worlds with `texture === 'none'` render without an extra
 * texture layer (the ambient gradient is enough).
 */
export type WorldTexture =
  | 'none'
  | 'starlight'
  | 'snow'
  | 'fog'
  | 'warm-bokeh'
  | 'pattern-subtle';

/* -------------------------------------------------------------------------- */
/* Resolver inputs                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The world resolver is a pure function: it takes what the Experience
 * Theme resolver already decided and produces the appropriate world.
 * It NEVER re-derives eligibility, NEVER inspects a clock.
 */
export interface ResolveWorldInput {
  /**
   * The resolved theme bundle from `useExperienceTheme()`. The world
   * id is derived from this.
   */
  readonly resolvedTheme: {
    readonly theme: ThemeDefinition;
    readonly source: string;
    readonly appliedEventName: string | null;
  } | null;
  /**
   * Optional override — used by the Engagement Preview to force a
   * world regardless of the host resolver. When set, the world resolver
   * returns the matching `WorldDefinition` even if the resolved theme
   * would not. The override is hook-level only and never reaches
   * production.
   */
  readonly previewOverride?: WorldId | null;
  /**
   * The world catalog. The hook owns the production list; tests can
   * inject a smaller catalog.
   */
  readonly catalog: readonly WorldDefinition[];
  /**
   * Optional originating event. Surfaced for diagnostic tooling only.
   */
  readonly originatingEvent?: EventDefinition | null;
}

/**
 * The resolved world bundle. The renderer consumes `definition`.
 * `source` is diagnostic only.
 */
export interface ResolvedWorld {
  readonly definition: WorldDefinition;
  readonly source:
    | 'preview-override'
    | 'equipped-theme'
    | 'seasonal-event'
    | 'weekly-event'
    | 'base'
    | 'unknown';
  /**
   * Originating event id when the resolution passed through an event.
   * `null` when the world is the base world.
   */
  readonly eventId: string | null;
}
