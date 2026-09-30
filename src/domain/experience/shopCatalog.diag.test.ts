import { describe, expect, it } from 'vitest';
import { THEME_CATALOG, getShopThemeByItemId, SHOP_THEME_IDS, getThemeById } from './index';

describe('shop theme catalog wiring', () => {
  it('exposes a theme definition for every shop item id', () => {
    for (const id of SHOP_THEME_IDS) {
      expect(getShopThemeByItemId(id), `shop item ${id}`).toBeDefined();
    }
  });

  it('SPACE_THEME is discoverable by item id', () => {
    expect(getShopThemeByItemId('space')?.id).toBe('theme.shop.space');
  });

  it('carries CSS-value token bundles on every shop theme', () => {
    for (const id of SHOP_THEME_IDS) {
      const theme = getShopThemeByItemId(id)!;
      expect(theme.tokens?.accent, theme.id).toMatch(/^#/);
      expect(theme.tokens?.ambientFrom, theme.id).toMatch(/^#/);
      expect(theme.tokens?.ambientTo, theme.id).toMatch(/^#/);
      expect(typeof theme.tokens?.patternDensity).toBe('number');
    }
  });

  it('keeps shop themes out of the weekly/seasonal event precedence paths', () => {
    for (const theme of THEME_CATALOG) {
      if (theme.id.startsWith('theme.shop.')) {
        expect(theme.category).toBe('standard');
      }
    }
  });

  it('default theme always resolves', () => {
    expect(getThemeById('theme.standard')!.name).toBe('Queki Standard');
  });
});
