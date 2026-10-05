/**
 * Theme personality definitions for the purchasable shop themes.
 *
 * Kept beside the theme definitions rather than inside `fixtures/themes.ts`
 * so the catalogue file stays a pure colour/ambient catalogue and the
 * personality intent for each theme is reviewable in one place.
 *
 * Design intent per theme, stated as the grayscale test it must pass:
 *
 *   NEON ARCADE — sharp / electric / synthetic / arcade
 *     Dark glass, tiny radius, a machined BEVEL edge, a hard offset shadow, a
 *     high-frequency grid+scanline motif, and a luminous linear progress fill.
 *     Every axis points at hard edges and fine texture.
 *
 *   SPACE EXPLORER — deep / atmospheric / orbital / spacious
 *     Its own form language at the OPPOSITE frequency: a halo edge with no
 *     drawn line, one wide faint drop, large radius, heavy blur, low opacity,
 *     and a large irregular orbit motif. Deliberately NOT "less Neon" — the
 *     distinction is geometric, so it survives grayscale.
 *
 *   CALM PASTEL — soft / quiet / low-stimulation
 *     Near-opaque light surfaces, generous radius, very weak border, almost no
 *     shadow, no motif at all, a flat progress fill, and the lowest motion
 *     scale of the three. It is the only theme with `decorationDensity: 0`.
 */

/**
 * Neutral personality for the shop themes that have not been given a distinct
 * language yet (Rainbow Pop, Pixel Quest). They deliberately read as Queki
 * with their accent applied rather than claiming a personality they have not
 * been art-directed for.
 */
export const DEFAULT_SHOP_PERSONALITY = {
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
} as const;

/**
 * Neon Arcade — SHARP / ELECTRIC / SYNTHETIC.
 *
 * Every axis here points at hard edges and high-frequency structure, because
 * that is what "arcade hardware" looks like without any hue:
 *
 *   bevel border + 1.9 border strength + radius 10  → machined, tiny corners
 *   lifted shadow with a 2px hard accent offset     → sits ON the world
 *   machined interior (top rail + corner brackets)  → the panel has FURNITURE
 *   grid motif (32px lattice + 7px scanlines)       → high-frequency texture
 *   deep track + luminous fill                      → linear, electric progress
 *
 * `innerTreatment: 'machined'` is the axis that closes the last gap with Space.
 * Edge, radius, blur, opacity, shadow and glow had already diverged, but a
 * grayscale measurement of the card interiors still put their local contrast
 * ~3% apart: with the world plate cropped away both cards were a smooth
 * rectangle. Neon now carries hard, small, repeated interior detail — a top
 * rail, corner brackets, a crisp inset seam — so its interior is high-frequency
 * where Space's is a single wide soft gradient.
 *
 * `glow: 0.55` is a real bloom, not a tint: it is what makes the edge read as
 * light-emitting in grayscale. The blur is kept LOW (10px) on purpose — heavy
 * blur would soften everything this theme is trying to sharpen.
 */
export const NEON_ARCADE_PERSONALITY = {
  surfaceScheme: 'dark',
  surfaceDarkness: 0.62,
  surfaceOpacity: 0.86,
  surfaceBlur: 10,
  surfaceRadius: 10,
  borderStrength: 1.9,
  borderStyle: 'bevel',
  shadow: 'lifted',
  glow: 0.55,
  pattern: 'grid',
  patternOpacity: 0.22,
  progressTrack: 'deep',
  progressEffect: 'luminous',
  innerTreatment: 'machined',
  decorationDensity: 0.7,
  motionScale: 0.9,
} as const;

/**
 * Space Explorer — DEEP / ATMOSPHERIC / ORBITAL / SPACIOUS.
 *
 * This is deliberately its own form language, not "less Neon". Where Neon works
 * at high frequency with hard edges, Space works at LOW frequency with soft
 * ones, and the difference is geometric rather than a matter of degree:
 *
 *   halo border (no drawn line, soft outward bloom)  vs Neon's bevel
 *   halo shadow (one wide faint drop, nothing hard)   vs Neon's lifted offset
 *   radius 26 vs 10, blur 28 vs 10                   → softer and deeper
 *   opacity 0.68 vs 0.86                             → more world reads through
 *   atmospheric interior (one wide soft inner light)  → NO interior edges
 *   orbit motif (84px/132px rings + sparse stars)    → large-scale, irregular
 *   inset track + orbital fill                       → depth, not light
 *
 * `glow` is low (0.22) on purpose: Space should halo, not shine.
 *
 * `innerTreatment: 'atmospheric'` gives Space its own interior form language at
 * the OPPOSITE frequency to Neon's: no rails, no brackets, no seams — one very
 * wide soft light across the top and a soft inner falloff at the rim, so the
 * card reads as a volume rather than as a panel. This is deliberately not
 * "Neon with the brackets removed"; it is the only theme whose interior has no
 * straight line in it at all.
 */
export const SPACE_PERSONALITY = {
  surfaceScheme: 'dark',
  surfaceDarkness: 0.74,
  surfaceOpacity: 0.68,
  surfaceBlur: 28,
  surfaceRadius: 26,
  borderStrength: 0.6,
  borderStyle: 'halo',
  shadow: 'halo',
  glow: 0.22,
  pattern: 'orbit',
  patternOpacity: 0.22,
  progressTrack: 'inset',
  progressEffect: 'orbital',
  innerTreatment: 'atmospheric',
  decorationDensity: 0.3,
  motionScale: 0.75,
} as const;

/**
 * Calm Pastel — soft, quiet, low-stimulation.
 *
 * Deliberately the INVERSE of the two dark themes: near-opaque (0.97) so the
 * world barely interferes, no blur and no glow, the largest radius, the
 * weakest border, no motif, and the lowest motion scale of the three.
 *
 * The three enum axes matter more than they look. An earlier draft left
 * `shadow`/`progressTrack`/`progressEffect` on the neutral placeholder's
 * `soft`/`soft`/`flat`, which made Calm indistinguishable from Queki Classic
 * in grayscale on exactly the axes a quiet theme is supposed to be judged on.
 * It now authors `matte`/`matte`/`gentle`: a tight paper lift instead of a
 * cast shadow, a flat track instead of an inset well, and a fill that eases in
 * with no bloom. Still the quietest of the three — just deliberately so.
 *
 * `innerTreatment: 'flat'` is Calm's third "none": no motif, no glow, and now
 * an explicitly empty interior. The reset rule matters as much as the two
 * treatments above it — without it, switching from Neon to Calm in place would
 * leave Neon's rails and brackets painted on a paper card.
 */
export const CALM_PERSONALITY = {
  surfaceScheme: 'light',
  surfaceDarkness: 0,
  surfaceOpacity: 0.97,
  surfaceBlur: 0,
  surfaceRadius: 22,
  borderStrength: 0.55,
  borderStyle: 'solid',
  shadow: 'matte',
  glow: 0,
  pattern: 'none',
  patternOpacity: 0,
  progressTrack: 'matte',
  progressEffect: 'gentle',
  innerTreatment: 'flat',
  decorationDensity: 0,
  motionScale: 0.3,
} as const;

/** Shop item id → personality. Themes absent here fall back to the neutral default. */
export const SHOP_THEME_PERSONALITY: Readonly<Record<string, unknown>> = Object.freeze({
  neon: NEON_ARCADE_PERSONALITY,
  space: SPACE_PERSONALITY,
  calm: CALM_PERSONALITY,
  rainbow: DEFAULT_SHOP_PERSONALITY,
  pixel: DEFAULT_SHOP_PERSONALITY,
});