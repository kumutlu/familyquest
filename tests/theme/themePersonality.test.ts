/**
 * Theme personality contract.
 *
 * The theme system was hue + artwork. Hue is the one channel that disappears in
 * grayscale, so "does this theme still read without colour?" had the answer
 * "no". This test is the structural version of that question: it asserts the
 * three art-directed shop themes differ from EACH OTHER and from the neutral
 * baseline on many non-colour dimensions at once, so a future change that
 * flattens personality back to a single tint fails here rather than in a
 * screenshot review.
 *
 * A screenshot cannot be the guard for this. The dimensions being protected are
 * ones a reviewer judges subjectively, and the failure mode is a slow drift
 * toward sameness that no single screenshot makes obvious. The percentages are
 * the contract.
 *
 * It also pins the boundaries:
 *   1. semantic status colours (xp / reward / success / warning / danger /
 *      mint / coral / streak / family) are never assigned by the personality
 *      scope — a "luminous" theme must not recolour a child's earned points;
 *   2. Queki Classic is excluded and keeps the neutral treatment;
 *   3. no component and no CSS rule names a theme, so a sixth theme is a data
 *      change rather than a code change;
 *   4. untrusted theme documents are clamped, not trusted.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_CATALOG, getShopThemeByItemId } from '../../src/domain/experience/fixtures/themes';
import {
  CALM_PERSONALITY,
  NEON_ARCADE_PERSONALITY,
  SPACE_PERSONALITY,
} from '../../src/domain/experience/fixtures/themePersonalities';
import {
  NEUTRAL_PERSONALITY,
  PERSONALITY_ENUM_VALUES,
  validThemePersonality,
  themePersonalityAttributes,
  themePersonalityCustomProperties,
} from '../../src/domain/experience/themePersonality';
import type { ThemePersonality } from '../../src/domain/experience/themePersonality';

function findRepoRoot(from = process.cwd()): string {
  let current = resolve(from);
  for (;;) {
    if (existsSync(join(current, 'src/design/child-experience.css'))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(from);
    current = parent;
  }
}

const REPO_ROOT = findRepoRoot();
const CSS = readFileSync(join(REPO_ROOT, 'src/design/child-experience.css'), 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS_NO_COMMENTS = stripComments(CSS);

/** The personality block only, so a prose mention cannot satisfy a check. */
const PERSONALITY_BLOCK = (() => {
  const marker = CSS.indexOf('THEME PERSONALITY');
  expect(marker, 'child-experience.css must document a THEME PERSONALITY block').toBeGreaterThan(-1);
  return stripComments(CSS.slice(CSS.lastIndexOf('/*', marker)));
})();

const neon = NEON_ARCADE_PERSONALITY as ThemePersonality;
const space = SPACE_PERSONALITY as ThemePersonality;
const calm = CALM_PERSONALITY as ThemePersonality;

/** The non-colour axes a reviewer can actually perceive without hue. */
const GRAYSCALE_AXES = [
  'surfaceScheme',
  'surfaceDarkness',
  'surfaceOpacity',
  'surfaceBlur',
  'surfaceRadius',
  'borderStyle',
  'borderStrength',
  'shadow',
  'glow',
  'pattern',
  'patternOpacity',
  'progressTrack',
  'progressEffect',
  'innerTreatment',
  'decorationDensity',
  'motionScale',
] as const satisfies readonly (keyof ThemePersonality)[];

/** How many differing axes make a theme recognisable rather than merely tinted. */
const MIN_DISTINCT_AXES = 5;

/**
 * Every CSS declaration block in the personality scope whose SELECTOR list
 * mentions `token`.
 *
 * This is what turns the enum-coverage guard from "the string appears somewhere"
 * into "the value is actually rendered". Matching a selector inside a real
 * `{ … }` body means an empty or selector-only rule cannot satisfy it — which
 * is the failure the old guard missed when `dashed` was selected for by
 * attribute PRESENCE rather than by value.
 */
function declarationBodiesFor(token: string): string[] {
  const bodies: string[] = [];
  for (const match of PERSONALITY_BLOCK.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selector, body] = match;
    if (selector.includes(token) && body.trim().length > 0) bodies.push(body);
  }
  return bodies;
}

