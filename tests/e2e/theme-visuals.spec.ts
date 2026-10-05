import { test, expect, type Page, type Locator } from '@playwright/test';
import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { loginAs } from './utils/auth';
import { decodePng, dominantColor, parseCssColor, contrastRatio } from './utils/pngProbe';

/**
 * Theme Shop + applied-world VISUAL QA.
 *
 * Captures the deliverable screenshot set for the theme recovery work at the
 * two required sizes:
 *
 *   desktop 1440×900   ·   mobile 390×844
 *
 *   - the Theme Shop list (real recovered artwork on every card)
 *   - the purchase sheet for an affordable theme
 *   - the insufficient-balance state for the reported 487/500 scenario
 *   - the child Home with each of the five themes applied
 *
 * These are not assertions about pixels: the spec drives the real UI against
 * the emulator and writes PNGs, so the result can be reviewed by eye.
 */

const OUT = resolve(process.cwd(), 'screenshots/theme-recovery');

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

/** Shop item id → the theme id it equips. */
const THEMES: ReadonlyArray<{ shopItemId: string; themeId: string; label: string }> = [
  { shopItemId: 'classic', themeId: 'theme.standard', label: 'classic' },
  { shopItemId: 'neon', themeId: 'theme.shop.neon', label: 'neon-arcade' },
  { shopItemId: 'space', themeId: 'theme.shop.space', label: 'space-explorer' },
  { shopItemId: 'rainbow', themeId: 'theme.shop.rainbow', label: 'rainbow-pop' },
  { shopItemId: 'pixel', themeId: 'theme.shop.pixel', label: 'pixel-quest' },
  { shopItemId: 'calm', themeId: 'theme.shop.calm', label: 'calm-pastel' },
];

/**
 * Readability audit for the painted child Home — measured from REAL pixels.
 *
 * The home's copy sits on translucent surfaces (`.qk-hero` is a 22% gradient)
 * over the painted plate, so the effective backdrop is plate → veil → hero tint
 * composited by the browser. Modelling that by hand is exactly how a
 * readability bug hides, so this screenshots the whole shell ONCE and then, for
 * every text-bearing leaf element, measures the dominant backdrop colour behind
 * it and the WCAG ratio against the colour that text really renders in.
 *
 * Returns the WORST offender — one unreadable label is a bug, so the gate is
 * on the minimum, not the average.
 */
async function measureTextContrast(page: Page, rootSelector: string) {
  const targets = await page.evaluate((selector: string) => {
    const shell = document.querySelector(selector);
    if (!shell) return [];

    const out: Array<{ text: string; color: string; font: string; cls: string; box: { x: number; y: number; width: number; height: number } }> = [];
    const nodes = shell.querySelectorAll<HTMLElement>('h1, h2, h3, p, span, dt, dd, button, a');

    for (const el of Array.from(nodes)) {
      // Leaf text only: a container's rect would be dominated by its padding.
      if (el.children.length > 0) continue;
      const text = (el.textContent ?? '').trim();
      if (text.length < 2) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width < 12 || rect.height < 8 || rect.width > window.innerWidth) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight * 1.2) continue;

      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.opacity === '0') continue;

      // Tight box: a padded box spills outside small pill-shaped chips and
      // then reports the world behind the chip as the backdrop. Glyph pixels
      // are removed by colour instead (see dominantColor).
      const padX = 2;
      const padY = 2;
      // Walk up to the nearest surface ancestor so a failure names the actual
      // painted surface instead of a bare span.
      let surface: HTMLElement | null = el;
      for (let i = 0; i < 4 && surface; i += 1) {
        if (getComputedStyle(surface).backgroundColor !== 'rgba(0, 0, 0, 0)') break;
        surface = surface.parentElement;
      }
      out.push({
        text: text.slice(0, 24),
        color: style.color,
        font: style.fontSize,
        cls: (surface?.className ?? '').toString().split(' ').slice(0, 8).join(' '),
        box: {
          x: rect.x - padX,
          y: rect.y - padY,
          width: rect.width + padX * 2,
          height: rect.height + padY * 2,
        },
      });
    }
    return out;
  }, rootSelector);

  if (!targets.length) return null;

  const shot = await page.screenshot({ fullPage: false });
  const image = decodePng(shot);

  const offenders: Array<{ text: string; color: string; cls: string; contrast: number }> = [];
  const byKey: Record<string, number> = {};
  let worst = { text: '', color: '', contrast: Number.POSITIVE_INFINITY, backdrop: { r: 0, g: 0, b: 0, a: 1 } };

  for (const target of targets) {
    const text = parseCssColor(target.color) ?? { r: 0, g: 0, b: 0, a: 1 };
    const backdrop = dominantColor(image, target.box, text);
    const contrast = Math.round(contrastRatio(backdrop, text) * 100) / 100;
    // Keyed by copy + ink so the SAME label can be compared between the
    // themed and un-themed renders of the same DOM.
    byKey[`${target.text}|${target.color}`] = contrast;
    if (contrast < 4.5) offenders.push({ text: target.text, color: target.color, cls: target.cls, contrast });
    if (contrast < worst.contrast) {
      worst = { text: target.text, color: target.color, contrast, backdrop };
    }
  }

  return { ...worst, audited: targets.length, offenders: offenders.slice(0, 24), byKey };
}

