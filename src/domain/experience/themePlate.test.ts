/**
 * Theme → recovered painted world mapping.
 *
 * Pins the ONE contract that connects the theme engine to the artwork:
 * every purchasable theme must resolve to an authored Queki World System V2
 * plate, and every plate it resolves to must be a real, complete export
 * (four breakpoints × three formats).
 *
 * This is the regression guard for the production defect where the shop could
 * only draw token-coloured rectangles: if a theme loses its plate, this fails
 * instead of silently falling back to a flat colour.
 */

import { describe, expect, it } from 'vitest';
import { getThemePlate, THEME_ID_TO_PLATE_ID } from './themePlate';
import { SHOP_THEME_IDS, getShopThemeByItemId } from './index';
import {
  WORLD_PLATES,
  getWorldPlate,
  type WorldPlateViewport,
} from '../../assets/worlds/plates';

const VIEWPORTS: readonly WorldPlateViewport[] = [
  'mobile',
  'tabletPortrait',
  'tabletLandscape',
  'desktop',
];

describe('theme → painted plate mapping', () => {
  it('maps every purchasable shop theme to an authored world', () => {
    for (const shopItemId of SHOP_THEME_IDS) {
      const theme = getShopThemeByItemId(shopItemId);
      expect(theme, `${shopItemId} missing from the shop catalog`).toBeDefined();
      const plate = getThemePlate(theme!.id);
      expect(plate, `${shopItemId} (${theme!.id}) has no painted world`).toBeDefined();
      expect(plate!.id).toMatch(/^world\./);
    }
  });

  it('resolves the five shop items through their catalog theme, not a hard-coded id', () => {
    // The shop UI resolves a plate from the theme the catalog hands it, so the
    // mapping must be reachable from the public catalog entry points too.
    expect(SHOP_THEME_IDS).toEqual(['neon', 'space', 'rainbow', 'pixel', 'calm']);
    for (const shopItemId of SHOP_THEME_IDS) {
      const theme = getShopThemeByItemId(shopItemId)!;
      expect(getThemePlate(theme.id), `${shopItemId} has no painted world`).toBeDefined();
    }
  });

  it('gives each of the five shop themes a DISTINCT world', () => {
    const ids = SHOP_THEME_IDS.map(
      (shopItemId) => getThemePlate(getShopThemeByItemId(shopItemId)!.id)!.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the default and seasonal themes painted as well', () => {
    for (const themeId of [
      'theme.standard',
      'theme.christmas',
      'theme.halloween',
      'theme.eid',
      'theme.ramadan',
    ]) {
      expect(getThemePlate(themeId), `${themeId} lost its painted world`).toBeDefined();
    }
  });

  it('returns undefined for unknown or empty themes instead of throwing', () => {
    // A theme with no authored world must degrade to the token world, which is
    // the documented fallback — never a fake placeholder.
    expect(getThemePlate('theme.does-not-exist')).toBeUndefined();
    expect(getThemePlate('')).toBeUndefined();
    expect(getThemePlate(null)).toBeUndefined();
    expect(getThemePlate(undefined)).toBeUndefined();
  });

  it('only references worlds that actually exist in the plate index', () => {
    for (const [themeId, plateId] of Object.entries(THEME_ID_TO_PLATE_ID)) {
      expect(getWorldPlate(plateId), `${themeId} → unknown ${plateId}`).toBeDefined();
    }
  });
});

describe('recovered world plates', () => {
  it('ships all ten authored environments', () => {
    expect(Object.keys(WORLD_PLATES).sort()).toEqual(
      [
        'world.candy-kingdom',
        'world.christmas',
        'world.dino-jungle',
        'world.eid',
        'world.enchanted-forest',
        'world.halloween',
        'world.neon-city',
        'world.normal',
        'world.space-explorer',
        'world.underwater',
      ].sort(),
    );
  });

  it('every plate resolves all four breakpoints in all three formats', () => {
    for (const plate of Object.values(WORLD_PLATES)) {
      for (const viewport of VIEWPORTS) {
        const variant = plate.variants[viewport];
        expect(variant, `${plate.id} missing ${viewport}`).toBeDefined();
        expect(variant.avif, `${plate.id}/${viewport} avif`).toMatch(/\.avif$/);
        expect(variant.webp, `${plate.id}/${viewport} webp`).toMatch(/\.webp$/);
        expect(variant.jpg, `${plate.id}/${viewport} jpg`).toMatch(/\.jpg$/);
        expect(variant.width).toBeGreaterThan(400);
        expect(variant.height).toBeGreaterThan(400);
      }
    }
  });

  it('carries the authored fallback colour so a theme never flashes white', () => {
    for (const plate of Object.values(WORLD_PLATES)) {
      expect(plate.fallbackColor, `${plate.id} fallback`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(plate.accent, `${plate.id} accent`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('pairs each plate with the token world it was authored for', () => {
    // The plate and the token/particle layer must agree, or a themed home would
    // mix a neon sky with a pastel palette.
    expect(getWorldPlate('world.neon-city')!.worldId).toBe('world.neon');
    expect(getWorldPlate('world.space-explorer')!.worldId).toBe('world.space');
    expect(getWorldPlate('world.candy-kingdom')!.worldId).toBe('world.rainbow');
    expect(getWorldPlate('world.dino-jungle')!.worldId).toBe('world.pixel');
    expect(getWorldPlate('world.underwater')!.worldId).toBe('world.calm');
  });
});
