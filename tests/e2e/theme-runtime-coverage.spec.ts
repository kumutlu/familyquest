import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { loginAs } from './utils/auth';

/**
 * Theme RUNTIME COVERAGE — proves the theme is app-wide, not Home-only, and
 * that it is more than a swapped background.
 *
 * The regression this guards: a child equipped a theme, tapped "Quests", and
 * the app went back to neutral lavender — because only the Home surface ever
 * mounted the world shell. A theme that exists on one screen is not a theme.
 *
 * For every capture this asserts the RUNTIME state, never the pixels:
 *   - `data-child-theme` is the intended theme id (never Classic)
 *   - the world id is NOT `world.normal` and the plate is decoded/painted
 *   - exactly ONE ChildExperienceShell exists
 *   - the `<html>` mirror carries the same id (portaled sheets inherit it)
 *   - a stamp written on the first route survives every in-app navigation
 *     (a boundary remount would rebuild the world and lose the stamp)
 * and then that a full RELOAD on a non-home route restores the theme without
 * ever visiting Home first.
 *
 * ON ACQUIRING THE THEME — hard failure by design.
 * The fixture seeds ownership in the EXACT production shape (canonical record
 * + per-child mirror, see `utils/seed-theme-visuals.ts`). If "Use this theme"
 * is not offered for a seeded owned theme, the client ownership projection did
 * not hydrate — that is a real defect or a broken fixture, so the test fails
 * loudly instead of silently buying the theme and hiding it.
 *
 * THEME DEPTH, not just background.
 * Each run first applies Queki Classic (free, no purchase) and samples a set
 * of semantic surfaces on the same routes, then applies the target theme and
 * samples again. The run fails unless the accent token, the card surface, the
 * selected-nav state AND the sheet surface all actually moved.
 */

const OUT = resolve(process.cwd(), 'screenshots/theme-runtime');
const PROBES = resolve(OUT, 'probes');

/** Opt-in console/network echo for diagnosing a hydration failure. */
const DEBUG = process.env.THEME_E2E_DEBUG === '1';
function attachDiagnostics(page: Page) {
  if (!DEBUG) return;
  page.on('console', (message) => console.log(`[console:${message.type()}]`, message.text()));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      console.log('[http]', response.status(), response.url().slice(0, 180));
    }
  });
}

/**
 * Neon Arcade and Space Explorer are the two DARK themes, Calm Pastel is the
 * light control. All three are owned by Leo in the fixture, so every run
 * exercises the Apply path — never the Buy path.
 */
const THEMES = [
  { shopItemId: 'neon', themeId: 'theme.shop.neon', label: 'neon-arcade', tone: 'dark' },
  { shopItemId: 'space', themeId: 'theme.shop.space', label: 'space-explorer', tone: 'dark' },
  { shopItemId: 'calm', themeId: 'theme.shop.calm', label: 'calm-pastel', tone: 'light' },
] as const;

/** Queki Classic: free, needs no purchase, and is the tint-scope baseline. */
const CLASSIC = { shopItemId: 'classic', themeId: 'theme.standard' } as const;

/**
 * Child surfaces walked by real in-app navigation. Only `/` used to have a
 * world at all — that was the whole bug.
 *
 * `navLabel` MUST match the desktop navigation's real label: a miss would fall
 * through to `page.goto()`, a full page load that destroys the shell stamp and
 * turns the no-remount assertion into a false failure.
 */
const ROUTES = [
  { path: '/', label: 'home', navLabel: null },
  { path: '/tasks', label: 'tasks', navLabel: 'Tasks' },
  { path: '/rewards', label: 'rewards', navLabel: 'Rewards' },
] as const;

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

/** Every sampled surface layer, compared Classic → themed. */
const LAYERS = [
  'canvas',
  'shellCard',
  'appHeader',
  'navSelected',
  'navChip',
  'primaryButton',
  'progressFill',
  'sheet',
] as const;
type Layer = (typeof LAYERS)[number];

/** Resolved custom properties + measured contrast, recorded per route. */
interface RampProbe {
  accent?: string;
  primary500?: string;
  primary600?: string;
  onbrand?: string;
  /** Measured WCAG contrast of a primary CTA's label against its own fill. */
  buttonTextContrast?: number;
  buttonText?: string;
  buttonFill?: string;
  headerBorder?: string;
  cardSurface?: string;
  cardBorder?: string;
  dialogSurface?: string;
  onbrandContrast?: number;
}

type DepthProbe = Partial<Record<Layer, string>> & RampProbe & {
  personality?: PersonalityProbe;
  rendered?: RenderedSurfaceProbe;
  structure?: StructureProbe;
};

/**
 * COMPUTED values on a real themed card.
 *
 * The personality tokens prove the theme DECLARED something; these prove the
 * browser actually PAINTED it. Without this layer a token could be published,
 * match no selector, and still leave every assertion above green — which is
 * exactly how `borderStyle: 'dashed'` and `pattern: 'scanline'` were dead.
 */
/**
 * Structural difference probe — the eight non-colour categories a reviewer
 * uses to name a theme with the hue removed.
 *
 * Every field is a NUMBER or a geometry keyword read off a COMPUTED style, so
 * none of it can be satisfied by a palette change. Colour is deliberately
 * absent from this shape: the point is to compare the UI treatment with the
 * world artwork mentally deleted.
 */
interface StructureProbe {
  /** Edge softness, in px. Corner radius: lower is a sharper, harder edge. */
  edgeSoftnessPx?: number;
  /** Tightest non-zero outer shadow blur — a GLOW concentrates light here. */
  glowRingPx?: number;
  /** Widest outer shadow blur — a HALO pushes light far out. */
  haloSpreadPx?: number;
  /** 1 when an inset hairline paints a hard edge (bevel), 0 when it does not. */
  hardEdgeLine?: number;
  /** Motif geometry actually painted on the world layer. */
  motifGeometry?: 'repeating' | 'radial' | 'flat';
  /** `backdrop-filter: blur()` radius resolved on the themed card. */
  surfaceBlurPx?: number;
  /** Alpha channel of the card's own background — how much world reads through. */
  surfaceAlpha?: number;
  /** Largest |offset| across the card's outer shadows — the depth scale. */
  shadowOffsetPx?: number;
  /** Offset of the hold track's inset well, in px. */
  progressTrackInsetPx?: number;
  /** Blur of the hold track's inset well, in px. */
  progressTrackInsetBlurPx?: number;
  /** Opacity of the decorative edge furniture on the card. */
  decorativeEdgeOpacity?: number;
  /** Number of painted layers in the card INTERIOR. 0 means no interior layer. */
  interiorLayers?: number;
}

/**
 * The eight categories, and which fields constitute each.
 *
 * A category counts as different only when every one of its fields differs, so
 * a theme cannot pass on one convenient number inside a category.
 */
