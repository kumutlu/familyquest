/**
 * Theme → recovered painted plate.
 *
 * The Experience Theme engine decides WHICH theme is in effect; this map
 * says which painted environment that theme is rendered against. It is data,
 * not behaviour — adding a theme is a one-line addition, and the renderer
 * never inspects an id to decide what to draw.
 *
 * WHY THIS MAP EXISTS
 * -------------------
 * The Theme Shop release shipped in a lineage that never merged the Queki
 * World System V2 artwork, so shop themes resolved to token-only CSS worlds
 * (`world.neon`, `world.space`, `world.rainbow`, `world.pixel`,
 * `world.calm`) and every surface showed flat colour instead of the painted
 * worlds that had already been authored. The five shop items map onto the
 * five authored collectible environments by accent-hue parity, so a theme and
 * its painted world agree on colour:
 *
 *   theme.shop.neon    (#22d3ee cyan)    → world.neon-city      (#25ddff)
 *   theme.shop.space   (#4f46e5 indigo)  → world.space-explorer (#8da8ff)
 *   theme.shop.rainbow (#d946ef magenta) → world.candy-kingdom  (#ffc0dc)
 *   theme.shop.pixel   (#16a34a green)   → world.dino-jungle    (#efb457)
 *   theme.shop.calm    (#0d9488 teal)    → world.underwater     (#54d6d0)
 */

import { getWorldPlate, type WorldPlate, type WorldPlateId } from '../../assets/worlds/plates';

export const THEME_ID_TO_PLATE_ID: Readonly<Record<string, WorldPlateId>> = Object.freeze({
  'theme.standard': 'world.normal',
  'theme.christmas': 'world.christmas',
  'theme.halloween': 'world.halloween',
  'theme.eid': 'world.eid',
  'theme.ramadan': 'world.eid',
  'theme.weekly.neon': 'world.neon-city',
  'theme.shop.neon': 'world.neon-city',
  'theme.shop.space': 'world.space-explorer',
  'theme.shop.rainbow': 'world.candy-kingdom',
  'theme.shop.pixel': 'world.dino-jungle',
  'theme.shop.calm': 'world.underwater',
});

/**
 * The painted plate for a theme, or `undefined` when the theme has no
 * authored environment (the caller then falls back to the token world).
 */
export function getThemePlate(themeId: string | null | undefined): WorldPlate | undefined {
  if (typeof themeId !== 'string' || themeId.length === 0) return undefined;
  const plateId = THEME_ID_TO_PLATE_ID[themeId];
  return plateId ? getWorldPlate(plateId) : undefined;
}
