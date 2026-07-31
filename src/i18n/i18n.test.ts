import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n, { DEFAULT_LANGUAGE, NAMESPACES, SUPPORTED_LANGUAGES } from './config';
import {
  detectBrowserLanguage,
  isSupportedLanguage,
  resolveInitialLanguage,
  resolveProfileLanguage,
} from './index';
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatRelativeTime,
} from './format';

type TranslationValue = string | { [key: string]: TranslationValue };

const localeModules = import.meta.glob('./locales/{en,tr}/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, TranslationValue>;

function flattenLocaleKeys(value: TranslationValue, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix];

  return Object.entries(value).flatMap(([key, child]) =>
    flattenLocaleKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function localeNamespace(language: 'en' | 'tr', namespace: string): TranslationValue {
  const locale = localeModules[`./locales/${language}/${namespace}.json`];
  if (!locale) throw new Error(`Missing ${language}/${namespace} locale`);
  return locale;
}

const ORIGINAL_LANGUAGE = i18n.language;

// --- navigator.languages mocking helpers -----------------------------------
let originalLanguages: readonly string[] | null = null;

function setBrowserLanguages(langs: string[]): void {
  if (originalLanguages === null) {
    try {
      originalLanguages = navigator.languages;
    } catch {
      originalLanguages = [];
    }
  }
  Object.defineProperty(navigator, 'languages', {
    configurable: true,
    value: langs,
  });
}

function restoreBrowserLanguages(): void {
  if (originalLanguages !== null) {
    Object.defineProperty(navigator, 'languages', {
      configurable: true,
      value: originalLanguages,
    });
    originalLanguages = null;
  }
}

afterEach(async () => {
  restoreBrowserLanguages();
  await i18n.changeLanguage(ORIGINAL_LANGUAGE);
  // i18next is a singleton; unload lazily-loaded namespaces so each test starts
  // from the same state (only the seeded `common` namespace is present).
  for (const ns of NAMESPACES) {
    if (ns === 'common') continue;
    i18n.removeResourceBundle('en', ns);
    i18n.removeResourceBundle('tr', ns);
  }
});

describe('i18n initialization', () => {
  it('initializes the singleton with the English default and common namespace', () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.language).toBe('en');
    expect(i18n.hasResourceBundle('en', 'common')).toBe(true);
    // Lazy namespaces are NOT loaded up-front.
    expect(i18n.hasResourceBundle('en', 'auth')).toBe(false);
    expect(i18n.t('common:appName')).toBe('Queki');
  });

  it('does not emit console errors or warnings during core operations', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await i18n.loadNamespaces(['auth', 'errors']);
    i18n.t('common:appName');
    i18n.t('auth:signIn');
    i18n.t('errors:generic');

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe('locale completeness', () => {
  it('keeps every English and Turkish namespace key in parity', () => {
    for (const namespace of NAMESPACES) {
      const englishKeys = flattenLocaleKeys(localeNamespace('en', namespace)).sort();
      const turkishKeys = flattenLocaleKeys(localeNamespace('tr', namespace)).sort();

      expect(turkishKeys, namespace).toEqual(englishKeys);
    }
  });

  it('uses the correct Turkish spelling of ailede in wallet copy', () => {
    const wallet = localeNamespace('tr', 'wallet') as {
      send: { noSiblings: string };
      allowance: { noChildren: string };
    };

    expect(wallet.send.noSiblings).toBe('Bu ailede henüz başka çocuk yok.');
    expect(wallet.allowance.noChildren).toBe('Bu ailede çocuk bulunamadı.');
  });
});

describe('i18n fallback language', () => {
  it('falls back to English for an unsupported language', async () => {
    await i18n.loadNamespaces(['auth']);
    // 'xx' is unsupported; i18next must resolve to the English fallback.
    expect(i18n.t('auth:signIn', { lng: 'xx' })).toBe('Sign in');
  });
});

describe('i18n browser language detection', () => {
  it('detects a supported browser language (region stripped)', () => {
    setBrowserLanguages(['tr-TR', 'en-US', 'en']);
    expect(detectBrowserLanguage()).toBe('tr');
  });

  it('falls back to English when no supported language is present', () => {
    setBrowserLanguages(['xx-YY', 'zz']);
    expect(detectBrowserLanguage()).toBe('en');
  });

  it('falls back to English for an empty language list', () => {
    setBrowserLanguages([]);
    expect(detectBrowserLanguage()).toBe('en');
  });

  it('resolution priority yields a supported language and matches detection', () => {
    setBrowserLanguages(['en-US']);
    const resolved = resolveInitialLanguage();
    expect(SUPPORTED_LANGUAGES).toContain(resolved);
    expect(resolved).toBe(detectBrowserLanguage());
    expect(resolved).toBe(DEFAULT_LANGUAGE);
  });

  it('uses a valid saved preference instead of the browser language', () => {
    setBrowserLanguages(['en-GB']);
    expect(resolveProfileLanguage('tr')).toBe('tr');
  });

  it('uses the supported browser language when the profile preference is missing', () => {
    setBrowserLanguages(['tr-TR']);
    expect(resolveProfileLanguage(undefined)).toBe('tr');
  });

  it('uses English when the profile preference is missing and the browser is unsupported', () => {
    setBrowserLanguages(['de-DE']);
    expect(resolveProfileLanguage(null)).toBe('en');
  });

  it('falls directly to English for an invalid saved preference', () => {
    setBrowserLanguages(['tr-TR']);
    expect(resolveProfileLanguage('de')).toBe('en');
    expect(isSupportedLanguage('de')).toBe(false);
  });
});

describe('i18n namespace loading (lazy)', () => {
  it('lazily loads a namespace on demand via the Vite backend', async () => {
    expect(i18n.hasResourceBundle('en', 'auth')).toBe(false);
    await i18n.loadNamespaces(['auth']);
    expect(i18n.hasResourceBundle('en', 'auth')).toBe(true);
    expect(i18n.t('auth:signIn')).toBe('Sign in');
    expect(i18n.t('auth:email')).toBe('Email');
  });

  it('loads the Turkish namespace and returns translated values', async () => {
    await i18n.loadNamespaces(['auth']);
    await i18n.changeLanguage('tr');
    expect(i18n.t('auth:signIn')).toBe('Giriş yap');
  });
});

describe('i18n formatting helpers', () => {
  it('formats currency using Intl with an explicit locale', () => {
    expect(formatCurrency(1234.5, 'USD', 'en')).toBe('$1,234.50');
  });

  it('formats numbers using Intl', () => {
    expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
  });

  it('formats dates using Intl', () => {
    const date = new Date('2026-07-20T12:00:00Z');
    expect(formatDate(date, 'en', { year: 'numeric', month: 'short', day: 'numeric' })).toBe(
      'Jul 20, 2026',
    );
  });

  it('formats relative time in the future', () => {
    const now = new Date('2026-07-20T12:00:00Z');
    const later = new Date('2026-07-22T12:00:00Z');
    expect(formatRelativeTime(later, 'en', now)).toBe('in 2 days');
  });

  it('formats relative time in the past', () => {
    const now = new Date('2026-07-20T12:00:00Z');
    const earlier = new Date('2026-07-20T11:00:00Z');
    expect(formatRelativeTime(earlier, 'en', now)).toBe('1 hour ago');
  });
});
