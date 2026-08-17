import { describe, expect, it } from 'vitest';
import {
  collectClassChunks,
  composite,
  contrastRatio,
  darkPageBackground,
  isTintSurface,
  parseUtility,
  relativeLuminance,
  resolveToken,
  resolveUtility,
  type UtilityRef,
} from './themeTokens';

/**
 * Dark-theme regression scan (static, no browser required).
 *
 * The first version of this check only looked for literal `bg-white` cards, so
 * it passed while the Family Bulletin announcement — painted with the *semantic*
 * tint `bg-amber-50` — stayed a light cream card with near-white text in dark
 * mode. This scan therefore covers **every** colour token used as a surface
 * (warning, success, info, reward, bulletin/announcement, custom tinted cards)
 * and additionally verifies the foreground/background contrast of the labels
 * painted on those surfaces.
 *
 * Two invariants:
 *   1. In dark mode, no tinted surface may stay light.
 *   2. On those surfaces, every semantic/neutral text token must clear WCAG AA.
 *
 * The scan is intentionally source-level so it runs in CI without emulators;
 * `tests/e2e/appearance-dark.spec.ts` performs the equivalent sweep at runtime
 * on real rendered geometry.
 */

/** Max relative luminance still considered a "dark" surface. */
const MAX_DARK_SURFACE_LUMINANCE = 0.25;
/** Min relative luminance still considered a "light" surface (light theme). */
const MIN_LIGHT_SURFACE_LUMINANCE = 0.6;
/** WCAG AA for normal text. */
const MIN_TEXT_CONTRAST = 4.5;

/**
 * Background tokens with no `--color-*` entry, so Tailwind emits no declaration
 * and the element simply shows the surface behind it. These are pre-existing and
 * identical in both themes (`reward-50` tints on Rewards/Funds/QuickActions,
 * `hover:bg-reward-600` on solid action buttons), so they carry no dark-mode
 * contrast risk — the effective surface is the ancestor card, which the checks
 * above already cover. Listed explicitly so a genuine typo in a new colour class
 * cannot hide among them.
 *
 * Note: the success action scale (`success-600`/`700`/`800`/`900`) is now defined
 * in the `@theme` block (see src/index.css) so solid success buttons resolve to a
 * real, accessible colour — `success-600` is therefore no longer unresolved.
 */
const KNOWN_UNRESOLVED_BACKGROUNDS = ['reward-50', 'reward-600'];

const CHUNKS = collectClassChunks();

function utilities(classes: string[]): UtilityRef[] {
  return classes.map(parseUtility).filter((ref): ref is UtilityRef => ref !== null);
}

describe('dark theme — semantic surfaces', () => {
  it('scans a meaningful number of class lists (guards against a broken scanner)', () => {
    expect(CHUNKS.length).toBeGreaterThan(200);
    const surfaces = CHUNKS.flatMap((chunk) => utilities(chunk.classes)).filter(isTintSurface);
    expect(surfaces.length).toBeGreaterThan(100);
  });

  it('no tinted surface (warning / success / info / reward / announcement / custom) stays light in dark mode', () => {
    const backdrop = darkPageBackground();
    const offenders: string[] = [];

    for (const chunk of CHUNKS) {
      for (const surface of utilities(chunk.classes).filter(isTintSurface)) {
        const colour = resolveUtility(surface, 'dark');
        if (!colour) continue; // covered by the "unresolved tokens" test below
        const painted = composite(colour, surface.alpha, backdrop);
        const luminance = relativeLuminance(painted);
        if (luminance >= MAX_DARK_SURFACE_LUMINANCE) {
          offenders.push(
            `${chunk.file}:${chunk.line} — ${surface.className} → rgb(${painted.join(', ')}) luminance ${luminance.toFixed(3)}`,
          );
        }
      }
    }

    expect(
      offenders,
      `light surfaces in dark mode (add a dark value for the token in the \`.dark\` block of src/index.css, or a \`dark:bg-*\` class):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('text painted on tinted surfaces clears WCAG AA in dark mode', () => {
    const backdrop = darkPageBackground();
    const offenders: string[] = [];

    for (const chunk of CHUNKS) {
      const refs = utilities(chunk.classes);
      const surfaces = refs.filter(isTintSurface);
      // Only judge unambiguous chunks: one surface means every text token in the
      // same class list is painted on it.
      if (surfaces.length !== 1) continue;
      const surfaceColour = resolveUtility(surfaces[0], 'dark');
      if (!surfaceColour) continue;
      const painted = composite(surfaceColour, surfaces[0].alpha, backdrop);

      for (const foreground of refs.filter((ref) => ref.kind === 'text')) {
        const colour = resolveUtility(foreground, 'dark');
        if (!colour) continue;
        const ratio = contrastRatio(colour, painted);
        if (ratio < MIN_TEXT_CONTRAST) {
          offenders.push(
            `${chunk.file}:${chunk.line} — ${foreground.className} on ${surfaces[0].className} → ${ratio.toFixed(2)}:1`,
          );
        }
      }
    }

    expect(
      offenders,
      `poor foreground/background contrast in dark mode (lighten the text token inside the \`.dark\` overrides of src/index.css):\n${[...new Set(offenders)].join('\n')}`,
    ).toEqual([]);
  });

  it('every background token used in the app resolves to a real palette value', () => {
    const unresolved = new Set<string>();
    for (const chunk of CHUNKS) {
      for (const surface of utilities(chunk.classes).filter((ref) => ref.kind === 'bg')) {
        if (!resolveUtility(surface, 'light') && !resolveUtility(surface, 'dark')) {
          unresolved.add(surface.token);
        }
      }
    }
    expect(
      [...unresolved].sort(),
      'a background class references a token with no `--color-*` definition (typo, or a missing @theme entry)',
    ).toEqual([...KNOWN_UNRESOLVED_BACKGROUNDS].sort());
  });

  it('keeps the light theme light (the dark remap must not leak)', () => {
    // Spot-check the tokens involved in this regression plus the neutral surface.
    for (const token of ['white', 'amber-50', 'red-50', 'primary-50', 'warning-50', 'green-50']) {
      const colour = resolveToken(token, 'light');
      expect(colour, `light value missing for ${token}`).not.toBeNull();
      expect(
        relativeLuminance(colour as [number, number, number]),
        `${token} is no longer light in the light theme`,
      ).toBeGreaterThan(MIN_LIGHT_SURFACE_LUMINANCE);
    }
    // …and that the same tokens are dark in dark mode.
    for (const token of ['amber-50', 'red-50', 'primary-50', 'warning-50', 'green-50']) {
      const colour = resolveToken(token, 'dark');
      expect(
        relativeLuminance(colour as [number, number, number]),
        `${token} has no dark value`,
      ).toBeLessThan(MAX_DARK_SURFACE_LUMINANCE);
    }
  });
});
