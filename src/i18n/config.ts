import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ViteI18nBackend } from './backend';
import enCommon from './locales/en/common.json';
import trCommon from './locales/tr/common.json';

export const SUPPORTED_LANGUAGES = ['en', 'tr'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

/**
 * Canonical list of namespaces. Used for typing and documentation; the actual
 * lazy loading is driven by `useTranslation('<ns>')` + ViteI18nBackend, so this
 * array is intentionally NOT passed to `ns` (which would eagerly load them).
 */
export const NAMESPACES = [
  'common',
  'auth',
  'family',
  'tasks',
  'wallet',
  'goals',
  'rewards',
  'dashboard',
  'settings',
  'notifications',
  'errors',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

i18n
  .use(new ViteI18nBackend())
  .use(initReactI18next)
  .init({
    // Resolved at bootstrap (see index.ts) using the priority:
    // user preference -> browser language -> English fallback.
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    // Only the default namespace is loaded up-front; every other namespace is
    // fetched lazily on first use. This keeps the initial payload minimal.
    ns: ['common'],
    defaultNS: 'common',
    // Seed the default namespace for every supported language synchronously so
    // the very first paint never blocks on a dynamic import. `partialBundledLanguages`
    // tells i18next these resources are only a partial seed — all other
    // namespaces are still fetched lazily from ViteI18nBackend.
    resources: {
      en: { common: enCommon },
      tr: { common: trCommon },
    },
    partialBundledLanguages: true,
    interpolation: {
      // React already escapes output; i18next must not double-escape.
      escapeValue: false,
    },
    react: {
      // Infrastructure phase: avoid Suspense boundaries. Components re-render
      // automatically once a lazily-loaded namespace becomes available.
      useSuspense: false,
    },
    // Never return null from `t` so callers can rely on a string type.
    returnNull: false,
    // 'en-US' / 'tr-TR' collapse to 'en' / 'tr'.
    load: 'languageOnly',
    saveMissing: false,
  });

export default i18n;
