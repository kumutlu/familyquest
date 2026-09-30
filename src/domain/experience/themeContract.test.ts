/**
 * Theme token contract tests (spec §C).
 *
 * Pins the ONE visual contract: the CSS-value `tokens` bundle consumed by
 * ChildExperienceShell (`--qk-theme-*` custom properties). The legacy
 * `visuals` token-NAME metadata is descriptive only and must never be
 * required for rendering.
 *
 * Also pins theme→world mappings so the seasonal/world layer stays aligned
 * with the theme catalog (spec §D).
 */

import { describe, expect, it } from 'vitest';
import {
  THEME_CATALOG,
  validThemeTokens,
  DEFAULT_SHOP_PRICES,
  SHOP_THEME_IDS,
  getShopThemeByItemId,
  getThemeById,
} from './index';
import { THEME_ID_TO_WORLD_ID, WORLD_CATALOG, getWorldById } from '../experienceWorld';

describe('theme token contract', () => {
  it('every catalog theme carries a valid CSS-value token bundle', () => {
    for (const theme of THEME_CATALOG) {
      const tokens = validThemeTokens(theme.tokens);
      expect(tokens, `${theme.id} tokens must validate`).toBeDefined();
      expect(tokens!.accent).toMatch(/^(#|rgba?\()/);
      expect(tokens!.ambientFrom).toMatch(/^(#|rgba?\()/);
      expect(tokens!.ambientTo).toMatch(/^(#|rgba?\()/);
      if (tokens!.patternDensity !== undefined) {
        expect(tokens!.patternDensity).toBeGreaterThanOrEqual(0);
        expect(tokens!.patternDensity).toBeLessThanOrEqual(1);
      }
    }
  });

  it('accepts a well-formed raw token bundle', () => {
    expect(validThemeTokens({ accent: '#ff0000', ambientFrom: '#000000', ambientTo: '#ffffff', patternDensity: 0.5 })).toEqual({
      accent: '#ff0000',
      accentSoft: undefined,
      ambientFrom: '#000000',
      ambientTo: '#ffffff',
      patternDensity: 0.5,
    });
  });

  it('rejects malformed bundles so the shell fails safe to the calm base world', () => {
    expect(validThemeTokens(undefined)).toBeUndefined();
    expect(validThemeTokens(null)).toBeUndefined();
    expect(validThemeTokens('nope')).toBeUndefined();
    expect(validThemeTokens({})).toBeUndefined();
    expect(validThemeTokens({ accent: 5, ambientFrom: '#000', ambientTo: '#fff' })).toBeUndefined();
    expect(validThemeTokens({ accent: '#f00', ambientFrom: 42, ambientTo: '#fff' })).toBeUndefined();
  });

  it('clamps an out-of-range pattern density instead of rejecting the bundle', () => {
    expect(validThemeTokens({ accent: '#f00', ambientFrom: '#000', ambientTo: '#fff', patternDensity: 9 })!.patternDensity).toBe(1);
    expect(validThemeTokens({ accent: '#f00', ambientFrom: '#000', ambientTo: '#fff', patternDensity: -3 })!.patternDensity).toBe(0);
  });

  it('shell contract: shop themes map to distinct worlds (no structural duplication)', () => {
    const worldIds = SHOP_THEME_IDS
      .map(id => getShopThemeByItemId(id))
      .filter(Boolean)
      .map(theme => THEME_ID_TO_WORLD_ID[theme!.id]);
    expect(new Set(worldIds).size).toBe(SHOP_THEME_IDS.length);
    for (const worldId of worldIds) {
      expect(getWorldById(worldId), `world ${worldId}`).toBeDefined();
    }
  });

  it('every theme with a world mapping resolves to a real catalog world', () => {
    for (const [themeId, worldId] of Object.entries(THEME_ID_TO_WORLD_ID)) {
      expect(getThemeById(themeId), `theme ${themeId}`).toBeDefined();
      expect(WORLD_CATALOG.some(w => w.id === worldId), `world ${worldId}`).toBe(true);
    }
  });

  it('shop themes are purchasable cosmetics in the standard category (never event-driven)', () => {
    for (const id of SHOP_THEME_IDS) {
      const theme = getShopThemeByItemId(id)!;
      expect(theme.category).toBe('standard');
      expect(theme.shopItemId).toBe(id);
    }
  });

  it('built-in shop prices cover every shop item and are positive', () => {
    for (const id of SHOP_THEME_IDS) {
      expect(DEFAULT_SHOP_PRICES[id], `price for ${id}`).toBeGreaterThan(0);
    }
  });
});
