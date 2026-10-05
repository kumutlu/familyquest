/**
 * Recovered Queki world plates — the painted world artwork.
 *
 * These are the ORIGINAL Queki World System V2 environment plates (authored
 * as full-bleed painted environments, shipped at four breakpoints in AVIF /
 * WebP / JPEG). They were recovered from the `codex/queki-worlds-v2-phase1`
 * lineage, which the Theme Shop release never merged — which is precisely why
 * the live Theme Shop could only render token-coloured rectangles.
 *
 * Vite resolves every import at build time via `import.meta.glob`, so the
 * deployed bundle ships hashed, immutable asset paths and the renderer stays
 * purely declarative: it looks up `WORLD_PLATES[worldId]` and gets URLs back.
 *
 * No new art is authored here. This module only indexes what already existed.
 */

/** The ten painted environments, addressed by their original world id. */
export type WorldPlateId =
  | 'world.neon-city'
  | 'world.space-explorer'
  | 'world.candy-kingdom'
  | 'world.dino-jungle'
  | 'world.underwater'
  | 'world.enchanted-forest'
  | 'world.normal'
  | 'world.christmas'
  | 'world.halloween'
  | 'world.eid';

/** Viewports the plates were exported at. */
export type WorldPlateViewport = 'mobile' | 'tabletPortrait' | 'tabletLandscape' | 'desktop';

export interface WorldPlateVariant {
  /** AVIF source (smallest). */
  readonly avif: string;
  /** WebP source. */
  readonly webp: string;
  /** Universal JPEG fallback for `<img src>`. */
  readonly jpg: string;
  readonly width: number;
  readonly height: number;
}

export interface WorldPlate {
  readonly id: WorldPlateId;
  /** Human-readable environment name, as authored. */
  readonly name: string;
  readonly variants: Readonly<Record<WorldPlateViewport, WorldPlateVariant>>;
  /**
   * Colour painted before the image decodes, sampled from the plate itself so
   * the transition into the artwork is invisible.
   */
  readonly fallbackColor: string;
  /** Accent sampled from the plate — drives the atmosphere layer. */
  readonly accent: string;
  /** Legacy seasonal-world id whose token/particle treatment pairs with it. */
  readonly worldId: string;
}

/* -------------------------------------------------------------------------- */
/* Asset resolution                                                           */
/* -------------------------------------------------------------------------- */

const urls = import.meta.glob('/src/assets/worlds/v2/**/*.{avif,webp,jpg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** Authored export sizes — must match how the plates were rendered. */
const VIEWPORTS: Readonly<Record<WorldPlateViewport, readonly [string, number, number]>> = {
  mobile: ['mobile', 480, 1040],
  tabletPortrait: ['tablet-portrait', 768, 1024],
  tabletLandscape: ['tablet-landscape', 1024, 768],
  desktop: ['desktop', 1440, 900],
};

function variant(slug: string, viewport: WorldPlateViewport): WorldPlateVariant {
  const [name, width, height] = VIEWPORTS[viewport];
  const lookup = (ext: string) => urls[`/src/assets/worlds/v2/${slug}/${name}.${ext}`];
  return Object.freeze({
    avif: lookup('avif'),
    webp: lookup('webp'),
    jpg: lookup('jpg'),
    width,
    height,
  });
}

function plate(
  id: WorldPlateId,
  slug: string,
  name: string,
  fallbackColor: string,
  accent: string,
  worldId: string,
): WorldPlate {
  return Object.freeze({
    id,
    name,
    variants: Object.freeze({
      mobile: variant(slug, 'mobile'),
      tabletPortrait: variant(slug, 'tabletPortrait'),
      tabletLandscape: variant(slug, 'tabletLandscape'),
      desktop: variant(slug, 'desktop'),
    }),
    fallbackColor,
    accent,
    worldId,
  });
}

/**
 * The plate index. Colours are the authored values from the World System V2
 * catalogue, so a plate and its token layer can never disagree.
 */
export const WORLD_PLATES: Readonly<Record<WorldPlateId, WorldPlate>> = Object.freeze({
  'world.neon-city': plate('world.neon-city', 'neon-city', 'Neon City', '#070d25', '#25ddff', 'world.neon'),
  'world.space-explorer': plate('world.space-explorer', 'space-explorer', 'Space Explorer', '#060b2b', '#8da8ff', 'world.space'),
  'world.candy-kingdom': plate('world.candy-kingdom', 'candy-kingdom', 'Candy Kingdom', '#55264f', '#ffc0dc', 'world.rainbow'),
  'world.dino-jungle': plate('world.dino-jungle', 'dino-jungle', 'Dino Jungle', '#0e3321', '#efb457', 'world.pixel'),
  'world.underwater': plate('world.underwater', 'underwater', 'Underwater', '#012e47', '#54d6d0', 'world.calm'),
  'world.enchanted-forest': plate('world.enchanted-forest', 'enchanted-forest', 'Enchanted Forest', '#042721', '#78e6a4', 'world.normal'),
  'world.normal': plate('world.normal', 'normal', 'Queki World', '#10082d', '#9b7cff', 'world.normal'),
  'world.christmas': plate('world.christmas', 'christmas', 'Festive Lights', '#3a0812', '#f7c65b', 'world.christmas'),
  'world.halloween': plate('world.halloween', 'halloween', 'Friendly Spooks', '#140a1d', '#ff9f36', 'world.halloween'),
  'world.eid': plate('world.eid', 'eid', 'Eid Celebration', '#022739', '#eacb74', 'world.eid'),
});

/** Look up a plate by id. Returns `undefined` for unknown ids. */
export function getWorldPlate(id: string | null | undefined): WorldPlate | undefined {
  if (typeof id !== 'string' || id.length === 0) return undefined;
  return (WORLD_PLATES as Record<string, WorldPlate>)[id];
}
