import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './utils/auth';

/**
 * Regression coverage for the global dark-mode token remap (Appearance release).
 *
 * The dark theme remaps the neutral palette so `bg-white` becomes a dark surface
 * and `gray-300` becomes a dark *surface* colour. `gray-300` is, however, also
 * used as a *foreground* token for muted glyphs/labels (chevrons, empty-state
 * icons, the balance-card label, breadcrumbs). If the foreground role is not
 * overridden, those glyphs turn dark-on-dark and disappear. This spec fails the
 * build if that regression returns.
 *
 * Requires the Firestore + Auth emulators and the seeded test family (run the
 * seed before `playwright test`, exactly like the other e2e specs).
 */

function setDark(page: Page) {
  // Applied before any page script so the inline bootstrap + appearance store
  // both see the persisted preference.
  return page.addInitScript(() => {
    try {
      localStorage.setItem('queki:appearance', 'dark');
    } catch {
      /* ignore */
    }
  });
}

// WCAG contrast ratio between two computed `rgb()/rgba()` colours.
function contrastRatio(a: string, b: string): number {
  const parse = (s: string) => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    const p = m![1].split(',').map((x) => parseFloat(x));
    return [p[0], p[1], p[2]] as const;
  };
  const lum = ([r, g, bl]: readonly number[]) => {
    const f = [r, g, bl].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };
  const L1 = lum(parse(a));
  const L2 = lum(parse(b));
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

test('dark mode: muted text-gray-300 glyphs stay visible (not dark-on-dark)', async ({ page }) => {
  await setDark(page);
  await loginAs(page, 'owner@test.com');

  // Wallet reliably renders the balance-card label (text-gray-300) and Family
  // renders member-row chevrons (text-gray-300).
  for (const route of ['/wallet', '/family']) {
    await page.goto(route);
    await page.waitForSelector('header', { timeout: 15000 });
    await page.waitForTimeout(800);

    const glyphs = page.locator('[class*="text-gray-300"]');
    const count = await glyphs.count();
    expect(count, `expected at least one text-gray-300 element on ${route}`).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const el = glyphs.nth(i);
      const fg = await el.evaluate((n) => getComputedStyle(n).color);
      // Resolve the effective background by walking ancestors.
      const bg = await el.evaluate((n) => {
        let node: Element | null = n;
        const rgb = (s: string) => {
          const m = s.match(/rgba?\(([^)]+)\)/);
          return m ? m[1].split(',').map((x) => parseFloat(x)) : null;
        };
        while (node) {
          const c = rgb(getComputedStyle(node).backgroundColor);
          if (c && c[3] > 0) return getComputedStyle(node).backgroundColor;
          node = node.parentElement;
        }
        return getComputedStyle(document.body).backgroundColor;
      });
      const ratio = contrastRatio(fg, bg);
      expect(ratio, `text-gray-300 glyph on ${route} is dark-on-dark (ratio ${ratio.toFixed(2)})`).toBeGreaterThanOrEqual(3);
    }
  }
});

test('dark mode: surfaces using bg-white are dark, not white', async ({ page }) => {
  await setDark(page);
  await loginAs(page, 'owner@test.com');
  await page.goto('/family');
  await page.waitForSelector('header', { timeout: 15000 });
  await page.waitForTimeout(800);

  const cards = page.locator('[class*="bg-white"]');
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const bg = await cards.nth(i).evaluate((n) => getComputedStyle(n).backgroundColor);
    const m = bg.match(/rgba?\(([^)]+)\)/);
    const [r, g, b] = m![1].split(',').map((x) => parseFloat(x));
    // Luminance of a near-white surface would be ~1.0; dark surfaces are < 0.2.
    const lum = (() => {
      const f = [r, g, b].map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    })();
    expect(lum, `bg-white surface is still light in dark mode: ${bg}`).toBeLessThan(0.25);
  }
});
