import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { ViteI18nBackend } from '../src/i18n/backend';
import enCommon from '../src/i18n/locales/en/common.json';
import trCommon from '../src/i18n/locales/tr/common.json';
import enStartup from '../src/i18n/locales/en/startup.json';
import trStartup from '../src/i18n/locales/tr/startup.json';
import { QuickActions } from '../src/components/wallet/QuickActions';

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

describe('react-i18next lazy ns repro (production boot shape)', () => {
  it('QuickActions resolves wallet keys after lazy load', async () => {
    const i18n = makeInstance();
    render(
      <I18nextProvider i18n={i18n}>
        <QuickActions onSend={() => {}} onRequest={() => {}} />
      </I18nextProvider>,
    );

    console.log('FIRST PAINT HTML:', document.body.textContent);

    await waitFor(() => {
      console.log('POLL HTML:', document.body.textContent);
      expect(screen.getByText('Send Money')).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
