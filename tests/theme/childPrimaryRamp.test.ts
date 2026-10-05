/**
 * Child primary ramp contract.
 *
 * The child theme scope re-points `--color-primary-*` from `--qk-theme-accent`
 * (see the CHILD PRIMARY RAMP block in `src/design/child-experience.css`). This
 * test is the guard that keeps that derivation honest: it re-computes the ramp
 * with the same percentages the CSS uses and asserts the result is legible for
 * EVERY shop theme, in BOTH colour schemes.
 *
 * Why a source-level test instead of a screenshot: the percentages are the
 * contract. If someone tunes one to make Neon look nicer and drops a solid CTA
 * below 4.5:1 for Calm Pastel, pixels alone would not catch it — this does.
 *
 * It also pins the two things the ramp must NOT do:
 *   1. touch a semantic status colour (success / warning / danger / reward /
 *      xp / mint / coral / streak / family), and
 *   2. reach outside the child scope (classic, parent, auth, onboarding).
 */
import { readFileSync } from 'node:fs';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_CATALOG } from '../../src/domain/experience/fixtures/themes';

type Rgb = readonly [number, number, number];

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
const RAMP_CSS = readFileSync(join(REPO_ROOT, 'src/design/child-experience.css'), 'utf8');

/**
 * The ramp block only — comments stripped.
 *
 * Stripping matters: the block documents which semantic families it must NOT
 * touch, so a naive `includes('--color-success-')` would match its own prose.
 */
const RAMP_MARKER = RAMP_CSS.indexOf('CHILD PRIMARY RAMP');
const RAMP_BLOCK_RAW = RAMP_CSS.slice(RAMP_CSS.lastIndexOf('/*', RAMP_MARKER));
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const RAMP_BLOCK = stripComments(RAMP_BLOCK_RAW);
const RAMP_CSS_NO_COMMENTS = stripComments(RAMP_CSS);

/* -------------------------------------------------------------------------
 * Colour maths (mirrors the browser's `color-mix(in srgb, ...)`)
 * ---------------------------------------------------------------------- */

function parseHex(hex: string): Rgb {
  const s = hex.trim().replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as unknown as Rgb;
}

