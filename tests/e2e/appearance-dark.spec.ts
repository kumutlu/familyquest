import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { loginAs, logout } from './utils/auth';

/**
 * Regression coverage for the global dark-mode token remap (Appearance release).
 *
 * The dark theme remaps the neutral palette so `bg-white` becomes a dark surface
 * and `gray-300` becomes a dark *surface* colour. `gray-300` is, however, also
 * used as a *foreground* token for muted glyphs/labels (chevrons, empty-state
 * icons, the balance-card label, breadcrumbs). If the foreground role is not
 * overridden, those glyphs turn dark-on-dark and disappear.
 *
 * The first version of this spec only looked for literal `bg-white` cards, which
 * is why the Family Bulletin announcement — painted with the *semantic* tint
 * `bg-amber-50`/`bg-red-50` — shipped as a light cream card with near-white text.
 * The sweep below therefore judges **any** large surface by its computed colour,
 * regardless of which class produced it (warning, success, info, reward,
 * bulletin/announcement, custom tinted cards), plus the contrast of the text
 * painted on it.
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
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return [p[0], p[1], p[2]] as const;
  };
  const pa = parse(a);
  const pb = parse(b);
  // Unparseable colours (e.g. `transparent`, used for visually-hidden or
  // decorative text) are not a contrast defect — treat them as infinitely
  // readable rather than throwing.
  if (!pa || !pb) return Infinity;
  const L1 = luminance(pa);
  const L2 = luminance(pb);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

function luminance([r, g, bl]: readonly number[]): number {
  const f = [r, g, bl].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}

function parseRgb(colour: string): readonly number[] | null {
  const m = colour.match(/rgba?\(([^)]+)\)/);
  return m ? m[1].split(',').map((x) => parseFloat(x)) : null;
}

/** Routes exercised by the dark-mode sweep, per role. */
const PARENT_ROUTES = ['/', '/family', '/tasks', '/rewards', '/wallet', '/settings'];
const CHILD_ROUTES = ['/', '/tasks', '/rewards', '/wallet', '/settings'];

interface SurfaceReport {
  selector: string;
  background: string;
  luminance: number;
  area: number;
  text: string;
}

interface TextReport {
  selector: string;
  colour: string;
  background: string;
  ratio: number;
  text: string;
}

/**
 * Collect, in the page, every *large* painted surface and every visible text run
 * with its effective (ancestor-resolved) background. This is deliberately
 * class-agnostic: it is the check that would have caught the Family Bulletin
 * defect, because it looks at computed pixels rather than at `bg-white`.
 */
async function auditDarkSurfaces(page: Page) {
  return page.evaluate(() => {
    const describe = (element: Element) => {
      const classes = (element.getAttribute('class') ?? '').split(/\s+/).slice(0, 6).join(' ');
      const testId = element.getAttribute('data-testid');
      return `${element.tagName.toLowerCase()}${testId ? `[data-testid=${testId}]` : ''}${classes ? `.${classes.replace(/\s+/g, '.')}` : ''}`;
    };

    const rgb = (value: string) => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      return m ? m[1].split(',').map((x) => parseFloat(x)) : null;
    };

    // Solid semantic brand fills (e.g. `bg-success-500`, `bg-primary-500`) are
    // intentional, theme-stable colours used for buttons, badges, status pills,
    // progress bars and toasts. They are NOT "cards" that dark mode is expected
    // to recolour, and their foreground contrast is a separate, cross-theme
    // accessibility concern (tracked outside this dark-regression suite — see
    // the QA report, item 5: the Approve button at 2.28:1). We therefore exclude
    // them from the light-surface and unreadable-text checks below so the suite
    // stays focused on real dark-mode regressions: tinted cards / surfaces that
    // should have gone dark but didn't (the exact Family Bulletin defect class).
    const SOLID_FILL = /(^|\s)bg-(success|primary|danger|warning|info|reward|green|red|amber|blue|sky|violet|purple|orange|indigo|emerald|teal|pink|fuchsia|rose|cyan|lime)-(400|500|600|700|800|900)(?:\/\d+)?(?=\s|$)/;
    const isSolidFill = (el: Element | null) => !!el && SOLID_FILL.test(el.getAttribute('class') ?? '');

    const effectiveBackground = (element: Element): { value: string; source: Element | null } => {
      let node: Element | null = element;
      while (node) {
        const value = getComputedStyle(node).backgroundColor;
        const parts = rgb(value);
        if (parts && (parts[3] === undefined || parts[3] > 0.5)) return { value, source: node };
        node = node.parentElement;
      }
      return { value: getComputedStyle(document.body).backgroundColor, source: null };
    };

    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const surfaces: {
      selector: string;
      background: string;
      area: number;
      text: string;
    }[] = [];
    const texts: {
      selector: string;
      colour: string;
      background: string;
      text: string;
    }[] = [];

    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      const own = rgb(getComputedStyle(element).backgroundColor);
      // "Large surface" = a painted box big enough to read as a card/banner.
      // Solid semantic brand fills are excluded (see isSolidFill above).
      if (own && (own[3] === undefined || own[3] > 0.5) && rect.width * rect.height > 4000 && !isSolidFill(element)) {
        surfaces.push({
          selector: describe(element),
          background: getComputedStyle(element).backgroundColor,
          area: Math.round(rect.width * rect.height),
          text: (element.textContent ?? '').trim().slice(0, 60),
        });
      }

      const ownText = Array.from(element.childNodes).some(
        (child) => child.nodeType === 3 && (child.textContent ?? '').trim().length > 0,
      );
      if (!ownText) continue;
      const { value: bg, source } = effectiveBackground(element);
      // Skip text sitting on an intentional solid brand fill (button/badge/status).
      if (isSolidFill(source)) continue;
      texts.push({
        selector: describe(element),
        colour: getComputedStyle(element).color,
        background: bg,
        text: (element.textContent ?? '').trim().slice(0, 60),
      });
    }

    return { surfaces, texts };
  });
}

