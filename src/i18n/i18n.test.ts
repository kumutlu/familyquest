import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n, { DEFAULT_LANGUAGE, NAMESPACES, SUPPORTED_LANGUAGES } from './config';
import { detectBrowserLanguage, resolveInitialLanguage } from './index';
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatRelativeTime,
} from './format';

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
    expect(i18n.t('common:appName')).toBe('FamilyQuest');
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