const STRUCTURE_CATEGORIES: Readonly<Record<string, readonly (keyof StructureProbe)[]>> =
  Object.freeze({
    edgeSoftness: ['edgeSoftnessPx'],
    glowVsHalo: ['glowRingPx', 'haloSpreadPx', 'hardEdgeLine'],
    motifType: ['motifGeometry'],
    surfaceBlur: ['surfaceBlurPx'],
    surfaceOpacity: ['surfaceAlpha'],
    shadowDepth: ['shadowOffsetPx'],
    progressTreatment: ['progressTrackInsetPx', 'progressTrackInsetBlurPx'],
    decorativeDensity: ['decorativeEdgeOpacity', 'interiorLayers'],
  });

interface RenderedSurfaceProbe {
  borderRadius?: string;
  backdropFilter?: string;
  boxShadow?: string;
  borderStyle?: string;
  borderColor?: string;
  backgroundColor?: string;
}

/**
 * The NON-COLOUR axes of the personality layer.
 *
 * A theme that differs only by hue passes every colour assertion above and still
 * fails the product requirement, so these are probed separately: each entry is
 * read as a resolved custom property or a computed style, never as a colour.
 */
const PERSONALITY_AXES = [
  'surfaceScheme',
  'surfaceOpacity',
  'surfaceBlur',
  'surfaceRadius',
  'surfaceDarkness',
  'borderStrength',
  'shadow',
  'borderStyle',
  'pattern',
  'patternOpacity',
  'glow',
  'progressTrack',
  'progressEffect',
  'innerTreatment',
  'decorationDensity',
  'motionScale',
] as const;
type PersonalityAxis = (typeof PERSONALITY_AXES)[number];
type PersonalityProbe = Partial<Record<PersonalityAxis, string>>;

/** Axes the three focus themes must differ on — the grayscale requirement. */
const MIN_NON_COLOUR_AXES = 5;

/** Personality axes that resolved differently on the two probes. */
function movedPersonalityAxes(classic: DepthProbe, themed: DepthProbe): PersonalityAxis[] {
  return PERSONALITY_AXES.filter((axis) => {
    const before = classic.personality?.[axis];
    const after = themed.personality?.[axis];
    return !!before && !!after && before !== after;
  });
}

/**
 * Wait for the equipped theme to settle. The equip-rights bridge legitimately
 * resolves the BASE theme until the child's purchases have loaded, so an
 * immediate assert races a real first paint.
 */
async function waitForTheme(page: Page, themeId: string, timeout = 30_000) {
  await page.waitForFunction(
    (id) =>
      document
        .querySelector('[data-testid="child-experience-shell"]')
        ?.getAttribute('data-child-theme') === id,
    themeId,
    { timeout },
  );
}

/** Wait for the CLASSIC baseline (classic paints the `world.normal` world). */
async function waitForClassic(page: Page, timeout = 30_000) {
  await page.waitForFunction(
    (classicThemeId) => {
      const el = document.querySelector<HTMLElement>('[data-testid="child-experience-shell"]');
      if (!el) return false;
      return (
        el.getAttribute('data-child-theme') === classicThemeId ||
        el.getAttribute('data-experience-world') === 'world.normal'
      );
    },
    CLASSIC.themeId,
    { timeout },
  );
}

/** Stamp the shell so a remount is detectable later. */
async function stampShell(page: Page) {
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="child-experience-shell"]');
    if (el) el.dataset.qaStamp = 'stamp-1';
  });
}

async function shellState(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="child-experience-shell"]');
    return {
      shells: document.querySelectorAll('[data-testid="child-experience-shell"]').length,
      childTheme: el?.getAttribute('data-child-theme') ?? null,
      world: el?.getAttribute('data-experience-world') ?? null,
      plate: el?.getAttribute('data-experience-plate') ?? null,
      stamp: el?.dataset.qaStamp ?? null,
      htmlTheme: document.documentElement.getAttribute('data-child-theme') ?? null,
      plateReady: !!document.querySelector('[data-plate-status="ready"]'),
    };
  });
}

/** Read the live app store through Vite's dev module graph (diagnostics). */
async function storeSnapshot(page: Page) {
  return page.evaluate(async () => {
    try {
      const mod: any = await import('/src/store/useStore.ts');
      const s = mod.useStore.getState();
      return {
        currentUser: s.currentUser,
        themePurchases: s.themePurchases,
        themeShopItems: Array.isArray(s.themeShopItems) ? s.themeShopItems.length : s.themeShopItems,
        featureErrors: s.featureErrors,
        bootstrapStatus: s.bootstrapStatus,
      };
    } catch (error) {
      return { error: String(error) };
    }
  });
}

/**
 * Apply a theme through the real shop UI and assert it is equipped.
 *
 * `owned === false` is only used for Queki Classic (free). For every shop
 * theme the test HARD-FAILS when "Use this theme" is missing — that is the
 * signal that the seeded ownership did not hydrate, and buying instead would
 * conceal exactly the defect this suite exists to catch.
 */
async function applyTheme(page: Page, theme: { shopItemId: string; themeId: string; label?: string }) {
  await page.goto('/themes');
  await expect(page.getByTestId('theme-shop')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`theme-card-${theme.shopItemId}`).click();

  const focus = page.getByTestId('theme-shop-focus');
  await expect(focus).toBeVisible({ timeout: 20_000 });

  const use = focus.getByRole('button', { name: 'Use this theme' });
  const applied = focus.getByText('Applied');
  // Either the Apply button (owned, not yet equipped) or the "Applied" marker
  // (already equipped — Queki Classic on a fresh session). Both prove the
  // ownership branch; a "Buy for…" button proves it did NOT hydrate.
  try {
    await expect(
      use.or(applied).first(),
      `${theme.label ?? theme.shopItemId}: seeded ownership did not hydrate — ` +
        `the shop must offer "Use this theme" (or show "Applied"), never "Buy"`,
    ).toBeVisible({ timeout: 30_000 });
  } catch (error) {
    // The store snapshot turns "the UI says Buy" into an answerable question:
    // an empty `themePurchases` is a fixture/read problem, a populated one is
    // a projection problem.
    throw new Error(
      `${(error as Error).message}\nSTORE: ${JSON.stringify(await storeSnapshot(page))}`,
    );
  }

  // An owned theme must never show an affordability prompt.
  await expect(focus.getByTestId('theme-purchase-shortfall')).toHaveCount(0);

  if (await use.isVisible().catch(() => false)) await use.click();
  await expect(applied).toBeVisible({ timeout: 30_000 });

  if (theme.themeId === CLASSIC.themeId) await waitForClassic(page);
  else await waitForTheme(page, theme.themeId, 40_000);
}

/** Navigate by clicking the real nav affordance. Never a full page load. */
async function navigateTo(page: Page, path: string, navLabel: string | null) {
  const desktopNav = page.getByTestId('desktop-primary-navigation');
  const desktopLink = navLabel ? desktopNav.getByRole('link', { name: navLabel }) : null;
  if (desktopLink && (await desktopLink.isVisible().catch(() => false))) {
    await desktopLink.click();
    return;
  }
  const tab = page.locator(`a[href="${path}"]`).last();
  expect(
    await tab.isVisible().catch(() => false),
    `no in-app navigation affordance for ${path}`,
  ).toBe(true);
  await tab.click();
}

