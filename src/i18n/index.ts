import './types';
import i18n, {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  NAMESPACES,
  type SupportedLanguage,
  type Namespace,
} from './config';

export { i18n as default, DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, NAMESPACES };
export type { SupportedLanguage, Namespace };
export { useTranslation } from 'react-i18next';
export * from './format';

/**
 * Languages whose layout flows right-to-left. The architecture is RTL-ready:
 * `applyDocumentDirection` sets `dir`/`lang` on <html>, and components should
 * rely on logical CSS properties (e.g. `margin-inline-start`) so Arabic/Hebrew
 * can be added later without a redesign.
 */
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

/**
 * Detect the best supported language from the browser, honouring the full
 * `navigator.languages` preference list and falling back to English.
 */
export function detectBrowserLanguage(): SupportedLanguage {
  if (typeof navigator === 'undefined') return DEFAULT_LANGUAGE;
  const candidates = navigator.languages ?? [navigator.language];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const base = candidate.split('-')[0].toLowerCase();
    if ((SUPPORTED_LANGUAGES as readonly string[]).includes(base)) {
      return base as SupportedLanguage;
    }
  }
  return DEFAULT_LANGUAGE;
}

/**
 * Future-ready hook for the authenticated user's saved language preference.
 * Not yet wired to auth storage; returns `null` until preferences are editable.
 * When implemented, read the persisted preference (e.g. a user profile field)
 * and return it here — the rest of the resolution chain already consumes it.
 */
export function getUserLanguagePreference(): SupportedLanguage | null {
  return null;
}

/**
 * Resolution priority:
 *   1. authenticated user's saved preference (future-ready)
 *   2. browser language
 *   3. English fallback
 */
export function resolveInitialLanguage(): SupportedLanguage {
  return getUserLanguagePreference() ?? detectBrowserLanguage() ?? DEFAULT_LANGUAGE;
}

/**
 * Reflect the active language on the document element for RTL/LTR and a11y.
 */
export function applyDocumentDirection(language: string): void {
  if (typeof document === 'undefined') return;
  const base = language.split('-')[0].toLowerCase();
  const dir = RTL_LANGUAGES.has(base) ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', base);
}

/**
 * Initialize language + document direction once, before the app renders.
 * Safe to call a single time from the application entry point.
 */
export async function bootstrapI18n(): Promise<typeof i18n> {
  const language = resolveInitialLanguage();
  if (i18n.language !== language) {
    await i18n.changeLanguage(language);
  }
  applyDocumentDirection(language);
  return i18n;
}
