/**
 * Appearance (Light / Dark / System) abstraction.
 *
 * This module is intentionally framework-agnostic and side-effect free except
 * for the small, explicit `applyTheme` / `subscribeSystemPreference` helpers
 * that touch the DOM. Keeping the pure logic here makes it trivially testable
 * and lets the Zustand store and the inline startup bootstrap share the exact
 * same resolution rules.
 *
 * Persistence is device/UI-local (localStorage) on purpose: appearance is a
 * per-device preference and there is no established Firestore appearance model
 * to extend.
 */

export type Appearance = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const APPEARANCE_STORAGE_KEY = 'queki:appearance';

/** Brand teal used as the browser chrome colour in light mode. */
export const THEME_COLOR_LIGHT = '#0f766e';
/** Very dark neutral used as the browser chrome colour in dark mode. */
export const THEME_COLOR_DARK = '#0e1116';

const APPEARANCE_VALUES: readonly Appearance[] = ['system', 'light', 'dark'];

export function isAppearance(value: unknown): value is Appearance {
  return APPEARANCE_VALUES.includes(value as Appearance);
}

/**
 * Read the persisted preference. Returns `'system'` when nothing is stored or
 * storage is unavailable (private mode, SSR, quota errors). Never throws.
 */
export function getStoredAppearance(storage: Storage = localStorage): Appearance {
  try {
    const raw = storage.getItem(APPEARANCE_STORAGE_KEY);
    return isAppearance(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

/** Persist the preference. Swallows storage errors (private mode, quota). */
export function storeAppearance(value: Appearance, storage: Storage = localStorage): void {
  try {
    storage.setItem(APPEARANCE_STORAGE_KEY, value);
  } catch {
    /* storage unavailable — preference simply will not persist */
  }
}

/** True when the OS/browser reports a dark color scheme. */
export function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Resolve the concrete theme to render.
 *
 * - `light` → always light
 * - `dark`  → always dark
 * - `system`→ follows the OS preference
 */
export function resolveResolvedTheme(appearance: Appearance, systemDark: boolean): ResolvedTheme {
  if (appearance === 'light') return 'light';
  if (appearance === 'dark') return 'dark';
  return systemDark ? 'dark' : 'light';
}

export function getThemeColor(resolved: ResolvedTheme): string {
  return resolved === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT;
}

/**
 * Apply the resolved theme to the document: toggle the root `dark` class (which
 * Tailwind's class-based dark mode and our CSS variable overrides key off) and
 * keep the browser `theme-color` meta in sync so the address bar / PWA chrome
 * matches the active appearance.
 */
export function applyTheme(resolved: ResolvedTheme, doc: Document = document): void {
  const root = doc.documentElement;
  const isDark = resolved === 'dark';
  root.classList.toggle('dark', isDark);
  root.style.colorScheme = isDark ? 'dark' : 'light';
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', getThemeColor(resolved));
  }
}

/**
 * Subscribe to live OS appearance changes. Returns an unsubscribe function.
 * Uses the modern `addEventListener` API with a fallback for older browsers.
 */
export function subscribeSystemPreference(callback: (systemDark: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (event: MediaQueryListEvent | MediaQueryList) => callback(event.matches);
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }
  // Legacy Safari / older browsers
  mql.addListener(handler);
  return () => mql.removeListener(handler);
}