describe('theme personality — grayscale distinctness', () => {
  it('the three art-directed themes are all attached to the right catalogue entries', () => {
    expect(getShopThemeByItemId('neon')?.personality).toEqual(neon);
    expect(getShopThemeByItemId('space')?.personality).toEqual(space);
    expect(getShopThemeByItemId('calm')?.personality).toEqual(calm);
  });

  it('each art-directed theme differs from the neutral baseline on many axes', () => {
    for (const [name, personality] of [
      ['neon', neon],
      ['space', space],
      ['calm', calm],
    ] as const) {
      const differing = GRAYSCALE_AXES.filter(
        (axis) => personality[axis] !== NEUTRAL_PERSONALITY[axis],
      );
      expect(differing.length, `${name} must differ from Classic's neutral treatment`).toBeGreaterThanOrEqual(
        MIN_DISTINCT_AXES,
      );
    }
  });

  it('Neon, Space and Calm each differ from EVERY OTHER theme', () => {
    const themes = { neon, space, calm };
    for (const [aName, a] of Object.entries(themes)) {
      for (const [bName, b] of Object.entries(themes)) {
        if (aName === bName) continue;
        const differing = GRAYSCALE_AXES.filter((axis) => a[axis] !== b[axis]);
        expect(
          differing.length,
          `${aName} vs ${bName} must differ on a real number of non-colour axes`,
        ).toBeGreaterThanOrEqual(MIN_DISTINCT_AXES);
      }
    }
  });

  it('the axes that carry the most identity are genuinely different per theme', () => {
    /* These four are the ones a grayscale reviewer actually uses to name a
       theme, so they are pinned individually rather than as a count. */
    expect([neon.surfaceScheme, space.surfaceScheme, calm.surfaceScheme]).toEqual([
      'dark',
      'dark',
      'light',
    ]);
    /* Space is deeper than Neon: darker, softer, larger radius, weaker edge. */
    expect(space.surfaceDarkness).toBeGreaterThan(neon.surfaceDarkness);
    expect(space.surfaceRadius).toBeGreaterThan(neon.surfaceRadius);
    expect(space.borderStrength).toBeLessThan(neon.borderStrength);
    expect(space.surfaceBlur).toBeGreaterThan(neon.surfaceBlur);
    /* Neon is crisp and sharp; Space is diffuse; Calm is almost flat. */
    expect(neon.shadow).toBe('lifted');
    expect(space.shadow).toBe('halo');
    expect(calm.shadow).toBe('matte');
    expect(new Set([neon.shadow, space.shadow, calm.shadow]).size).toBe(3);
    /* The edge GEOMETRY must differ, not merely its strength: a hardware bevel
       and a soft halo are not the same border at two opacities. */
    expect(new Set([neon.borderStyle, space.borderStyle, calm.borderStyle]).size).toBe(3);
    expect(neon.borderStyle).toBe('bevel');
    expect(space.borderStyle).toBe('halo');
    /* Frequency separation: Neon must be the tighter, sharper, higher-frequency
       theme and Space the softer, deeper, larger-scale one — on EVERY axis that
       carries form, in the same direction, or they read as one theme in grey. */
    expect(neon.surfaceRadius).toBeLessThan(space.surfaceRadius);
    expect(neon.surfaceBlur).toBeLessThan(space.surfaceBlur);
    expect(neon.surfaceOpacity).toBeGreaterThan(space.surfaceOpacity);
    expect(neon.borderStrength).toBeGreaterThan(space.borderStrength);
    expect(neon.glow).toBeGreaterThan(space.glow);
    expect(neon.decorationDensity).toBeGreaterThan(space.decorationDensity);
    expect(neon.surfaceDarkness).toBeLessThan(space.surfaceDarkness);
    /* Motifs must not be shared, or two themes read as one texture. */
    expect(new Set([neon.pattern, space.pattern, calm.pattern]).size).toBe(3);
    expect(new Set([neon.progressEffect, space.progressEffect, calm.progressEffect]).size).toBe(3);
    expect(new Set([neon.progressTrack, space.progressTrack, calm.progressTrack]).size).toBe(3);
    /* Interior frequency is the axis that closes the last gap. Neon carries hard,
       small, repeated detail; Space carries one wide soft wash and no straight
       interior edge at all; Calm carries nothing. */
    expect(neon.innerTreatment).toBe('machined');
    expect(space.innerTreatment).toBe('atmospheric');
    expect(calm.innerTreatment).toBe('flat');
    expect(new Set([neon.innerTreatment, space.innerTreatment, calm.innerTreatment]).size).toBe(3);
    /* Calm is the quiet theme: no glow, no motif, no decoration, slowest motion. */
    expect(calm.glow).toBe(0);
    expect(calm.decorationDensity).toBe(0);
    expect(calm.motionScale).toBeLessThan(neon.motionScale);
    expect(calm.motionScale).toBeLessThan(space.motionScale);
  });

  it('only shop themes carry a personality — seasonal and weekly dressing stays neutral', () => {
    const nonShop = THEME_CATALOG.filter((theme) => !theme.id.startsWith('theme.shop.'));
    for (const theme of nonShop) {
      expect(theme.personality, `${theme.id} must not carry a personality`).toBeUndefined();
    }
  });

  it('Queki Classic keeps the neutral treatment exactly', () => {
    expect(THEME_CATALOG.find((t) => t.id === 'theme.standard')?.personality).toBeUndefined();
  });
});

