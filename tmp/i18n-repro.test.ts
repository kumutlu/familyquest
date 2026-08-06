import { describe, expect, it } from 'vitest';
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ViteI18nBackend } from '../src/i18n/backend';
import enCommon from '../src/i18n/locales/en/common.json';
import trCommon from '../src/i18n/locales/tr/common.json';
import enStartup from '../src/i18n/locales/en/startup.json';
import trStartup from '../src/i18n/locales/tr/startup.json';

// Mirrors src/i18n/config.ts EXACTLY, on a fresh instance so the global
// test-setup preloaded bundles cannot mask the production behaviour.
function makeInstance() {
  const instance = createInstance();
  instance
    .use(new ViteI18nBackend())
    .use(initReactI18next)
    .init({
      lng: 'en',
      fallbackLng: 'en',
      supportedLngs: ['en', 'tr'],
      ns: ['common', 'startup'],
      defaultNS: 'common',
      resources: {
        en: { common: enCommon, startup: enStartup },
        tr: { common: trCommon, startup: trStartup },
      },
      partialBundledLanguages: true,
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
      returnNull: false,
      load: 'languageOnly',
      saveMissing: false,
    });
  return instance;
}

describe('i18n lazy namespace repro', () => {
  it('reports whether the wallet ns is considered already loaded', async () => {
    const i18n = makeInstance();
    console.log('BACKEND CONNECTOR?', !!(i18n.services as any).backendConnector?.backend);
    console.log('hasLoadedNamespace(wallet) BEFORE load:', i18n.hasLoadedNamespace('wallet'));
    console.log('t(wallet:send.title) BEFORE load:', i18n.t('wallet:send.title'));

    await i18n.loadNamespaces('wallet');

    console.log('hasLoadedNamespace(wallet) AFTER load:', i18n.hasLoadedNamespace('wallet'));
    console.log('t(wallet:send.title) AFTER load:', i18n.t('wallet:send.title'));
    console.log('store has wallet:', !!i18n.store.getResourceBundle('en', 'wallet'));
    expect(true).toBe(true);
  });
});
