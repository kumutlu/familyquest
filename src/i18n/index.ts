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

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string'
    && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Resolve an authoritative profile value. Missing legacy fields use the
 * browser preference, but a present invalid value fails closed to English.
 */
export function resolveProfileLanguage(value: unknown): SupportedLanguage {
  if (value === undefined || value === null) return detectBrowserLanguage();
  return isSupportedLanguage(value) ? value : DEFAULT_LANGUAGE;
}

export function resolveInitialLanguage(): SupportedLanguage {
  return detectBrowserLanguage();
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

export async function applyLanguage(language: SupportedLanguage): Promise<void> {
  if (i18n.language !== language) {
    await i18n.changeLanguage(language);
  }
  applyDocumentDirection(language);
}

/**
 * Initialize language + document direction once, before the app renders.
 * Safe to call a single time from the application entry point.
 *
 * All UI namespaces are preloaded here so the very first React render already
 * has every translation resource available. Without this, `useSuspense: false`
 * causes components to paint raw keys (e.g. `send.title`) until the lazy
 * namespace import resolves.
 */
export async function bootstrapI18n(): Promise<typeof i18n> {
  const language = resolveInitialLanguage();
  await applyLanguage(language);
  await i18n.loadNamespaces([...NAMESPACES]);
  return i18n;
}