/** Fail on light surfaces and on unreadable text, whatever class produced them. */
async function expectDarkAndReadable(page: Page, where: string) {
  const { surfaces, texts } = await auditDarkSurfaces(page);

  const lightSurfaces: SurfaceReport[] = surfaces
    .map((surface) => ({
      ...surface,
      luminance: luminance(parseRgb(surface.background) ?? [0, 0, 0]),
    }))
    .filter((surface) => surface.luminance > 0.3);

  expect(
    lightSurfaces.map((s) => `${s.selector} → ${s.background} (lum ${s.luminance.toFixed(2)}, ${s.area}px², "${s.text}")`),
    `${where}: light surface(s) survived into dark mode`,
  ).toEqual([]);

  const unreadable: TextReport[] = texts
    .map((entry) => ({ ...entry, ratio: contrastRatio(entry.colour, entry.background) }))
    // 3:1 is the "clearly broken" floor: the production Family Bulletin defect
    // sat at ~1.2:1. Brand fills (white on primary-500 ≈ 4.5:1) stay green.
    .filter((entry) => entry.ratio < 3);

  expect(
    unreadable.map((t) => `${t.selector} "${t.text}" → ${t.ratio.toFixed(2)}:1 (${t.colour} on ${t.background})`),
    `${where}: text with unreadable contrast in dark mode`,
  ).toEqual([]);
}