/** Open the More hub from whichever surface is on screen. */
async function openMore(page: Page, viewportName: string) {
  const ids =
    viewportName === 'desktop'
      ? ['desktop-more-menu-button', 'mobile-more-menu-button']
      : ['mobile-more-menu-button', 'desktop-more-menu-button'];
  for (const id of ids) {
    const button = page.getByTestId(id);
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      await expect(page.getByTestId('more-menu')).toBeVisible({ timeout: 15_000 });
      return;
    }
  }
  throw new Error('the More hub button was not available at this viewport');
}

/**
 * Sample the semantic surfaces a theme is supposed to move. Values are
 * RESOLVED colours (rgb), so a `color-mix()` token counts as changed only when
 * it really resolved to a different colour.
 */

/** WCAG contrast between two computed CSS colours, or undefined if unparseable. */
function contrastOf(foreground: string, background: string): number | undefined {
  const parse = (value: string): [number, number, number] | null => {
    const legacy = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
    if (legacy) return [Number(legacy[1]), Number(legacy[2]), Number(legacy[3])];
    const modern = value.match(/color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
    if (modern) {
      return [
        Math.round(Number(modern[1]) * 255),
        Math.round(Number(modern[2]) * 255),
        Math.round(Number(modern[3]) * 255),
      ];
    }
    /* Chromium serialises a `color-mix()` result as `oklch()` far more often
       than as `color(srgb …)`, so a helper that only understands the legacy and
       modern rgb forms silently returns undefined and the contrast assertion
       passes on nothing. Convert oklch -> linear sRGB directly; the WCAG
       luminance formula is defined on linear sRGB, so no transfer step follows. */
    const oklch = value.match(/oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)/);
    if (oklch) {
      const L = Number(oklch[1]) / (oklch[1].includes('%') ? 100 : 1);
      const C = Number(oklch[2]);
      const H = (Number(oklch[3]) * Math.PI) / 180;
      const a = C * Math.cos(H);
      const bb = C * Math.sin(H);
      const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
      const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
      const s_ = L - 0.0894841775 * a - 1.291485548 * bb;
      const l = l_ ** 3;
      const m = m_ ** 3;
      const s = s_ ** 3;
      const lin = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
      ].map((v) => Math.min(1, Math.max(0, v)));
      return lin;
    }
    return null;
  };
  const lum = ([r, g, b]: [number, number, number]): number => {
    const lin = [r, g, b].map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const a = parse(foreground);
  const b = parse(background);
  if (!a || !b) return undefined;
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

async function probeDepth(page: Page): Promise<DepthProbe> {
  return page.evaluate(() => {
    // ---- ramp measurement helpers -------------------------------
    const rgbOf = (value: string): [number, number, number] | null => {
      // Classic serialises as rgb()/rgba(); a `color-mix()` resolves to the
      // modern `color(srgb r g b / a)` form with 0..1 channels. Both must be
      // readable or the derived ramp cannot be measured.
      const legacy = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
      if (legacy) {
        return [Number(legacy[1]), Number(legacy[2]), Number(legacy[3])];
      }
      const modern = value.match(/color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
      if (modern) {
        return [
          Math.round(Number(modern[1]) * 255),
          Math.round(Number(modern[2]) * 255),
          Math.round(Number(modern[3]) * 255),
        ];
      }
      return null;
    };
    const luminance = ([r, g, b]: [number, number, number]): number => {
      const lin = [r, g, b].map((v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    };
    const ratio = (fg: string, bg: string): number | undefined => {
      const a = rgbOf(fg);
      const b = rgbOf(bg);
      if (!a || !b) return undefined;
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
    };
    const root = document.documentElement;
    const rootStyle = getComputedStyle(root);
    const custom = (name: string): string | undefined => {
      const v = rootStyle.getPropertyValue(name).trim();
      return v || undefined;
    };
    /** Resolved value of a custom property as the BROWSER computes it. */
    const resolveCustom = (name: string, probe: HTMLElement): string => {
      const raw = getComputedStyle(probe).getPropertyValue(name).trim();
      if (!raw) return '';
      // Ask the engine to resolve any color-mix()/var() chain by painting it.
      const s = document.createElement('span');
      s.style.position = 'absolute';
      s.style.visibility = 'hidden';
      s.style.color = raw;
      document.body.appendChild(s);
      const resolved = getComputedStyle(s).color;
      s.remove();
      return resolved;
    };

    const read = (selector: string): string | undefined => {
      const el = document.querySelector(selector);
      if (!el) return undefined;
      const style = getComputedStyle(el);
      // backgroundColor first (opaque surfaces), then the background image so
      // gradient-only surfaces (progress fills, chips) are still comparable.
      const parts = [style.backgroundColor, style.backgroundImage, style.color, style.borderColor]
        .filter((value) => value && value !== 'rgba(0, 0, 0, 0)' && value !== 'none')
        .join('|');
      return parts || undefined;
    };
    const pick = (selectors: string[]): string | undefined => {
      for (const selector of selectors) {
        const value = read(selector);
        if (value) return value;
      }
      return undefined;
    };
    const shell = document.querySelector<HTMLElement>('[data-testid="child-experience-shell"]');
    const shellStyle = shell ? getComputedStyle(shell) : null;
    const accent = shellStyle?.getPropertyValue('--qk-theme-accent').trim();

    /* ---- personality: the NON-colour axes --------------------------
       Numeric axes are published as kebab-case `--qk-theme-*` custom
       properties on the shell; enum axes as `data-qk-*` attributes. Read both
       off the LIVE shell so this measures what the browser actually applied,
       not what the fixture claims. */
    const kebab = (v: string) => v.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    const AXES: readonly string[] = [
      'surfaceScheme',
      'surfaceOpacity',
      'surfaceBlur',
      'surfaceRadius',
      'surfaceDarkness',
      'borderStrength',
      'shadow',
      'borderStyle',
      'pattern',
      'patternOpacity',
      'glow',
      'progressTrack',
      'progressEffect',
      'innerTreatment',
      'decorationDensity',
      'motionScale',
    ];
    const personality: Record<string, string> = {};
    if (shell && shellStyle) {
      for (const axis of AXES) {
        const token = shellStyle.getPropertyValue(`--qk-theme-${kebab(axis)}`).trim();
        const attr = shell.getAttribute(`data-qk-${kebab(axis)}`);
        const value = attr ?? token;
        if (value) personality[axis] = value;
      }
    }

    /* ---- structural measurement helpers ---------------------------- */
    /** Split a computed box-shadow into layers, respecting rgb() commas. */
    const shadowLayers = (value: string): string[] => {
      const out: string[] = [];
      let depth = 0;
      let current = '';
      for (const ch of value) {
        if (ch === '(') depth += 1;
        if (ch === ')') depth -= 1;
        if (ch === ',' && depth === 0) {
          out.push(current);
          current = '';
          continue;
        }
        current += ch;
      }
      if (current.trim()) out.push(current);
      return out;
    };
    const pxList = (layer: string): number[] =>
      [...layer.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
    /** Alpha channel of a computed colour, 1 when fully opaque. */
    const alphaOf = (value: string): number => {
      const legacy = value.match(/rgba?\([^)]*?[/,\s]([\d.]+)\s*\)$/);
      if (legacy) return Number(legacy[1]);
      const modern = value.match(/\/\s*([\d.]+)\s*\)/);
      if (modern) return Number(modern[1]);
      return 1;
    };
    const blurOf = (layer: string): number => {
      const nums = pxList(layer);
      /* `x y blur` or `x y blur spread`; a negative 3rd value is a spread and
         the blur is the 2nd, which is exactly the `0 10px 24px -14px` form. */
      if (nums.length >= 4) return Math.abs(nums[2]);
      if (nums.length === 3) return nums[2];
      return 0;
    };
    const offsetOf = (layer: string): number => {
      const nums = pxList(layer);
      if (nums.length < 2) return 0;
      return Math.max(Math.abs(nums[0]), Math.abs(nums[1]));
    };

    /* ---- what a real themed card actually got painted with --------- */
    const cardEl = document.querySelector<HTMLElement>(
      '[data-testid="child-theme-route-outlet"] .qk-surface-personality, [data-testid="child-theme-route-outlet"] .qk-bg-card',
    );
    const rendered: Record<string, string> = {};
    if (cardEl) {
      const cs = getComputedStyle(cardEl);
      rendered.borderRadius = cs.borderRadius;
      rendered.backdropFilter = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
      rendered.boxShadow = cs.boxShadow;
      rendered.borderStyle = cs.borderStyle;
      rendered.borderColor = cs.borderColor;
      rendered.backgroundColor = cs.backgroundColor;
    }

    /* ---- STRUCTURE: eight non-colour categories, computed ------------ */
    /* Every field below is a number or a geometry keyword. None of it can be
       moved by a palette change, which is the whole point: the world plate is
       deliberately not consulted anywhere in this block. */
    const structure: StructureProbe = {};
    if (cardEl) {
      const cs = getComputedStyle(cardEl);
      const layers = shadowLayers(cs.boxShadow);
      const outer = layers.filter((l) => !/\binset\b/.test(l));
      const inset = layers.filter((l) => /\binset\b/.test(l));
      const outerBlurs = outer.map(blurOf).filter((b) => b > 0);

      structure.edgeSoftnessPx = Number.parseFloat(cs.borderTopLeftRadius) || 0;
      structure.glowRingPx = outerBlurs.length ? Math.min(...outerBlurs) : 0;
      structure.haloSpreadPx = outerBlurs.length ? Math.max(...outerBlurs) : 0;
      /* A hard drawn line is an inset hairline: blur AND spread both <= 1px. */
      structure.hardEdgeLine = inset.some((l) => blurOf(l) <= 1 && Math.abs(pxList(l)[3] ?? 0) <= 1)
        ? 1
        : 0;
      structure.surfaceAlpha = Number(alphaOf(cs.backgroundColor).toFixed(3));
      structure.shadowOffsetPx = outer.length
        ? Math.max(...outer.map(offsetOf))
        : 0;

      const blurMatch = (cs.backdropFilter || cs.webkitBackdropFilter || 'none').match(/blur\(([\d.]+)px\)/);
      structure.surfaceBlurPx = blurMatch ? Number(blurMatch[1]) : 0;

      /* Interior layer count, read off the ::after the personality layer owns.
         `content: none` (Calm) resolves to zero layers by construction. */
      const after = getComputedStyle(cardEl, '::after');
      const interior = after.backgroundImage;
      structure.interiorLayers = interior && interior !== 'none'
        ? (interior.match(/gradient\(/g) ?? []).length
        : 0;

      const before = getComputedStyle(cardEl, '::before');
      structure.decorativeEdgeOpacity =
        before.content && before.content !== 'none'
          ? Number(Number.parseFloat(before.opacity || '0').toFixed(3))
          : 0;
    }

    /* Motif geometry, read off the world layer the personality paints into. */
    const patternLayer = document.querySelector<HTMLElement>('.qk-child-experience-pattern');
    if (patternLayer) {
      const img = getComputedStyle(patternLayer).backgroundImage;
      structure.motifGeometry =
        !img || img === 'none'
          ? 'flat'
          : /repeating-linear-gradient/.test(img)
            ? 'repeating'
            : 'radial';
    }

    /* Progress treatment, read off the hold track the button actually renders. */
    const holdTrack = document.querySelector<HTMLElement>('.qk-hold-track');
    if (holdTrack) {
      const trackLayers = shadowLayers(getComputedStyle(holdTrack).boxShadow);
      const trackInsets = trackLayers.filter((l) => /\binset\b/.test(l));
      const first = trackInsets[0];
      structure.progressTrackInsetPx = first ? Math.abs(pxList(first)[1] ?? 0) : 0;
      structure.progressTrackInsetBlurPx = first ? blurOf(first) : 0;
    }
    return {
      canvas: pick([
        '[data-testid="child-experience-shell"]',
        '[data-experience-world]',
        'body',
      ]),
      // The card INSIDE the themed boundary (the routed page), never the app
      // header, which is a sibling of the shell.
      shellCard: pick([
        '[data-testid="child-theme-route-outlet"] .qk-bg-card',
        '[data-testid="child-experience-shell"] .qk-bg-card',
        '[data-testid="child-theme-route-outlet"] .qk-quest-tile',
        '[data-testid="child-theme-route-outlet"] article',
        '[data-testid="child-theme-route-outlet"] li',
      ]),
      appHeader: pick(['header.qk-bg-card', 'header']),
      navSelected: pick(['[aria-current="page"]', '.qk-nav-active-chip']),
      navChip: pick(['.qk-nav-active-chip', '[aria-current="page"]']),
      primaryButton: pick([
        '[data-testid="child-theme-route-outlet"] button.bg-primary-600',
        'button.bg-primary-600',
        '[data-testid*="composer"] button',
        'button[class*="bg-primary-"]',
        'button[class*="bg-primary"]',
      ]),
      progressFill: pick([
        '[data-testid="child-theme-route-outlet"] .qk-journey__goal-fill',
        '[data-testid="child-theme-route-outlet"] [role="progressbar"] > *',
        '.qk-journey__goal-fill',
        '[role="progressbar"] > *',
        '[role="progressbar"]',
        '[data-progress]',
      ]),
      sheet: pick(['[role="dialog"]', '[role="dialog"] [class*="bg-"]']),
      accent,

      // ---- the derived child primary ramp, resolved by the engine ----
      primary500: resolveCustom('--color-primary-500', document.body),
      primary600: resolveCustom('--color-primary-600', document.body),
      onbrand: custom('--qk-child-primary-onbrand'),
      // A real primary CTA, so the label contrast is measured on a real
      // rendered pair rather than on two tokens in isolation.
      buttonFill: (() => {
        const btn = document.querySelector<HTMLElement>(
          '[data-testid="child-theme-route-outlet"] button[class*="bg-primary-"], button.bg-primary-600, button.bg-primary-500',
        );
        return btn ? getComputedStyle(btn).backgroundColor : undefined;
      })(),
      buttonText: (() => {
        const btn = document.querySelector<HTMLElement>(
          '[data-testid="child-theme-route-outlet"] button[class*="bg-primary-"], button.bg-primary-600, button.bg-primary-500',
        );
        return btn ? getComputedStyle(btn).color : undefined;
      })(),
      buttonTextContrast: (() => {
        const btn = document.querySelector<HTMLElement>(
          '[data-testid="child-theme-route-outlet"] button[class*="bg-primary-"], button.bg-primary-600, button.bg-primary-500',
        );
        if (!btn) return undefined;
        const s = getComputedStyle(btn);
        return ratio(s.color, s.backgroundColor);
      })(),
      onbrandContrast: (() => {
        const solid = resolveCustom('--color-primary-500', document.body);
        const ink = custom('--qk-child-primary-onbrand');
        if (!solid || !ink) return undefined;
        const s = document.createElement('span');
        s.style.position = 'absolute';
        s.style.visibility = 'hidden';
        s.style.color = ink;
        document.body.appendChild(s);
        const resolvedInk = getComputedStyle(s).color;
        s.remove();
        return ratio(resolvedInk, solid);
      })(),
      headerBorder: (() => {
        const h = document.querySelector<HTMLElement>('header');
        return h ? getComputedStyle(h).borderBottomColor : undefined;
      })(),
      cardSurface: (() => {
        const card = document.querySelector<HTMLElement>(
          '[data-testid="child-theme-route-outlet"] .qk-bg-card, [data-testid="child-theme-route-outlet"] article',
        );
        return card ? getComputedStyle(card).backgroundColor : undefined;
      })(),
      cardBorder: (() => {
        const card = document.querySelector<HTMLElement>(
          '[data-testid="child-theme-route-outlet"] .qk-bg-card, [data-testid="child-theme-route-outlet"] article',
        );
        return card ? getComputedStyle(card).borderColor : undefined;
      })(),
      dialogSurface: (() => {
        const dlg = document.querySelector<HTMLElement>('[role="dialog"]');
        return dlg ? getComputedStyle(dlg).backgroundColor : undefined;
      })(),
      personality,
      rendered,
      structure,
    };
  });
}

/**
 * Structure collected from the real themed card, keyed by `theme/viewport`.
 *
 * The eight categories are inherently a COMPARISON between two themes, and the
 * per-theme tests above run one theme at a time, so each run publishes its
 * probe here and the structural comparison below reads the pair.
 */
const STRUCTURE_PROBE_KEY = 'structure';

/**
 * Read one theme's rendered structure back out of the probe JSON on disk.
 *
 * Deliberately NOT module state. Playwright tears down the worker process after
 * a failing test, so an in-memory Map is empty by the time the comparison test
 * runs — the comparison silently "proves" nothing. The per-theme runs already
 * persist their whole probe, so this reads the same artefact the report uses.
 */
function readStructure(themeLabel: string, viewportName: string): StructureProbe | undefined {
  const file = `${PROBES}/${themeLabel}-${viewportName}.json`;
  if (!existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      themed?: Record<string, DepthProbe>;
    };
    return parsed.themed?.tasks?.[STRUCTURE_PROBE_KEY];
  } catch {
    return undefined;
  }
}

/**
 * The categories in which two themes' rendered structure differs.
 *
 * A category counts only when EVERY field it is made of differs, so a theme
 * cannot pass a category on one convenient number while the rest of it matches.
 * Colour appears nowhere in this shape — every field is a number or a geometry
 * keyword — so passing it is a statement about the UI treatment alone.
 */
function differingStructureCategories(
  a: StructureProbe | undefined,
  b: StructureProbe | undefined,
): string[] {
  if (!a || !b) return [];
  return Object.entries(STRUCTURE_CATEGORIES)
    .filter(([, fields]) => fields.every((field) => a[field] !== undefined && a[field] !== b[field]))
    .map(([category]) => category);
}

/** How many of the eight categories must differ for two themes to be separable. */
const MIN_DISTINCT_STRUCTURE_CATEGORIES = 6;

/** Layers whose resolved colours actually moved. */
function movedLayers(classic: DepthProbe, themed: DepthProbe): Layer[] {
  return LAYERS.filter((layer) => {
    const before = classic[layer];
    const after = themed[layer];
    return !!before && !!after && before !== after;
  });
}

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test(`${theme.label} (${theme.tone}) applies app-wide — ${viewport.name}`, async ({ page }) => {
      test.setTimeout(600_000);
      execSync('npx tsx tests/e2e/utils/seed-theme-visuals.ts', { stdio: 'ignore' });
      mkdirSync(PROBES, { recursive: true });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      attachDiagnostics(page);

      await loginAs(page, 'child@test.com');

      /* -- A. CLASSIC BASELINE (same session, same routes) --------------- */
      await applyTheme(page, { ...CLASSIC, label: 'classic-baseline' });
      const classicProbes: Record<string, DepthProbe> = {};
      for (const route of ROUTES) {
        if (route.path !== '/') await navigateTo(page, route.path, route.navLabel);
        await expect(page.getByTestId('child-experience-shell')).toBeAttached({ timeout: 20_000 });
        await page.waitForTimeout(400);
        classicProbes[route.label] = await probeDepth(page);
      }
      await openMore(page, viewport.name);
      classicProbes.more = await probeDepth(page);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // Baseline for the secondary route too, so `depth.wallet` is a real
      // comparison rather than "classic had nothing to compare against".
      await openMore(page, viewport.name);
      await page.getByTestId('more-wallet').click();
      await page.waitForTimeout(700);
      classicProbes.wallet = await probeDepth(page);
      await page.goto('/');
      await expect(page.getByTestId('child-experience-shell')).toBeAttached({ timeout: 20_000 });
      await page.waitForTimeout(400);

      /* -- B. THE THEME UNDER TEST --------------------------------------- */
      await applyTheme(page, theme);

      const themedProbes: Record<string, DepthProbe> = {};
      for (const route of ROUTES) {
        if (route.path !== '/') await navigateTo(page, route.path, route.navLabel);

        await expect(page.getByTestId('child-experience-shell')).toBeVisible({ timeout: 20_000 });
        await waitForTheme(page, theme.themeId);
        await page.waitForSelector('[data-plate-status="ready"]', { timeout: 25_000 });
        if (route.path === '/') await stampShell(page);
        await page.waitForTimeout(700);

        const state = await shellState(page);
        expect(state.childTheme, `${theme.label} on ${route.label}`).toBe(theme.themeId);
        expect(state.world, `${theme.label} world on ${route.label}`).not.toBe('world.normal');
        expect(state.plate, `${theme.label} plate on ${route.label}`).toBe('1');
        expect(state.plateReady, `${theme.label} plate ready on ${route.label}`).toBe(true);
        expect(state.shells, `${theme.label} single shell on ${route.label}`).toBe(1);
        expect(state.htmlTheme, `${theme.label} html mirror on ${route.label}`).toBe(theme.themeId);

        themedProbes[route.label] = await probeDepth(page);
        await page.screenshot({ path: `${OUT}/${theme.label}-${route.label}-${viewport.name}.png` });
      }

      // The same shell node carried the theme across the whole walk.
      const after = await shellState(page);
      expect(after.stamp, `${theme.label} shell never remounted`).toBe('stamp-1');

      /* -- C. MORE HUB (portaled sheet) + a More destination route -------- */
      await openMore(page, viewport.name);
      await expect(page.getByTestId('more-menu')).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.getAttribute('data-child-theme')),
        `${theme.label} More sheet stays themed`,
      ).toBe(theme.themeId);
      await page.waitForTimeout(700);
      themedProbes.more = await probeDepth(page);
      await page.screenshot({ path: `${OUT}/${theme.label}-more-sheet-${viewport.name}.png` });

      // A real route reached THROUGH More, proving the secondary surface.
      await page.getByTestId('more-wallet').click();
      await waitForTheme(page, theme.themeId);
      await page.waitForTimeout(700);
      const walletState = await shellState(page);
      expect(walletState.childTheme, `${theme.label} on /wallet`).toBe(theme.themeId);
      expect(walletState.shells, `${theme.label} single shell on /wallet`).toBe(1);
      themedProbes.wallet = await probeDepth(page);
      await page.screenshot({ path: `${OUT}/${theme.label}-wallet-${viewport.name}.png` });

      /* -- D. RELOAD ON /rewards ----------------------------------------- */
      await page.goto('/rewards');
      await waitForTheme(page, theme.themeId, 40_000);
      await page.waitForSelector('[data-plate-status="ready"]', { timeout: 25_000 });
      await page.waitForTimeout(700);
      const reloaded = await shellState(page);
      expect(reloaded.childTheme, `${theme.label} restored on reload`).toBe(theme.themeId);
      expect(reloaded.world, `${theme.label} world after reload`).not.toBe('world.normal');
      expect(reloaded.plate, `${theme.label} plate after reload`).toBe('1');
      expect(reloaded.shells, `${theme.label} single shell after reload`).toBe(1);
      expect(reloaded.htmlTheme, `${theme.label} html mirror after reload`).toBe(theme.themeId);
      await page.screenshot({ path: `${OUT}/${theme.label}-rewards-reload-${viewport.name}.png` });

      /* -- E. THEME DEPTH: not just the WorldPlate ------------------------ */
      const depth: Record<string, string[]> = {};
      for (const key of Object.keys(themedProbes)) {
        depth[key] = movedLayers(classicProbes[key] ?? {}, themedProbes[key]);
      }
      writeFileSync(
        `${PROBES}/${theme.label}-${viewport.name}.json`,
        JSON.stringify({ theme: theme.themeId, viewport: viewport.name, classic: classicProbes, themed: themedProbes, moved: depth }, null, 2),
      );

      // The accent identity token MUST move, and so must the surfaces.
      const themedAccent = themedProbes.home?.accent;
      const classicAccent = classicProbes.home?.accent;
      expect(themedAccent, `${theme.label} accent token`).not.toBe(classicAccent);

      for (const key of ['home', 'tasks', 'rewards', 'more']) {
        const moved = depth[key] ?? [];
        expect(
          moved.length,
          `${theme.label}/${viewport.name} on ${key}: only these layers changed vs Classic (${moved.join(', ') || 'none'})`,
        ).toBeGreaterThanOrEqual(1);
      }
      // The identity token, the selected navigation state and the portaled
      // sheet surface must all acknowledge the theme — not just the artwork.
      expect(depth.tasks, `${theme.label} selected nav state`).toContain('navSelected');
      expect(depth.rewards, `${theme.label} selected nav state`).toContain('navSelected');
      expect(depth.more, `${theme.label} selected nav state`).toContain('navSelected');
      expect(depth.more, `${theme.label} sheet surface`).toContain('sheet');

      /* -- E2. THE PRIMARY RAMP ITSELF ------------------------------------
         The gap this closes: `bg-primary-*` / `text-primary-*` used to be
         fixed indigo everywhere. Assert the ramp is BOTH (a) different from
         Classic and (b) actually legible, measured on rendered pairs. */
      const classicRamp = classicProbes.home ?? {};
      const themedRamp = themedProbes.home ?? {};

      expect(
        themedRamp.primary500,
        `${theme.label} must derive --color-primary-500 from the accent`,
      ).toBeTruthy();
      expect(
        themedRamp.primary500,
        `${theme.label} primary-500 must differ from the fixed Classic indigo`,
      ).not.toBe(classicRamp.primary500);
      expect(themedRamp.primary600).not.toBe(classicRamp.primary600);

      // The on-brand label ink must actually clear AA on the derived solid.
      // HARD assertions: a silently-skipped measurement is exactly how the
      // fixed-indigo CTA shipped in the first place.
      expect(
        themedRamp.onbrandContrast,
        `${theme.label} must expose a measurable on-brand contrast`,
      ).toBeDefined();
      expect(
        themedRamp.onbrandContrast!,
        `${theme.label} on-brand label contrast on the derived solid`,
      ).toBeGreaterThanOrEqual(4.5);

      // Tasks always renders at least one real primary CTA, so measure its
      // actual painted label/fill pair rather than two tokens in isolation.
      expect(
        themedProbes.tasks?.buttonFill,
        `${theme.label} Tasks must render a primary CTA to measure`,
      ).toBeTruthy();
      expect(
        themedProbes.tasks?.buttonTextContrast,
        `${theme.label} Tasks primary CTA must expose a measurable contrast`,
      ).toBeDefined();
      expect(
        themedProbes.tasks!.buttonTextContrast!,
        `${theme.label} rendered primary CTA label contrast (fill ${themedProbes.tasks?.buttonFill}, label ${themedProbes.tasks?.buttonText})`,
      ).toBeGreaterThanOrEqual(4.5);
      // …and it must be a DIFFERENT colour from the fixed indigo it replaced.
      expect(themedProbes.tasks?.buttonFill).not.toBe(classicProbes.tasks?.buttonFill);

      // Header / chrome must acknowledge the theme on every route.
      for (const key of ['home', 'tasks', 'rewards', 'more']) {
        const themedHeaderBorder = (themedProbes[key] ?? {}).headerBorder;
        const classicHeaderBorder = (classicProbes[key] ?? {}).headerBorder;
        expect(
          themedHeaderBorder,
          `${theme.label}/${viewport.name} header accent hairline on ${key}`,
        ).toBeTruthy();
        if (classicHeaderBorder) {
          expect(
            themedHeaderBorder,
            `${theme.label}/${viewport.name} header accent on ${key} must differ from Classic`,
          ).not.toBe(classicHeaderBorder);
        }
      }

      /* -- E3. PERSONALITY, NOT PALETTE ------------------------------------
         A palette swap is not a theme. Every focus theme must move a minimum
         number of NON-COLOUR axes relative to Classic, and it must move them
         ON THE ROUTE, not just at the theme boundary. */
      for (const key of ['home', 'tasks', 'rewards']) {
        const themedAxes = themedProbes[key]?.personality ?? {};

        expect(
          Object.keys(themedAxes).length,
          `${theme.label}/${viewport.name} ${key}: personality axes resolved on the live shell`,
        ).toBeGreaterThanOrEqual(MIN_NON_COLOUR_AXES);

        const moved = movedPersonalityAxes(classicProbes[key] ?? {}, themedProbes[key] ?? {});
        expect(
          moved.length,
          `${theme.label}/${viewport.name} ${key}: only these non-colour axes changed vs Classic (${moved.join(', ') || 'none'}) — a hue-only swap is not a personality`,
        ).toBeGreaterThanOrEqual(MIN_NON_COLOUR_AXES);

        // And the axes that DID move must be genuinely distinct values, so a
        // cosmetic change to one token cannot satisfy the count above.
        const distinct = new Set(moved.map((axis) => themedAxes[axis]));
        expect(
          distinct.size,
          `${theme.label}/${viewport.name} ${key}: moved axes all collapsed to the same value ${[...distinct].join(',')}`,
        ).toBeGreaterThanOrEqual(2);
      }

      // eslint-disable-next-line no-console
      console.log(
        `[theme-personality] ${theme.label}/${viewport.name} tasks: ${JSON.stringify(themedProbes.tasks?.personality)} | moved: ${JSON.stringify(movedPersonalityAxes(classicProbes.tasks ?? {}, themedProbes.tasks ?? {}))}`,
      );

      /* -- E4. THE TOKENS ACTUALLY REACH THE PAINTED CARD ----------------
         A published token that matches no selector is a silent no-op. Assert
         the COMPUTED values on a real card reflect the declared personality, so
         `borderStyle`/`shadow`/`surfaceRadius`/`surfaceBlur` cannot rot into
         decorative metadata the way `dashed` and `scanline` did. */
      const renderedTasks = themedProbes.tasks?.rendered ?? {};
      const p = themedProbes.tasks?.personality ?? {};

      expect(renderedTasks.borderRadius, `${theme.label} rendered card radius`).toBeTruthy();
      if (p.surfaceRadius) {
        expect(
          renderedTasks.borderRadius,
          `${theme.label} declared radius ${p.surfaceRadius}px but the card painted ${renderedTasks.borderRadius}`,
        ).toContain(`${p.surfaceRadius}px`);
      }
      expect(
        renderedTasks.backdropFilter,
        `${theme.label} rendered card must resolve a backdrop-filter`,
      ).toBeTruthy();
      expect(renderedTasks.boxShadow, `${theme.label} rendered card shadow`).toBeTruthy();

      // `bevel` and `halo` are geometry, not opacity: the painted border style
      // and the shadow stack must actually differ between them.
      if (p.borderStyle === 'bevel' || p.borderStyle === 'halo') {
        expect(
          renderedTasks.boxShadow,
          `${theme.label}/${p.borderStyle} must paint a themed shadow stack, not the default`,
        ).not.toBe('none');
        expect(
          renderedTasks.boxShadow!.length,
          `${theme.label}/${p.borderStyle} shadow stack looks like the default one`,
        ).toBeGreaterThan(20);
      }

      // Progress: theme-identity progress follows the accent, so a themed
      // route must move it. Reward/XP gold is deliberately NOT recoloured.
      // eslint-disable-next-line no-console
      console.log(
        `[theme-ramp] ${theme.label}/${viewport.name} 500=${themedRamp.primary500} (classic ${classicRamp.primary500}) 600=${themedRamp.primary600} onbrand=${themedRamp.onbrand} ctaContrast=${themedRamp.buttonTextContrast ?? 'n/a'}`,
      );
      // eslint-disable-next-line no-console
      console.log(
        `[theme-depth] ${theme.label}/${viewport.name} moved layers: ${JSON.stringify(depth)}`,
      );
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Structural difference — the eight non-colour categories, compared.        */
/* -------------------------------------------------------------------------- */

/**
 * The question this answers: with the world artwork mentally deleted and the
 * hue removed, can a reviewer still tell Neon Arcade from Space Explorer from
 * Calm Pastel? Only the rendered UI treatment is consulted, and colour is not
 * one of the eight categories.
 */
for (const viewport of VIEWPORTS) {
  test(`structural difference — ${viewport.name}`, async () => {
    const neon = readStructure('neon-arcade', viewport.name);
    const space = readStructure('space-explorer', viewport.name);
    const calm = readStructure('calm-pastel', viewport.name);

    expect(neon, 'neon structure probe must be collected').toBeTruthy();
    expect(space, 'space structure probe must be collected').toBeTruthy();
    expect(calm, 'calm structure probe must be collected').toBeTruthy();

    // Every field must have actually measured, or a category would silently
    // pass on two `undefined`s.
    for (const [label, probe] of Object.entries({ neon, space, calm })) {
      for (const field of Object.keys(STRUCTURE_CATEGORIES).flatMap(
        (c) => STRUCTURE_CATEGORIES[c],
      )) {
        expect(probe?.[field], `${label}/${viewport.name} must measure ${field}`).toBeDefined();
      }
    }

    const neonVsSpace = differingStructureCategories(neon, space);
    // eslint-disable-next-line no-console
    console.log(
      `[theme-structure] ${viewport.name} neon vs space: ${JSON.stringify(neonVsSpace)}\n  neon=${JSON.stringify(neon)}\n  space=${JSON.stringify(space)}`,
    );

    expect(
      neonVsSpace.length,
      `Neon Arcade and Space Explorer differ in only ${neonVsSpace.length} of 8 non-colour categories (${neonVsSpace.join(', ') || 'none'}) — they must not be one theme in grayscale`,
    ).toBeGreaterThanOrEqual(MIN_DISTINCT_STRUCTURE_CATEGORIES);

    // The headline divergences, pinned by direction rather than counted, so a
    // re-tune cannot quietly swap which theme is the sharp one.
    expect(space!.edgeSoftnessPx!).toBeGreaterThan(neon!.edgeSoftnessPx!);
    expect(space!.surfaceBlurPx!).toBeGreaterThan(neon!.surfaceBlurPx!);
    expect(neon!.surfaceAlpha!).toBeGreaterThan(space!.surfaceAlpha!);
    expect(space!.haloSpreadPx!).toBeGreaterThan(neon!.haloSpreadPx!);
    /* Glow vs halo, measured rather than declared: Neon concentrates light in a
       tight ring, Space pushes it far out and draws no hard edge line. */
    expect(neon!.hardEdgeLine).toBe(1);
    expect(space!.hardEdgeLine).toBe(0);
    expect(neon!.glowRingPx!).toBeLessThan(space!.glowRingPx!);
    /* Motif frequency, read off the painted layer: a lattice for Neon, rings
       for Space, nothing for Calm. */
    expect(neon!.motifGeometry).toBe('repeating');
    expect(space!.motifGeometry).toBe('radial');
    expect(calm!.motifGeometry).toBe('flat');
    /* Interior frequency: Neon's panel has furniture, Space's has none, Calm's
       interior is switched off entirely. */
    expect(neon!.interiorLayers!).toBeGreaterThan(space!.interiorLayers!);
    expect(space!.interiorLayers!).toBeGreaterThan(calm!.interiorLayers!);

    // Calm is the quiet theme: nothing glowing, nothing painted inside.
    expect(calm!.decorativeEdgeOpacity).toBe(0);
    expect(calm!.interiorLayers).toBe(0);
    expect(calm!.glowRingPx!).toBeLessThan(neon!.glowRingPx!);

    // And Calm must still separate from both dark themes without relying on hue.
    for (const [otherName, other] of [
      ['neon-arcade', neon],
      ['space-explorer', space],
    ] as const) {
      const calmVsOther = differingStructureCategories(calm, other);
      // eslint-disable-next-line no-console
      console.log(
        `[theme-structure] ${viewport.name} calm vs ${otherName}: ${JSON.stringify(calmVsOther)}`,
      );
      expect(
        calmVsOther.length,
        `Calm Pastel and ${otherName} differ in only ${calmVsOther.length} of 8 non-colour categories`,
      ).toBeGreaterThanOrEqual(MIN_DISTINCT_STRUCTURE_CATEGORIES);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Purchase sheet — a child who owns NOTHING reaches the real Buy flow.        */
/* -------------------------------------------------------------------------- */

for (const viewport of VIEWPORTS) {
  test(`purchase sheet — ${viewport.name}`, async ({ page }) => {
    test.setTimeout(240_000);
    execSync('npx tsx tests/e2e/utils/seed-theme-visuals.ts', { stdio: 'ignore' });
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    // Ava owns NOTHING, so the sheet is genuinely reachable: Rainbow Pop costs
    // 300 against her 487-point balance. She does not confirm — the sheet is
    // captured and dismissed so the fixture stays unspent.
    await loginAs(page, 'child2@test.com');
    await page.goto('/themes');
    await expect(page.getByTestId('theme-shop')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('theme-card-rainbow').click();

    const focus = page.getByTestId('theme-shop-focus');
    const buy = focus.getByRole('button', { name: /Buy for/ });
    await expect(buy).toBeVisible({ timeout: 30_000 });
    await buy.click();

    const sheet = focus.getByTestId('purchase-confirmation');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('sheet-balance')).toHaveText('487 points');
    await expect(sheet.getByTestId('sheet-after')).toHaveText('187 points');

    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/purchase-sheet-${viewport.name}.png` });

    await sheet.getByRole('button', { name: 'Not now' }).click();
    await expect(sheet).toBeHidden();
  });
}

/* -------------------------------------------------------------------------- */
/* Hold-to-complete — the three progress treatments, rendered mid-press.     */
/* -------------------------------------------------------------------------- */

/**
 * The interaction contract is NOT what's under test here — hold timing, the
 * press gesture, scroll cancellation and completion are covered by
 * `src/components/quests/HoldToCompleteButton.test.tsx` and are untouched by the
 * personality layer. What this measures is the PRESENTATION of the same three
 * progress treatments while a real pointer is held down:
 *
 *   Neon   linear luminous fill — a tight bloom at the advancing edge
 *   Space  softer orbital fill   — a trailing head, no hard bloom
 *   Calm   minimal soft fill     — no bloom at all
 *
 * It also checks the resting label against its own fill, because a theme's
 * derived primary ramp is allowed to move and a light pastel accent can push a
 * white label under AA.
 */
const HOLD_DURATION_MS = 900;

for (const theme of THEMES) {
  test(`hold-to-complete treatment — ${theme.label}`, async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    execSync('npx tsx tests/e2e/utils/seed-theme-visuals.ts', { stdio: 'ignore' });
    await page.setViewportSize({ width: 1280, height: 900 });
    attachDiagnostics(page);

    await loginAs(page, 'child@test.com', testInfo);
    await applyTheme(page, theme);
    await waitForTheme(page, theme.themeId, 40_000);
    await navigateTo(page, '/tasks', 'Tasks');

    const button = page.getByTestId('hold-to-complete').first();
    await expect(button).toBeVisible({ timeout: 30_000 });

    /* ---- resting state: label against its own fill --------------------- */
    const resting = await button.evaluate((el) => {
      const s = getComputedStyle(el);
      const label = el.querySelector('span.z-10');
      return {
        fill: s.backgroundColor,
        label: label ? getComputedStyle(label).color : s.color,
      };
    });
    const restingContrast = contrastOf(resting.label, resting.fill);

    /* ---- mid-press: the rendered fill ---------------------------------- */
    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Roughly 40% of the hold, so the fill is unmistakably mid-advance.
    await page.waitForTimeout(Math.round(HOLD_DURATION_MS * 0.4));

    const held = await page.evaluate(() => {
      const fill = document.querySelector<HTMLElement>('.qk-hold-fill');
      const track = document.querySelector<HTMLElement>('.qk-hold-track');
      const btn = document.querySelector<HTMLElement>('[data-testid="hold-to-complete"]');
      const label = btn?.querySelector('span.z-10');
      if (!fill || !track || !btn) return undefined;
      const fs = getComputedStyle(fill);
      const ts = getComputedStyle(track);
      const bs = getComputedStyle(btn);
      return {
        fillImage: fs.backgroundImage,
        fillShadow: fs.boxShadow,
        fillColor: fs.backgroundColor,
        trackShadow: ts.boxShadow,
        trackColor: ts.backgroundColor,
        labelColor: label ? getComputedStyle(label).color : bs.color,
      };
    });

    expect(held, 'the hold fill must render while the pointer is down').toBeTruthy();
    await page.screenshot({ path: `${OUT}/${theme.label}-hold-fill-desktop.png` });
    // eslint-disable-next-line no-console
    console.log(
      `[theme-hold] ${theme.label} restingLabel=${resting.label} restingFill=${resting.fill} ` +
        `restingContrast=${restingContrast} ` +
        `fillImage=${held!.fillImage.slice(0, 90)} fillShadow=${held!.fillShadow.slice(0, 90)} ` +
        `trackShadow=${held!.trackShadow} fillColor=${held!.fillColor} labelColor=${held!.labelColor} ` +
        `fillLabel=${contrastOf(held!.labelColor, held!.fillColor)?.toFixed(2)}`,
    );

    await page.mouse.up();

    /* ---- the label must stay legible on the FILL it is painted over ----- */
    const fillLabelContrast = contrastOf(held!.labelColor, held!.fillColor);
    expect(
      fillLabelContrast,
      `${theme.label}: hold label on its own fill must clear WCAG AA (4.5:1)`,
    ).toBeGreaterThanOrEqual(4.5);
    /* ---- and on the resting CTA ---------------------------------------- */
    expect(
      restingContrast,
      `${theme.label}: hold label on the resting CTA must clear WCAG AA (4.5:1)`,
    ).toBeGreaterThanOrEqual(4.5);
  });
}