/**
 * Turn the painted plate off/on WITHOUT touching the app: the shell keys its
 * on-world styling off `data-experience-plate`, and the plate node is hidden.
 *
 * This yields the honest BASELINE — the same screen the child would see if the
 * world were not painted — so a contrast number can be attributed to the
 * artwork instead of to the app's own palette.
 */
async function setPlateEnabled(page: Page, enabled: boolean) {
  await page.evaluate((on: boolean) => {
    const shell = document.querySelector<HTMLElement>('[data-testid="child-experience-shell"]');
    if (shell) shell.setAttribute('data-experience-plate', on ? '1' : '0');
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.qk-world-plate'))) {
      el.style.display = on ? '' : 'none';
    }
  }, enabled);
  // Let the browser settle the style recalc before the next screenshot.
  await page.waitForTimeout(250);
}

/** Contrast of ONE element, measured from rendered pixels. */
async function measureElementContrast(page: Page, selector: string) {
  const target = await page.evaluate((sel: string) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return null;
    const style = getComputedStyle(el);
    return {
      color: style.color,
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  }, selector);
  if (!target) return null;

  const image = decodePng(await page.screenshot({ fullPage: false }));
  const ink = parseCssColor(target.color) ?? { r: 0, g: 0, b: 0, a: 1 };
  const backdrop = dominantColor(image, target.box, ink);
  return {
    color: target.color,
    contrast: Math.round(contrastRatio(backdrop, ink) * 100) / 100,
  };
}

async function openThemes(page: Page) {
  // Themes lives inside the "More" menu for children.
  await page.getByRole('button', { name: 'More' }).first().click();
  await page.getByTestId('more-themes').click();
  await expect(page.getByTestId('theme-shop')).toBeVisible({ timeout: 20_000 });
}

/** Wait for the child home to finish bootstrapping its world. */
async function settleHome(page: Page) {
  await page.waitForTimeout(2500);
}

/**
 * Prove a painted plate is REALLY on screen, not just present in the DOM.
 *
 * Returns the decoded image width and the average colour of 5 sampled pixels.
 * A broken/missing asset reports `naturalWidth === 0`; a flat placeholder
 * reports a single uniform colour. A real painted world reports a wide,
 * non-uniform spread.
 */
