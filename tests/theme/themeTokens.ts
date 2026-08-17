/**
 * Static theme-token resolver used by the dark-theme regression scans.
 *
 * Why static analysis?
 * -------------------
 * The Appearance release implements dark mode by remapping Tailwind's colour
 * *variables* inside `.dark` (see `src/index.css`). That means a component can
 * look perfect in light mode and be unreadable in dark mode purely because a
 * token it uses has no dark value — no component code change required. The
 * original regression check only looked for literal `bg-white` cards, so a
 * light *semantic* surface (`bg-amber-50` on the Family Bulletin announcement)
 * slipped through to production.
 *
 * This module rebuilds the effective colour table for both themes:
 *   1. Tailwind's default palette      (node_modules/tailwindcss/theme.css)
 *   2. the project `@theme` block      (src/index.css — light overrides)
 *   3. the `.dark` variable overrides  (src/index.css — dark remap)
 *   4. the `.dark .<utility>` rules    (src/index.css — per-utility overrides)
 *
 * With that table we can resolve any `bg-*` / `text-*` / `border-*` class to a
 * concrete colour per theme and compute WCAG contrast without a browser.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export type Rgb = readonly [number, number, number];
export type Mode = 'light' | 'dark';

/**
 * Repository root. `import.meta.url` is not a file URL under the jsdom test
 * environment, so walk up from the working directory until the app manifest is
 * found — this works from any cwd vitest is launched in.
 */
function findRepoRoot(from = process.cwd()): string {
  let current = resolve(from);
  for (;;) {
    if (existsSync(join(current, 'src/index.css'))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(from);
    current = parent;
  }
}

export const REPO_ROOT = findRepoRoot();

const TAILWIND_THEME_CSS = resolve(REPO_ROOT, 'node_modules/tailwindcss/theme.css');
const APP_CSS = resolve(REPO_ROOT, 'src/index.css');

/* -------------------------------------------------------------------------- */
/* CSS parsing                                                                */
/* -------------------------------------------------------------------------- */

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Extract the body of the first block whose selector starts with `opener`. */
function extractBlock(css: string, opener: string): string {
  const start = css.indexOf(opener);
  if (start === -1) return '';
  const open = css.indexOf('{', start);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return '';
}

function parseColorVars(block: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /--color-([a-z0-9-]+):\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block))) out.set(match[1], match[2].trim());
  return out;
}

/**
 * Parse per-utility dark overrides, e.g.
 *   `.dark .bg-white { background-color: #1b212b; }`
 *   `.dark .text-gray-900 { color: #f1f5f9; }`
 * Multiple comma-separated selectors are supported.
 */
function parseDarkUtilityRules(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /((?:\.dark\s+\.[A-Za-z0-9\\/_.-]+\s*,?\s*)+)\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) {
    const declarations = match[2];
    const colour = /(?:^|[\s;])(?:background-)?color:\s*([^;]+);?/.exec(declarations)?.[1]?.trim();
    if (!colour) continue;
    for (const selector of match[1].split(',')) {
      const cls = /\.dark\s+\.([A-Za-z0-9\\/_.-]+)/.exec(selector)?.[1];
      if (cls) out.set(cls.replace(/\\/g, ''), colour);
    }
  }
  return out;
}

const tailwindDefaults = parseColorVars(read(TAILWIND_THEME_CSS));
const appCss = read(APP_CSS);
const appTheme = parseColorVars(extractBlock(appCss, '@theme'));
const darkVars = parseColorVars(extractBlock(appCss, '.dark {'));
const darkUtilities = parseDarkUtilityRules(appCss);

/* -------------------------------------------------------------------------- */
/* Colour maths                                                               */
/* -------------------------------------------------------------------------- */

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** OKLCH → sRGB (0–255). Tailwind v4 ships its palette as `oklch()`. */
function oklchToRgb(lightness: number, chroma: number, hueDeg: number): Rgb {
  const hue = (hueDeg * Math.PI) / 180;
  const a = Math.cos(hue) * chroma;
  const b = Math.sin(hue) * chroma;

  const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = lightness - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(clamp01);

  const encode = (value: number) =>
    value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

  return linear.map((value) => Math.round(clamp01(encode(value)) * 255)) as unknown as Rgb;
}

/** Parse any colour notation used by the palette (`#hex`, `oklch()`, `rgb()`). */
export function parseColor(value: string): Rgb | null {
  const input = value.trim();

  const hex = /^#([0-9a-f]{3,8})$/i.exec(input);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      const [r, g, b] = digits.slice(0, 3).split('');
      return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
    }
    return [
      parseInt(digits.slice(0, 2), 16),
      parseInt(digits.slice(2, 4), 16),
      parseInt(digits.slice(4, 6), 16),
    ];
  }

  const oklch = /^oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)/i.exec(input);
  if (oklch) {
    const raw = parseFloat(oklch[1]);
    const lightness = input.includes('%') ? raw / 100 : raw;
    return oklchToRgb(lightness, parseFloat(oklch[2]), parseFloat(oklch[3]));
  }

  const rgb = /^rgba?\(([^)]+)\)/i.exec(input);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (parts.length >= 3) return [parts[0], parts[1], parts[2]];
  }

  if (input === 'white') return [255, 255, 255];
  if (input === 'black') return [0, 0, 0];
  return null;
}

export function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* -------------------------------------------------------------------------- */
/* Token / utility resolution                                                 */
/* -------------------------------------------------------------------------- */

