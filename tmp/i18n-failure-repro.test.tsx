import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createInstance, type ReadCallback } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import enCommon from '../src/i18n/locales/en/common.json';
import enStartup from '../src/i18n/locales/en/startup.json';
import enWallet from '../src/i18n/locales/en/wallet.json';
import { QuickActions } from '../src/components/wallet/QuickActions';

// Backend that fails the FIRST wallet fetch (simulating a 404 on a hashed
// chunk / offline blip) and succeeds afterwards.
let attempts = 0;
class FlakyBackend {
  type = 'backend' as const;
  init(): void {}
  read(_lng: string, ns: string, callback: ReadCallback): void {
    if (ns === 'wallet') {
      attempts += 1;
      if (attempts === 1) {
        setTimeout(() => callback(new Error('Failed to fetch dynamically imported module'), null), 0);
        return;
      }
    }
    setTimeout(() => callback(null, enWallet as any), 0);
  }
}

describe('lazy ns fetch failure', () => {
  it('shows how long raw keys persist after a failed chunk load', async () => {
    const i18n = createInstance();
    i18n.use(new FlakyBackend()).use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      supportedLngs: ['en', 'tr'],
      ns: ['common', 'startup'],
      defaultNS: 'common',
      resources: { en: { common: enCommon, startup: enStartup } },
      partialBundledLanguages: true,
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
      returnNull: false,
      load: 'languageOnly',
      saveMissing: false,
    });

    render(
      <I18nextProvider i18n={i18n}>
        <QuickActions onSend={() => {}} onRequest={() => {}} />
      </I18nextProvider>,
    );

    await new Promise(r => setTimeout(r, 800));
    console.log('AFTER FAILED LOAD (800ms):', document.body.textContent, '| attempts:', attempts);

    try {
      await waitFor(() => expect(screen.getByText('Send Money')).toBeInTheDocument(), { timeout: 2000 });
      console.log('RECOVERED: yes');
    } catch {
      console.log('RECOVERED: no — raw keys are PERMANENT for the session');
    }
    expect(true).toBe(true);
  });
});