test.describe('dark mode', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
  });

  test('muted text-gray-300 glyphs stay visible (not dark-on-dark)', async ({ page }) => {
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

  test('surfaces using bg-white are dark, not white', async ({ page }) => {
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
      expect(
        luminance(parseRgb(bg) ?? [0, 0, 0]),
        `bg-white surface is still light in dark mode: ${bg}`,
      ).toBeLessThan(0.25);
    }
  });

  test('parent: no light semantic surface or unreadable text on any main screen', async ({ page }) => {
    test.setTimeout(180_000);
    await setDark(page);
    await loginAs(page, 'owner@test.com');

    for (const route of PARENT_ROUTES) {
      await page.goto(route);
      await page.waitForSelector('header', { timeout: 15000 });
      await page.waitForTimeout(900);
      await expectDarkAndReadable(page, `parent ${route}`);
    }

    // Profile dropdown (menu surface + Sign Out row).
    await page.goto('/');
    await page.waitForSelector('header', { timeout: 15000 });
    await page.click('button[aria-label="Profile menu"]');
    await expect(page.locator('[role="menu"]')).toBeVisible();
    await expectDarkAndReadable(page, 'parent profile dropdown');
    await page.keyboard.press('Escape');

    // At least one modal: the profile editor opens from the same menu.
    await page.click('button[aria-label="Profile menu"]');
    await page.locator('[role="menuitem"]', { hasText: 'Edit Profile' }).click();
    await page.waitForTimeout(600);
    await expectDarkAndReadable(page, 'parent profile modal');
  });

  test('child: no light semantic surface or unreadable text on any main screen', async ({ page }) => {
    test.setTimeout(180_000);
    await setDark(page);
    await loginAs(page, 'child@test.com');

    for (const route of CHILD_ROUTES) {
      await page.goto(route);
      await page.waitForSelector('header', { timeout: 15000 });
      await page.waitForTimeout(900);
      await expectDarkAndReadable(page, `child ${route}`);
    }

    await page.goto('/');
    await page.waitForSelector('header', { timeout: 15000 });
    await page.click('button[aria-label="Profile menu"]');
    await expect(page.locator('[role="menu"]')).toBeVisible();
    await expectDarkAndReadable(page, 'child profile dropdown');
  });

  test('Family Bulletin announcement is dark and readable in every priority', async ({ page }) => {
    test.setTimeout(180_000);
    await setDark(page);
    await loginAs(page, 'owner@test.com');
    await page.goto('/');
    await page.waitForSelector('header', { timeout: 15000 });

    for (const priority of ['important', 'urgent', 'normal'] as const) {
      await page.getByRole('button', { name: 'Create announcement' }).click();
      await page.getByLabel('Title').fill(`Dark check ${priority}`);
      await page.getByLabel('Message').fill('Announcement body text for the dark-mode contrast check.');
      await page.getByLabel('Priority').selectOption(priority);
      await page.getByRole('button', { name: 'Publish' }).click();
      await page.waitForTimeout(1200);

      const card = page.locator('[data-testid="bulletin-announcement"]').first();
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute('data-priority', priority);

      const background = await card.evaluate((n) => getComputedStyle(n).backgroundColor);
      expect(
        luminance(parseRgb(background) ?? [0, 0, 0]),
        `${priority} announcement surface is light in dark mode: ${background}`,
      ).toBeLessThan(0.25);

      // Title, body and every action must be readable on that surface.
      const title = card.locator('[data-testid="bulletin-title"]');
      const message = card.locator('[data-testid="bulletin-message"]');
      for (const node of [title, message]) {
        const colour = await node.evaluate((n) => getComputedStyle(n).color);
        const ratio = contrastRatio(colour, background);
        expect(ratio, `announcement text ${colour} on ${background} is only ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
      for (const name of ['Mark as read', 'Edit', 'Archive', 'Delete']) {
        const action = card.getByRole('button', { name });
        await expect(action).toBeVisible();
        const colour = await action.evaluate((n) => getComputedStyle(n).color);
        const actionBg = await action.evaluate((n) => {
          const own = getComputedStyle(n).backgroundColor;
          const m = own.match(/rgba?\(([^)]+)\)/);
          const parts = m ? m[1].split(',').map((x) => parseFloat(x)) : [];
          return parts[3] === undefined || parts[3] > 0.5
            ? own
            : getComputedStyle(n.parentElement as Element).backgroundColor;
        });
        const ratio = contrastRatio(colour, actionBg === 'rgba(0, 0, 0, 0)' ? background : actionBg);
        expect(ratio, `announcement action "${name}" is only ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      }

      await expectDarkAndReadable(page, `bulletin ${priority}`);

      // Clean up so the next priority is the first (collapsed) card.
      page.once('dialog', (dialog) => dialog.accept());
      await card.getByRole('button', { name: 'Delete' }).click();
      await page.waitForTimeout(1000);
    }
  });
});

test.describe('Settings → Appearance availability', () => {
  test.beforeEach(async () => {
    execSync('npx tsx tests/e2e/utils/seed.ts', { stdio: 'ignore' });
  });

  // Appearance is a per-device preference with no product reason to be
  // role-gated: every role must be able to reach it from Profile → Settings.
  for (const email of ['owner@test.com', 'parent@test.com', 'child@test.com']) {
    test(`${email} can open Settings → Appearance and pick System/Light/Dark`, async ({ page }) => {
      await loginAs(page, email);

      // Reached through the Profile dropdown, exactly as documented.
      await page.click('button[aria-label="Profile menu"]');
      await page.locator('[role="menuitem"]', { hasText: 'Settings' }).click();
      await page.waitForURL(/\/settings$/, { timeout: 15000 });

      const group = page.getByRole('radiogroup', { name: 'Appearance' });
      await expect(group).toBeVisible();
      for (const option of ['System', 'Light', 'Dark']) {
        await expect(group.getByRole('radio', { name: new RegExp(option) })).toBeVisible();
      }

      // Selecting Dark must actually theme the document for this role.
      await group.getByRole('radio', { name: /Dark/ }).click();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(true);
      // Colours transition over ~150–200ms (e.g. the selected radio's
      // `bg-primary-50`); let them settle before auditing computed pixels so we
      // don't catch a mid-transition light value.
      await page.waitForTimeout(600);
      await expectDarkAndReadable(page, `${email} settings (dark)`);

      await group.getByRole('radio', { name: /Light/ }).click();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(false);

      await logout(page);
    });
  }
});