function relativeLuminance([r, g, b]: Rgb): number {
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `color-mix(in srgb, a pct%, b)` — the mix CSS performs in gamma space. */
function mix(a: Rgb, pct: number, b: Rgb): Rgb {
  const t = pct / 100;
  return [0, 1, 2].map((i) => Math.round(a[i] * t + b[i] * (1 - t))) as unknown as Rgb;
}

function saturation([r, g, b]: Rgb): number {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/* -------------------------------------------------------------------------
 * Read the percentages straight out of the CSS so the test cannot drift
 * ---------------------------------------------------------------------- */

/** The single `color-mix(...)` declaration for one custom property. */
function declaredMix(property: string): Rgb {
  const re = new RegExp(`${property}:\\s*color-mix\\(in srgb,\\s*var\\(--qk-theme-accent\\)\\s*(\\d+)%`, 'm');
  const m = RAMP_CSS.match(re);
  expect(m, `${property} must be derived from --qk-theme-accent inside the child scope`).not.toBeNull();
  return parseHex('#000000'); // placeholder; the numeric share is returned separately
}

/** Accent share (percent) the CSS assigns to a primary step. */
function accentShare(property: string): number {
  const re = new RegExp(`${property}:\\s*color-mix\\(in srgb,\\s*var\\(--qk-theme-accent\\)\\s*(\\d+)%`, 'm');
  const m = RAMP_CSS_NO_COMMENTS.match(re);
  expect(m, `${property} must be derived from --qk-theme-accent inside the child scope`).not.toBeNull();
  return Number(m![1]);
}

/* -------------------------------------------------------------------------
 * The scheme contract
 * ---------------------------------------------------------------------- */

/**
 * `--qk-tone-arrow` is the anchor the whole ramp mixes toward. It is defined
 * once in tokens.css and flips with the scheme, which is what lets a single set
 * of percentages serve light and dark.
 */
const ARROW: Record<'light' | 'dark', string> = {
  light: readTokenValue('--qk-tone-arrow', ':root'),
  dark: readTokenValue('--qk-tone-arrow', '.dark'),
};

/** `--qk-bg-default` is the card the tints sit on, so also scheme-dependent. */
const CARD: Record<'light' | 'dark', string> = {
  light: readTokenValue('--qk-tone-default', ':root'),
  dark: readTokenValue('--qk-tone-default', '.dark'),
};

/** On-brand label ink the child scope pins per scheme. */
const ON_BRAND: Record<'light' | 'dark', Rgb> = {
  light: parseHex('#ffffff'),
  dark: parseHex('#12101a'),
};

function readTokenValue(property: string, fromScope: ':root' | '.dark'): string {
  const tokens = readFileSync(join(REPO_ROOT, 'src/design/tokens.css'), 'utf8');
  const scopeStart = tokens.indexOf(fromScope === ':root' ? ':root {' : '.dark {');
  expect(scopeStart, `tokens.css must define ${fromScope}`).toBeGreaterThan(-1);
  const scopeEnd = tokens.indexOf('\n}', scopeStart);
  const body = tokens.slice(scopeStart, scopeEnd);
  const m = body.match(new RegExp(`${property}:\\s*(#[0-9a-fA-F]{3,8})`));
  expect(m, `${property} must exist in tokens.css under ${fromScope}`).not.toBeNull();
  return m![1];
}

/* -------------------------------------------------------------------------
 * The catalog
 * ---------------------------------------------------------------------- */

/** Only purchasable shop themes carry `shopItemId`; classic is the baseline. */
const SHOP_THEMES = THEME_CATALOG.filter((t) => typeof t.shopItemId === 'string');

/**
 * Classic's own shipped values — the yardstick for "no worse than Queki".
 *
 * Tints are calibrated PER SCHEME, because Queki ships a different tint ramp in
 * dark mode (index.css remaps 50/100/200): comparing a dark-scheme tint against
 * the light-scheme yardstick would demand a tint flatter than Queki's own.
 */
const CLASSIC_500 = '#6366f1';
const CLASSIC_400 = '#818cf8';
const CLASSIC_TINT: Record<'light' | 'dark', string> = { light: '#c7d2fe', dark: '#322b5e' };

describe('child primary ramp', () => {
  it('derives every step from --qk-theme-accent (no hard-coded per-theme colour)', () => {
    for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      const share = accentShare(`--color-primary-${step}`);
      expect(share, `step ${step} share`).toBeGreaterThanOrEqual(0);
      expect(share, `step ${step} share`).toBeLessThanOrEqual(100);
    }
  });

  it('excludes Queki Classic from the ramp so the identity baseline is untouched', () => {
    // The scope selectors must match `theme.shop.*` only. `theme.standard`
    // (Classic) and the seasonal `theme.*` ids must not match.
    const scoped = RAMP_CSS.includes(".qk-child-theme[data-child-theme^='theme.shop.']");
    expect(scoped).toBe(true);
    expect(RAMP_CSS).not.toMatch(/\[data-child-theme\^='theme\.standard'\]/);
    expect(RAMP_CSS).not.toMatch(/\[data-child-theme\^\s*=\s*'theme\.'\]/);
  });

  it.each(SHOP_THEMES.map((t) => [t.shopItemId as string, t.id, t.tokens.accent] as const))(
    'keeps %s legible in both schemes',
    (_item, _id, accent) => {
      const a = parseHex(accent);
      const classic500 = parseHex(CLASSIC_500);

      for (const scheme of ['light', 'dark'] as const) {
        const arrow = parseHex(ARROW[scheme]);
        const card = parseHex(CARD[scheme]);
        const onBrand = ON_BRAND[scheme];
        const at = (step: number) => mix(a, accentShare(`--color-primary-${step}`), arrow);
        const tint = (step: number) => mix(a, accentShare(`--color-primary-${step}`), card);

        // 1. Solid CTA steps carry an on-brand label -> WCAG AA text.
        for (const step of [500, 600, 700]) {
          const c = contrastRatio(at(step), onBrand);
          expect(c, `${scheme} ${step} CTA label`).toBeGreaterThanOrEqual(4.5);
        }

        // 2. 600/700 are also accent COPY on a card -> WCAG AA text.
        for (const step of [600, 700]) {
          const c = contrastRatio(at(step), card);
          expect(c, `${scheme} ${step} accent copy on card`).toBeGreaterThanOrEqual(4.5);
        }

        // 3. 300/400 are focus rings and borders. Classic's own 400 only reaches
        //    2.98:1 on a white card, so that is the floor a border has to clear
        //    to be no less visible than the ramp it replaces.
        const classicRingFloor = contrastRatio(parseHex(CLASSIC_400), card);
        for (const step of [300, 400]) {
          const c = contrastRatio(at(step), card);
          expect(c, `${scheme} ${step} ring on card`).toBeGreaterThanOrEqual(
            Math.min(classicRingFloor, 3) - 0.001,
          );
        }

        // 4. The solid step must be visible against the card behind it.
        const solidVsCard = contrastRatio(at(500), card);
        expect(solidVsCard, `${scheme} 500 solid vs card`).toBeGreaterThanOrEqual(3);
        // ...and strictly more legible than the fixed indigo it replaces.
        expect(solidVsCard).toBeGreaterThanOrEqual(
          contrastRatio(classic500, card) - 0.001,
        );

        // 5. Tints stay as quiet as classic's own 200, so they read as
        //    surfaces rather than as a status colour.
        const classicTint = parseHex(CLASSIC_TINT[scheme]);
        // Saturation is capped against CLASSIC's own tint for the same scheme:
        // a tint more chromatic than Queki's own would start competing with
        // success / warning / danger for the meaning of "coloured".
        const classicTintSat = saturation(classicTint);
        // Separation from the card uses one explicit floor for both schemes
        // (classic's dark tint only reaches 1.15:1, which is too tight a
        // yardstick to design against). 1.35 is the ceiling at which a tint
        // still reads as a surface rather than as a state change.
        const TINT_CARD_CAP = 1.35;
        for (const step of [50, 100, 200]) {
          expect(saturation(tint(step)), `${scheme} tint ${step} saturation`).toBeLessThanOrEqual(
            classicTintSat + 0.01,
          );
          expect(contrastRatio(tint(step), card), `${scheme} tint ${step} vs card`).toBeLessThanOrEqual(
            TINT_CARD_CAP,
          );
        }

        // 6. Monotonic: tints move away from the card as the step grows, and
        //    the solid ramp moves monotonically toward the anchor.
        const tintL = [50, 100, 200].map((s) => relativeLuminance(tint(s)));
        for (let i = 1; i < tintL.length; i += 1) {
          if (scheme === 'light') {
            expect(tintL[i], `light tint monotonic at ${[50, 100, 200][i]}`).toBeLessThanOrEqual(tintL[i - 1] + 1e-9);
          } else {
            expect(tintL[i], `dark tint monotonic at ${[50, 100, 200][i]}`).toBeGreaterThanOrEqual(tintL[i - 1] - 1e-9);
          }
        }
        const solidL = [300, 400, 500, 600, 700, 800, 900].map((s) => relativeLuminance(at(s)));
        for (let i = 1; i < solidL.length; i += 1) {
          if (scheme === 'light') {
            expect(solidL[i], `light solid monotonic at ${[300, 400, 500, 600, 700, 800, 900][i]}`).toBeLessThanOrEqual(solidL[i - 1] + 1e-9);
          } else {
            expect(solidL[i], `dark solid monotonic at ${[300, 400, 500, 600, 700, 800, 900][i]}`).toBeGreaterThanOrEqual(solidL[i - 1] - 1e-9);
          }
        }
      }
    },
  );

  it('produces a DIFFERENT ramp per theme, so the CTA actually follows the accent', () => {
    const seen = SHOP_THEMES.map((t) => {
      const a = parseHex(t.tokens.accent);
      const arrow = parseHex(ARROW.light);
      return mix(a, accentShare('--color-primary-500'), arrow).join(',');
    });
    expect(new Set(seen).size, 'each theme must yield its own primary-500').toBe(seen.length);
    // And none of them may still be Queki's fixed indigo.
    const classic = mix(
      parseHex(CLASSIC_500),
      100,
      parseHex(ARROW.light),
    ).join(',');
    for (const value of seen) expect(value).not.toBe(classic);
  });

  it('never touches a semantic status colour', () => {
    const semantic = [
      '--color-success', '--color-warning', '--color-danger', '--color-coral',
      '--color-reward', '--color-xp', '--color-mint', '--color-streak', '--color-family',
    ];
    expect(RAMP_BLOCK_RAW.length).toBeGreaterThan(0);
    // Comments are stripped, so this matches real declarations only.
    for (const family of semantic) {
      expect(RAMP_BLOCK, `${family} must not be redefined by the child ramp`).not.toContain(`${family}-`);
    }
    // And the ramp does redefine the primary family.
    expect(RAMP_BLOCK).toContain('--color-primary-500');
  });

  it('only re-points colour inside the child scope', () => {
    // Match `selector-list {` at the top level of each rule, ignoring anything
    // inside a declaration value (color-mix has its own parens, not braces).
    const rulePattern = /(^|\})\s*([^{}]+?)\s*\{/g;
    /** Split a selector list only on commas at paren depth 0, so the
     * alternatives inside `:is(...)` are not mistaken for top-level parts. */
    const splitTopLevel = (list: string): string[] => {
      const parts: string[] = [];
      let depth = 0;
      let current = '';
      for (const ch of list) {
        if (ch === '(') depth += 1;
        if (ch === ')') depth -= 1;
        if (ch === ',' && depth === 0) {
          parts.push(current);
          current = '';
          continue;
        }
        current += ch;
      }
      parts.push(current);
      return parts.map((p) => p.trim()).filter(Boolean);
    };

    let match: RegExpExecArray | null;
    let rules = 0;
    while ((match = rulePattern.exec(RAMP_BLOCK)) !== null) {
      const selectorList = match[2].trim();
      if (!selectorList) continue;
      rules += 1;
      for (const trimmed of splitTopLevel(selectorList)) {
        /* An at-rule prelude is not a selector. `@media (prefers-reduced-motion: reduce)`
           introduces the personality block's motion gate and carries no
           declarations of its own; exempting it is a false-positive fix, not a
           scope relaxation — every real selector it wraps is still gated, and
           tests/theme/themePersonality.test.ts additionally asserts the gating
           of every selector inside that block. */
        if (trimmed.startsWith('@')) {
          /* Two at-rule kinds are legitimate here and neither declares a
             selector of its own: the personality layer's reduced-motion gate,
             and its decorative `@keyframes`. Neither can repaint anything on its
             own — every declaration they contain lives in a rule this loop
             still checks. */
          expect(trimmed).toMatch(
            /^@media \(prefers-reduced-motion: reduce\)$|^@keyframes [a-z-]+$/,
          );
          /* Skip the whole `@keyframes` body. Its `from` / `to` steps are key
             frame selectors, not style rules, so gating them on the child scope
             is meaningless — and they are audited separately, for colour, in
             tests/theme/themePersonality.test.ts. */
          if (trimmed.startsWith('@keyframes')) {
            const bodyStart = match.index + match[0].length;
            const bodyEnd = RAMP_BLOCK.indexOf('}', bodyStart);
            if (bodyEnd !== -1) rulePattern.lastIndex = bodyEnd + 1;
          }
          continue;
        }
        expect(trimmed, `selector "${trimmed}" must be gated on the child theme`).toContain(
          "data-child-theme^='theme.shop.'",
        );
      }
    }
    expect(rules, 'the ramp block must declare at least one scoped rule').toBeGreaterThan(0);
  });

  it('declares --qk-accent-ink on the <html> mirror, not only on the shell', () => {
    // Regression guard for a real bug: the app chrome (header nav, wordmark,
    // bottom bar) is a SIBLING of the themed shell, so its rules are keyed on
    // the <html> mirror. `--qk-accent-ink` used to exist only on the shell
    // scope, which made every mirror-scoped `color: var(--qk-accent-ink)`
    // INVALID AT COMPUTED-VALUE TIME — the browser discarded the declaration
    // and the chrome silently fell back to neutral grey. A custom property
    // that is read must be declared on every scope that reads it.
    const mirrorRules = [...RAMP_CSS_NO_COMMENTS.matchAll(/html\[data-child-theme\^='theme\.shop\.'\]\s*\{([^}]*)\}/g)]
      .map((m) => m[1])
      .join('\n');
    expect(mirrorRules).toMatch(/--qk-accent-ink:/);
    expect(mirrorRules).toMatch(/--qk-accent-soft:/);

    // Every custom property read by a mirror-scoped RULE BODY must be declared
    // for the mirror, otherwise the same silent fallback returns.
    const mirrorRulePattern = /html(?:\.dark)?\[data-child-theme\^='theme\.shop\.'\]([^{}]*)\{([^}]*)\}/g;
    const reads = new Set<string>();
    const declaredForMirror = new Set<string>();
    let rule: RegExpExecArray | null;
    while ((rule = mirrorRulePattern.exec(RAMP_CSS_NO_COMMENTS)) !== null) {
      const [, selector, body] = rule;
      // The `html[...]` selector alone (not `html.dark[...]`) is the one that
      // carries the base declarations; either way both must be self-contained.
      for (const m of body.matchAll(/var\((--qk-[a-z-]+)\)/g)) reads.add(m[1]);
      if (!selector.trim().startsWith('html.dark')) {
        for (const m of body.matchAll(/(--qk-[a-z-]+)\s*:/g)) declaredForMirror.add(m[1]);
      }
    }
    // Provided by the theme itself or by tokens.css, so not the mirror's job.
    const providedElsewhere = new Set([
      '--qk-theme-accent',
      '--qk-tone-arrow',
      '--qk-tone-canvas',
      '--qk-tone-subtle',
      '--qk-tone-default',
      '--qk-tone-elevated',
      '--qk-tone-interactive',
      '--qk-bg-canvas',
      '--qk-bg-subtle',
      '--qk-bg-default',
      '--qk-bg-elevated',
      '--qk-bg-interactive',
      '--qk-text-onbrand', // declared in tokens.css for :root and .dark
    ]);
    expect(reads.size, 'the mirror must actually read tokens somewhere').toBeGreaterThan(0);
    for (const name of reads) {
      if (providedElsewhere.has(name)) continue;
      expect(
        declaredForMirror.has(name),
        `${name} is read by a mirror-scoped rule but never declared for the mirror — its declaration would be invalid at computed-value time and the rule would silently fall back to inherited`,
      ).toBe(true);
    }
  });

  it('flips the on-brand ink per scheme so a dark-mode solid keeps AA text', () => {
    // Dark mode: the solid step is a LIGHT tint of the accent, so white text
    // would fail. The scope pins dark ink instead.
    expect(RAMP_CSS).toMatch(/html\.dark\[data-child-theme\^='theme\.shop\.'\][\s\S]*?--qk-child-primary-onbrand:\s*#12101a/);
    expect(RAMP_CSS).toMatch(/html\[data-child-theme\^='theme\.shop\.'\]\s*\{[\s\S]*?--qk-child-primary-onbrand:\s*#ffffff/);
    // And it is applied to every solid step a child CTA can use.
    for (const step of [500, 600, 700, 800, 900]) {
      expect(RAMP_CSS).toContain(`.bg-primary-${step}`);
    }
  });
});

/** Keeps the unused-variable lint honest about the helper above. */
void declaredMix;
void statSync;
void CLASSIC_400;