describe('theme personality — untrusted input is clamped, not trusted', () => {
  it('rejects a non-object shape', () => {
    expect(validThemePersonality(undefined)).toBeUndefined();
    expect(validThemePersonality('neon')).toBeUndefined();
    expect(validThemePersonality(42)).toBeUndefined();
  });

  it('clamps every numeric axis into its safe range', () => {
    const wild = validThemePersonality({
      surfaceOpacity: 99,
      surfaceDarkness: -5,
      surfaceBlur: 10_000,
      surfaceRadius: -1,
      borderStrength: 900,
      glow: 77,
      patternOpacity: -3,
      decorationDensity: 5,
      motionScale: 42,
    })!;
    expect(wild.surfaceOpacity).toBeLessThanOrEqual(1);
    expect(wild.surfaceDarkness).toBeGreaterThanOrEqual(0);
    expect(wild.surfaceBlur).toBeLessThanOrEqual(32);
    expect(wild.surfaceRadius).toBeGreaterThanOrEqual(0);
    expect(wild.borderStrength).toBeLessThanOrEqual(2);
    expect(wild.glow).toBeLessThanOrEqual(1);
    expect(wild.patternOpacity).toBeGreaterThanOrEqual(0);
    expect(wild.decorationDensity).toBeLessThanOrEqual(1);
    expect(wild.motionScale).toBeLessThanOrEqual(1);
  });

  it('falls back to the neutral value for an unknown enum instead of trusting it', () => {
    const hostile = validThemePersonality({
      pattern: 'url(javascript:alert(1))',
      shadow: 'none; background: red',
      surfaceScheme: 'hacker',
      borderStyle: 'groovy',
      progressTrack: 'x',
      progressEffect: 'y',
      innerTreatment: 'melted',
    })!;
    expect(hostile.pattern).toBe('none');
    expect(hostile.shadow).toBe('soft');
    expect(hostile.surfaceScheme).toBe('inherit');
    expect(hostile.borderStyle).toBe('solid');
    expect(hostile.progressTrack).toBe('soft');
    expect(hostile.progressEffect).toBe('flat');
    expect(hostile.innerTreatment).toBe('flat');
  });

  it('treats NaN as absent rather than propagating it into CSS', () => {
    const weird = validThemePersonality({ glow: Number.NaN, surfaceBlur: Number.POSITIVE_INFINITY })!;
    expect(Number.isFinite(weird.glow)).toBe(true);
    expect(Number.isFinite(weird.surfaceBlur)).toBe(true);
  });

  it('a partial document yields a coherent theme rather than a broken one', () => {
    const partial = validThemePersonality({ pattern: 'orbit' })!;
    expect(partial.pattern).toBe('orbit');
    expect(partial.shadow).toBe(NEUTRAL_PERSONALITY.shadow);
    expect(partial.surfaceOpacity).toBe(NEUTRAL_PERSONALITY.surfaceOpacity);
  });
});