/** Resolve a palette token (`amber-50`, `gray-900`, `white`) for a theme. */
export function resolveToken(token: string, mode: Mode): Rgb | null {
  if (token === 'white') return [255, 255, 255];
  if (token === 'black') return [0, 0, 0];
  const raw =
    (mode === 'dark' ? darkVars.get(token) : undefined) ??
    appTheme.get(token) ??
    tailwindDefaults.get(token);
  return raw ? parseColor(raw) : null;
}

export type UtilityKind = 'bg' | 'text' | 'border';

export interface UtilityRef {
  /** Full class as written, e.g. `dark:hover:bg-amber-100/50`. */
  className: string;
  kind: UtilityKind;
  /** Palette token, e.g. `amber-100`. */
  token: string;
  /** Numeric palette step, when the token has one. */
  step: number | null;
  /** Variant prefixes, e.g. `['dark', 'hover']`. */
  variants: string[];
  /** Opacity modifier (`/50` → 0.5), when present. */
  alpha: number | null;
}

const NON_COLOUR_TEXT = new Set([
  'left', 'center', 'right', 'justify', 'start', 'end',
  'xs', 'sm', 'base', 'lg', 'xl', 'nowrap', 'wrap', 'balance', 'pretty',
  'ellipsis', 'clip', 'transparent', 'current', 'inherit',
]);

/** Parse a single class into a colour-utility reference (or null). */
export function parseUtility(className: string): UtilityRef | null {
  const segments = className.split(':');
  const bare = segments.pop() as string;
  const variants = segments;

  const match = /^(bg|text|border)-(.+)$/.exec(bare);
  if (!match) return null;
  const kind = match[1] as UtilityKind;

  let rest = match[2];
  if (rest.startsWith('[') || rest.includes('(')) return null; // arbitrary value

  let alpha: number | null = null;
  const slash = rest.lastIndexOf('/');
  if (slash !== -1) {
    const modifier = rest.slice(slash + 1);
    rest = rest.slice(0, slash);
    if (/^\d+$/.test(modifier)) alpha = parseInt(modifier, 10) / 100;
  }

  if (rest === 'transparent' || rest === 'current' || rest === 'inherit') return null;
  if (kind === 'text' && NON_COLOUR_TEXT.has(rest)) return null;
  // Text size/leading pairs such as `text-2xl` or numeric font sizes.
  if (kind === 'text' && /^\d?xl$/.test(rest)) return null;

  const stepped = /^([a-z]+)-(\d{2,3})$/.exec(rest);
  const isNamed = rest === 'white' || rest === 'black';
  if (!stepped && !isNamed) return null;

  return {
    className,
    kind,
    token: rest,
    step: stepped ? parseInt(stepped[2], 10) : null,
    variants,
    alpha,
  };
}

/**
 * Resolve a utility class to a colour for a theme, honouring the per-utility
 * `.dark .<class>` overrides (which win over the variable remap).
 */
export function resolveUtility(ref: UtilityRef, mode: Mode): Rgb | null {
  if (mode === 'dark') {
    const bare = `${ref.kind}-${ref.token}${ref.alpha !== null ? `/${Math.round(ref.alpha * 100)}` : ''}`;
    const override = darkUtilities.get(bare) ?? darkUtilities.get(`${ref.kind}-${ref.token}`);
    if (override) {
      const parsed = parseColor(override);
      if (parsed) return parsed;
    }
  }
  return resolveToken(ref.token, mode);
}

/**
 * Composite a (possibly translucent) surface over a backdrop, so alpha-modified
 * tints (`bg-warning-50/30`) are judged on what the user actually sees.
 */
export function composite(surface: Rgb, alpha: number | null, backdrop: Rgb): Rgb {
  if (alpha === null) return surface;
  return surface.map((channel, index) =>
    Math.round(channel * alpha + backdrop[index] * (1 - alpha)),
  ) as unknown as Rgb;
}

/* -------------------------------------------------------------------------- */
/* Source scanning                                                            */
/* -------------------------------------------------------------------------- */

export interface ClassChunk {
  /** Repo-relative file path. */
  file: string;
  line: number;
  /** Whitespace-separated class list as authored. */
  classes: string[];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Collect every string literal that looks like a Tailwind class list, keeping
 * literals grouped so a background and its foreground can be judged together.
 */
export function collectClassChunks(dir = resolve(REPO_ROOT, 'src')): ClassChunk[] {
  const chunks: ClassChunk[] = [];
  for (const file of walk(dir)) {
    const source = read(file);
    const re = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source))) {
      const raw = match[1] ?? match[2] ?? match[3] ?? '';
      // Template placeholders break class names; treat them as separators.
      const text = raw.replace(/\$\{[^}]*\}/g, ' ');
      if (!/(?:^|[\s:])(?:bg|text|border)-/.test(text)) continue;
      const classes = text.split(/\s+/).filter(Boolean);
      if (classes.length === 0) continue;
      chunks.push({
        file: relative(REPO_ROOT, file),
        line: source.slice(0, match.index).split('\n').length,
        classes,
      });
    }
  }
  return chunks;
}

/** Palette steps used as *tinted surfaces* (cards, banners, chips, callouts). */
export const TINT_STEPS = [50, 100, 200];

export function isTintSurface(ref: UtilityRef): boolean {
  if (ref.kind !== 'bg') return false;
  if (ref.token === 'white') return true;
  return ref.step !== null && TINT_STEPS.includes(ref.step);
}

/** Dark-mode page background (`gray-50` remap) used as the default backdrop. */
export function darkPageBackground(): Rgb {
  return resolveToken('gray-50', 'dark') ?? [14, 17, 22];
}