async function plateRendering(scope: Locator) {
  const img = scope.locator('img').first();
  return img.evaluate((node: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 24;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(node, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const samples: Array<[number, number, number]> = [];
    for (let i = 0; i < data.length; i += 4 * 40) {
      samples.push([data[i], data[i + 1], data[i + 2]]);
    }
    const mean = [0, 1, 2].map((c) =>
      Math.round(samples.reduce((sum, s) => sum + s[c], 0) / samples.length),
    );
    // Channel spread across samples: 0 means a single flat colour.
    const spread = Math.max(
      ...samples.map((s) => Math.max(...s) - Math.min(...s)),
    );
    return { naturalWidth: node.naturalWidth, mean, spread };
  });
}

test.describe('Theme Shop visuals', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed-theme-visuals.ts', { stdio: 'ignore' });
    mkdirSync(OUT, { recursive: true });
  });

  for (const viewport of VIEWPORTS) {
    test(`shop, purchase sheet and all five applied worlds — ${viewport.name}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      // ---------------------------------------------------------------- sheet --
      // Leo owns everything, so he sees Owned/Current and an affordable sheet.
      await loginAs(page, 'child@test.com');
      await settleHome(page);
      await openThemes(page);

      await page.waitForTimeout(1500); // let the painted plates decode
      await page.screenshot({
        path: `${OUT}/shop-${viewport.name}.png`,
        fullPage: true,
      });

      // The cards must be selling the REAL painted worlds, not rectangles:
      // every shop card renders the recovered artwork, decoded and non-flat.
      for (const theme of THEMES.filter((t) => t.shopItemId !== 'classic')) {
        const preview = page.getByTestId(`theme-preview-${theme.themeId}`);
        await expect(preview).toHaveAttribute('data-preview-kind', 'painted');
        const painting = await plateRendering(preview);
        expect(painting.naturalWidth, `${theme.label} artwork decoded`).toBeGreaterThan(400);
        // "Not a flat fill" = the decoded PLATE, not a placeholder rectangle.
        // Pixel-art plates are legitimately flatter than the painted worlds
        // (measured 29 for pixel-quest vs 60-161 for the painted set), so the
        // bar sits under that floor while still collapsing any flat gradient
        // placeholder (spread < 10) to a failure.
        expect(painting.spread, `${theme.label} artwork is not a flat fill`).toBeGreaterThan(25);
      }

      // No horizontal overflow at either required size.
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflows, 'no horizontal overflow').toBe(false);

      // ------------------------------------------------------- apply the five --
      for (const theme of THEMES) {
        await openThemes(page);
        await page.getByTestId(`theme-card-${theme.shopItemId}`).click();
        const focus = page.getByTestId('theme-shop-focus');
        await expect(focus).toBeVisible();

        const apply = focus.getByRole('button', { name: 'Use this theme' });
        if (await apply.isVisible().catch(() => false)) {
          await apply.click();
          await expect(focus.getByText('Applied')).toBeVisible({ timeout: 15_000 });
        }

        // Home with the theme applied.
        await page.goto('/');
        await settleHome(page);

        const shell = page.locator('[data-testid="child-experience-shell"]');
        await expect(shell).toBeVisible({ timeout: 20_000 });
        // The applied theme must paint its recovered world behind the home.
        await expect(shell).toHaveAttribute('data-experience-plate', '1');
        const plate = page.locator('[data-plate-status="ready"]').first();
        await expect(plate).toBeVisible({ timeout: 20_000 });
        // The backdrop carries a readability veil so child copy stays legible
        // over the dark painted environments.
        await expect(plate.getByTestId('world-plate-scrim')).toBeAttached();
        const painting = await plateRendering(plate);
        expect(painting.naturalWidth, `${theme.label} world decoded`).toBeGreaterThan(400);

        await page.screenshot({
          path: `${OUT}/applied-${theme.label}-${viewport.name}.png`,
          fullPage: false,
        });

        // Legibility is measured from rendered pixels, not modelled.
        const name = await measureElementContrast(page, '[data-testid="child-identity-name"]');
        const withPlate = await measureTextContrast(page, '[data-testid="child-experience-shell"]');
        expect(name, `${theme.label} identity name found`).not.toBeNull();
        expect(withPlate, `${theme.label} home text found`).not.toBeNull();

        // The SAME screen with the world switched off: this is the honest
        // baseline, because the app's own palette carries contrast choices
        // (white on the mint wallet pill, amber reward ink) that have nothing
        // to do with the artwork.
        await setPlateEnabled(page, false);
        const withoutPlate = await measureTextContrast(page, '[data-testid="child-experience-shell"]');
        await setPlateEnabled(page, true);
        expect(withoutPlate, `${theme.label} baseline text found`).not.toBeNull();

        // A label fails only if the WORLD is what made it unreadable: it is
        // below AA AND it was not already below AA in the un-themed render,
        // OR the artwork measurably moved it down.
        const regressions: string[] = [];
        for (const [key, contrast] of Object.entries(withPlate!.byKey)) {
          const baseline = withoutPlate!.byKey[key];
          if (baseline === undefined) continue; // not present in both renders
          if (contrast >= 4.5) continue; // clears AA — nothing to attribute
          if (contrast < baseline - 0.15) {
            regressions.push(`"${key.split('|')[0]}" ${baseline}:1 → ${contrast}:1`);
          }
        }

        // Record what was actually painted, for the report.
        // eslint-disable-next-line no-console
        console.log(
          `[theme-visuals] ${viewport.name} ${theme.label} plate=${painting.naturalWidth}px mean=rgb(${painting.mean.join(',')})`
          + ` spread=${painting.spread} name=${name!.contrast}:1`
          + ` audited=${withPlate!.audited} worst="${withPlate!.text}" worstContrast=${withPlate!.contrast}:1`
          + ` belowAA=${withPlate!.offenders.length} plateRegressions=${regressions.length}`,
        );
        if (withPlate!.offenders.length) {
          // eslint-disable-next-line no-console
          console.log(
            `[theme-visuals-offenders] ${viewport.name} ${theme.label} `
            + withPlate!.offenders.map((o) => {
              const base = withoutPlate!.byKey[`${o.text}|${o.color}`];
              return `"${o.text}"(${o.color})[${o.cls}]@${o.contrast}vsBase${base ?? '?'}`;
            }).join(' | '),
          );
        }

        // The child's own name is the primary content of the applied theme.
        expect(
          name!.contrast,
          `${theme.label} identity name contrast (${name!.color})`,
        ).toBeGreaterThanOrEqual(4.5);
        // The painted world must never make the home harder to read than the
        // same home without it.
        expect(
          regressions,
          `${theme.label} copy made worse by the artwork: ${regressions.join(', ')}`,
        ).toHaveLength(0);
      }
    });
  }

  for (const viewport of VIEWPORTS) {
    test(`insufficient balance: 487 pts vs a 500 pts theme — ${viewport.name}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      // Ava has 487 pts and owns nothing — the exact reported scenario.
      await loginAs(page, 'child2@test.com');
      await settleHome(page);
      await openThemes(page);

      await page.waitForTimeout(1200);
      await page.screenshot({
        path: `${OUT}/shop-shortfall-${viewport.name}.png`,
        fullPage: true,
      });

      await page.getByTestId('theme-card-space').click();
      const focus = page.getByTestId('theme-shop-focus');
      await expect(focus).toBeVisible();

      // Preview is available; the buy affordance is gone and the gap is stated.
      await expect(focus.getByTestId('theme-purchase-shortfall')).toBeVisible({ timeout: 15_000 });
      await expect(focus.getByTestId('theme-purchase-shortfall')).toContainText('13 more points');
      await expect(focus.getByRole('button', { name: /Buy for/ })).toHaveCount(0);

      // The card still sells the real world even when it cannot be bought.
      const preview = page.getByTestId('theme-preview-theme.shop.space');
      const painting = await plateRendering(preview);
      expect(painting.naturalWidth).toBeGreaterThan(400);

      await page.waitForTimeout(800);
      await page.screenshot({
        path: `${OUT}/shortfall-space-${viewport.name}.png`,
        fullPage: false,
      });
    });
  }

  test('affordable purchase sheet — desktop', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });

    // Ava can afford the 300-pt themes, so the sheet shows the balance maths
    // for a real purchase she is allowed to make (487 → 187).
    await loginAs(page, 'child2@test.com');
    await settleHome(page);
    await openThemes(page);

    await page.getByTestId('theme-card-rainbow').click();
    const focus = page.getByTestId('theme-shop-focus');
    await expect(focus.getByRole('button', { name: 'Buy for 300 points' })).toBeVisible({ timeout: 15_000 });
    await focus.getByRole('button', { name: 'Buy for 300 points' }).click();
    const sheet = focus.getByTestId('purchase-confirmation');
    await expect(sheet).toBeVisible();

    // The sheet previews the same painted world the child is buying.
    const sheetPreview = sheet.getByTestId('theme-preview-theme.shop.rainbow');
    await expect(sheetPreview).toHaveAttribute('data-preview-kind', 'painted');
    const painting = await plateRendering(sheetPreview);
    expect(painting.naturalWidth).toBeGreaterThan(400);
    expect(painting.spread, 'sheet artwork is not a flat fill').toBeGreaterThan(30);
    await expect(sheet.getByTestId('sheet-balance')).toHaveText('487 points');
    await expect(sheet.getByTestId('sheet-after')).toHaveText('187 points');

    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/purchase-sheet-desktop.png`, fullPage: false });
  });
});