describe('theme personality — emission is safe and complete', () => {
  it('numeric tokens become custom properties and enums become data attributes', () => {
    const properties = themePersonalityCustomProperties(neon);
    const attributes = themePersonalityAttributes(neon);
    expect(properties['--qk-theme-surface-opacity']).toBe('0.86');
    expect(properties['--qk-theme-surface-radius']).toBe('10');
    expect(attributes['data-qk-shadow']).toBe('lifted');
    expect(attributes['data-qk-pattern']).toBe('grid');
    expect(attributes['data-qk-progress-effect']).toBe('luminous');
    expect(attributes['data-qk-surface-scheme']).toBe('dark');
    expect(attributes['data-qk-border-style']).toBe('bevel');
    expect(attributes['data-qk-progress-track']).toBe('deep');
    expect(attributes['data-qk-inner-treatment']).toBe('machined');
  });

  it('emits KEBAB-case attribute names, not camelCase', () => {
    /* Regression guard for a real bug: the emitter produced
       `data-qk-progressEffect` while the CSS selected
       `[data-qk-progress-effect]`. Single-word attributes (shadow, pattern)
       matched by luck; all three multi-word ones silently never applied, so
       the tonal-depth copy flip and both progress treatments were dead. */
    const attributes = themePersonalityAttributes(neon);
    for (const name of Object.keys(attributes)) {
      expect(name, `${name} must be kebab-case`).not.toMatch(/[A-Z]/);
    }
  });

  it('every emitted token is actually consumed by the CSS scope', () => {
    /* The mirror image of the bug above: a token can be emitted correctly and
       still do nothing if the stylesheet never references it. */
    const properties = Object.keys(themePersonalityCustomProperties(neon));
    const attributes = Object.keys(themePersonalityAttributes(neon));
    for (const name of [...properties, ...attributes]) {
      expect(CSS_NO_COMMENTS, `CSS must consume ${name}`).toContain(name);
    }
  });

  it('never emits a value containing a CSS delimiter, so nothing can inject a declaration', () => {
    for (const [name, personality] of Object.entries({ neon, space, calm })) {
      for (const [key, value] of Object.entries({
        ...themePersonalityCustomProperties(personality),
        ...themePersonalityAttributes(personality),
      })) {
        expect(value, `${name}.${key} must be an inert scalar`).toMatch(/^[a-z0-9.-]+$/);
      }
    }
  });

  it('every axis is published on both channels it belongs to', () => {
    const properties = Object.keys(themePersonalityCustomProperties(neon));
    const attributes = Object.keys(themePersonalityAttributes(neon));
    /* Every axis must reach the DOM, or a theme silently loses a dimension. */
    for (const axis of GRAYSCALE_AXES) {
      const kebab = axis.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      const published =
        properties.includes(`--qk-theme-${kebab}`) || attributes.includes(`data-qk-${kebab}`);
      expect(published, `${axis} must be published as a token or an attribute`).toBe(true);
    }
  });
});

describe('theme personality — CSS boundaries', () => {
  it('never paints a semantic status colour from a decorative layer', () => {
    /* The ramp guard's regex cannot see declarations nested inside a
       `@keyframes` body, so check the personality layer's keyframes directly —
       otherwise decoration could repaint something the main guard never sees. */
    const keyframes = [...PERSONALITY_BLOCK.matchAll(/@keyframes\s+([a-z-]+)\s*\{([^}]*)\}/g)];
    expect(keyframes.length, 'the personality layer owns at least one keyframe').toBeGreaterThan(0);
    for (const [, name, body] of keyframes) {
      expect(body, `${name} must animate geometry, not colour`).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(body, `${name} must not assign a status token`).not.toMatch(/--color-(xp|reward|success|warning|danger|mint|coral)/);
    }
  });

  it('never assigns a semantic status colour token', () => {
    const forbidden = [
      '--color-xp-',
      '--color-reward-',
      '--color-success-',
      '--color-warning-',
      '--color-danger-',
      '--color-destructive-',
      '--color-mint-',
      '--color-coral-',
      '--color-streak-',
      '--color-family-',
    ];
    for (const token of forbidden) {
      expect(PERSONALITY_BLOCK, `personality must not assign ${token}`).not.toContain(token);
    }
  });

  it('styles the reward chip gold is unaffected — XP progress keeps its meaning', () => {
    /* `PointsChip` uses `bg-xp-50` / `text-xp-700`, neither of which the
       personality scope may touch. */
    expect(PERSONALITY_BLOCK).not.toContain('--color-xp');
  });

  it('branches in CSS on EVERY enum value, or the axis is decorative', () => {
    /* A member added to an enum type-checks, validates, and then does nothing
       at runtime if the stylesheet never matches it. That is not hypothetical:
       Calm shipped with the neutral placeholder's `soft`/`soft`/`flat` and was
       therefore indistinguishable from Classic on three axes. */
    for (const [axis, values] of Object.entries(PERSONALITY_ENUM_VALUES)) {
      const attribute = `data-qk-${axis.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
      for (const value of values) {
        /* `inherit` is the documented no-op: it means "keep Queki Classic's own
           tonal family", so having no rule for it IS the correct behaviour.
           Every other value must actually change something. */
        if (value === 'inherit') continue;
        const selector = `${attribute}='${value}'`;
        expect(
          PERSONALITY_BLOCK,
          `${axis} = "${value}" has no CSS rule, so choosing it is a no-op`,
        ).toContain(selector);
      }
    }
  });

  it('every enum value RENDERS — a matched selector with no declaration is still a no-op', () => {
    /* The guard above only proves the selector string exists. This one proves a
       value reaches an actual `{ … }` body, which is the difference between
       "borderStyle: dashed selects a rule" and "it selected an empty one".
       Two real bugs are pinned here: `dashed` originally matched on attribute
       PRESENCE, and `scanline` was declared in the type but never painted. */
    for (const [axis, values] of Object.entries(PERSONALITY_ENUM_VALUES)) {
      const attribute = `data-qk-${axis.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
      for (const value of values) {
        if (value === 'inherit') continue;
        const bodies = declarationBodiesFor(`${attribute}='${value}'`);
        expect(bodies.length, `${axis} = "${value}" matches no declaration body`).toBeGreaterThan(0);
        const renders = bodies.some((body) => /:/.test(body) && body.trim().length > 0);
        expect(renders, `${axis} = "${value}" paints nothing`).toBe(true);
      }
    }
  });

  it('the interior treatments render genuinely different geometry, not different alphas', () => {
    /* Frequency, not degree: Neon's interior is built from hard straight layers,
       Space's from a radial falloff, and Calm's is switched off. If someone
       "simplifies" Space's treatment into Neon's at a lower alpha, the two
       themes go back to being one theme in grayscale and this fails. */
    const machined = declarationBodiesFor("data-qk-inner-treatment='machined'").join('\n');
    const atmospheric = declarationBodiesFor("data-qk-inner-treatment='atmospheric'").join('\n');
    const flat = declarationBodiesFor("data-qk-inner-treatment='flat'").join('\n');

    expect(machined).toContain('linear-gradient');
    expect(machined).toContain('background-size');
    expect(machined).not.toContain('radial-gradient');

    expect(atmospheric).toContain('radial-gradient');
    expect(atmospheric).not.toContain('linear-gradient');

    expect(flat).toContain('content: none');
  });

  it('interior decoration paints behind the copy, never on it', () => {
    /* The interior treatment is `z-index: -1` inside an isolated host, so it
       lands between the surface colour and the card text. Without the
       isolation a Calm card (which has no `backdrop-filter` and therefore no
       stacking context) would push the layer behind its own background. */
    const machined = declarationBodiesFor("data-qk-inner-treatment='machined'").join('\n');
    expect(machined).toContain('z-index: -1');
    expect(machined).toContain('pointer-events: none');
    expect(PERSONALITY_BLOCK).toContain('isolation: isolate');
  });

  it('every numeric token is READ by the stylesheet, not merely defined by it', () => {
    /* A published custom property that nothing references is as dead as an
       unmapped enum value — it type-checks, serialises, reaches the DOM and
       does nothing. Requiring a `var(…)` read catches a token whose only
       appearance is its own left-hand-side definition. */
    for (const name of Object.keys(themePersonalityCustomProperties(neon))) {
      expect(CSS_NO_COMMENTS, `CSS must read ${name} through var()`).toContain(`var(${name}`);
    }
  });

  it('names no theme, so a sixth theme needs no CSS', () => {
    for (const name of ['neon', 'space', 'calm', 'rainbow', 'pixel']) {
      expect(PERSONALITY_BLOCK, `CSS must not branch on "${name}"`).not.toContain(`'${name}'`);
    }
    /* Every personality rule keys off a token or a data attribute instead. */
    expect(PERSONALITY_BLOCK).toContain('data-qk-shadow');
    expect(PERSONALITY_BLOCK).toContain('data-qk-pattern');
    expect(PERSONALITY_BLOCK).toContain('data-qk-progress-track');
    expect(PERSONALITY_BLOCK).toContain('data-qk-progress-effect');
  });

  it('keys the tonal depth and copy flip off the same scheme attribute', () => {
    /* Dark surfaces must invert copy in the same rule block, otherwise a theme
       trades "not enough identity" for "unreadable text". */
    expect(PERSONALITY_BLOCK).toContain("data-qk-surface-scheme='dark'");
    const darkBlock = PERSONALITY_BLOCK.slice(
      PERSONALITY_BLOCK.indexOf("data-qk-surface-scheme='dark'"),
    );
    expect(darkBlock.slice(0, 2000)).toContain('--qk-text-primary');
  });

  it('gates all personality motion behind prefers-reduced-motion', () => {
    const start = PERSONALITY_BLOCK.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(start).toBeGreaterThan(-1);
    const reduced = PERSONALITY_BLOCK.slice(start);
    expect(reduced).toContain('.qk-hold-fill');
    expect(reduced).toContain('.qk-surface-personality');
    expect(reduced).toContain('animation: none !important');
  });

  it('every selector inside the reduced-motion block is still child-gated', () => {
    /* The ramp guard's regex cannot see rules nested after an at-rule prelude,
       so it exempts the `@media` prelude and would otherwise skip the first
       nested selector. This closes that blind spot: a personality rule hidden
       inside the motion gate must still be scoped to the child shop theme. */
    const start = PERSONALITY_BLOCK.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(start).toBeGreaterThan(-1);
    const block = PERSONALITY_BLOCK.slice(start);
    const selectors = [...block.matchAll(/([^{}]+?)\{/g)]
      .map((m) => m[1].trim())
      .filter(Boolean);
    expect(selectors.length, 'the motion gate must actually contain rules').toBeGreaterThan(0);
    for (const selector of selectors) {
      for (const part of selector.split(',')) {
        const trimmed = part.trim();
        if (!trimmed || trimmed.startsWith('@')) continue;
        expect(
          trimmed,
          `motion-gate selector "${trimmed}" must be gated on the child theme`,
        ).toContain("data-child-theme^='theme.shop.'");
      }
    }
  });

  it('keeps decorative layers non-interactive and behind content', () => {
    /* A motif or vignette that could swallow a pointer press or a focus ring
       would be an accessibility regression, not decoration. */
    expect(PERSONALITY_BLOCK).toContain('pointer-events: none');
    const vignette = PERSONALITY_BLOCK.slice(PERSONALITY_BLOCK.indexOf('::before'));
    expect(vignette.slice(0, 600)).toContain('pointer-events: none');
  });
});

describe('theme personality — no component branches on a theme', () => {
  const components = [
    'src/components/quests/QuestCards.tsx',
    'src/components/quests/HoldToCompleteButton.tsx',
    'src/components/quests/QuestBoard.tsx',
  ];

  it('the task card, quest board and hold button name no theme', () => {
    /* Checked as a QUOTED literal, not as a bare substring. A bare check is a
       false-positive machine: Tailwind's `space-y-4` utility contains "space",
       so a quest board would fail for using a layout class. What must not
       appear is a theme name used AS a value — in a className, a comparison,
       a lookup or a switch. */
    for (const file of components) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');
      for (const name of ['neon', 'space', 'calm', 'Neon', 'Space', 'Calm']) {
        const quoted = new RegExp(`['"\`]${name}['"\`]`);
        expect(source, `${file} must not use "${name}" as a value`).not.toMatch(quoted);
      }
      /* And never as a catalogue id. */
      for (const id of ['theme.shop.neon', 'theme.shop.space', 'theme.shop.calm']) {
        expect(source, `${file} must not reference ${id}`).not.toContain(id);
      }
    }
  });

  it('the hold button opts into presentation hooks without changing its tone contract', () => {
    const source = readFileSync(join(REPO_ROOT, 'src/components/quests/HoldToCompleteButton.tsx'), 'utf8');
    /* The presentation hooks must not leak into the reward/XP path. */
    expect(source).toContain("tone !== 'xp'");
    expect(source).toContain('qk-hold-track');
    expect(source).toContain('qk-hold-fill');
    /* Timing and gesture logic must remain exactly as it was. */
    expect(source).toContain('QUEKI_MOTION.duration.hold');
    expect(source).toContain('SCROLL_CANCEL_DISTANCE_PX');
  });

  it('the task card opts in via one semantic class rather than a per-theme variant', () => {
    const source = readFileSync(join(REPO_ROOT, 'src/components/quests/QuestCards.tsx'), 'utf8');
    expect(source).toContain('qk-surface-personality');
  });
});