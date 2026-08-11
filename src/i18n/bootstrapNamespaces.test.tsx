import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import i18n, { NAMESPACES, bootstrapI18n } from './index';
import { ViteI18nBackend } from './backend';
import enWallet from './locales/en/wallet.json';
import { BalanceCard } from '../components/wallet/BalanceCard';
import { QuickActions } from '../components/wallet/QuickActions';
import { PendingTransfers } from '../components/wallet/PendingTransfers';
import { SendMoneyModal } from '../components/wallet/SendMoneyModal';

// The Send Money modal only needs enough store state to render its form.
vi.mock('../store/useStore', () => ({
  useStore: () => ({
    currentUser: { id: 'child-1', name: 'Ada', role: 'child', familyId: 'fam-1' },
    familyMembers: [
      { id: 'child-2', name: 'Bob', role: 'child', familyId: 'fam-1' },
    ],
    myWallet: { balance: 5000 },
  }),
}));

const RAW_KEYS = [
  'send.title',
  'send.to',
  'send.submit',
  'quickActions.send',
  'balanceCard.label',
  'pendingTransfers.title',
  'accountHeader.subtitle',
];

/**
 * `src/test/setup.ts` blanket-injects resource bundles, which hides the exact
 * production bug. These tests deliberately strip every lazily-loaded namespace
 * first, so the i18n instance is in the same "nothing loaded yet" state as a
 * cold browser session.
 */
function stripLazyNamespaces(): void {
  for (const ns of NAMESPACES) {
    if (ns === 'common' || ns === 'startup') continue;
    for (const lng of ['en', 'tr']) {
      i18n.removeResourceBundle(lng, ns);
      delete (i18n.services.backendConnector.state as Record<string, number>)[`${lng}|${ns}`];
    }
  }
}

function setBrowserLanguages(languages: string[]): void {
  Object.defineProperty(window.navigator, 'languages', {
    value: languages,
    configurable: true,
  });
  Object.defineProperty(window.navigator, 'language', {
    value: languages[0],
    configurable: true,
  });
}

beforeEach(() => {
  stripLazyNamespaces();
});

afterEach(async () => {
  setBrowserLanguages(['en-GB', 'en']);
  await i18n.changeLanguage('en');
});

describe('bootstrapI18n startup resources', () => {
  it('does not await a feature namespace before application mount', async () => {
    expect(i18n.hasResourceBundle('en', 'wallet')).toBe(false);

    await bootstrapI18n();

    expect(i18n.hasResourceBundle('en', 'wallet')).toBe(false);
  });

  it('keeps only the synchronously bundled startup namespaces ready', async () => {
    await bootstrapI18n();
    for (const ns of NAMESPACES) {
      expect(i18n.hasResourceBundle('en', ns)).toBe(ns === 'common' || ns === 'startup');
    }
  });

  it('loads a route namespace on demand after startup initialization', async () => {
    await bootstrapI18n();
    expect(i18n.hasResourceBundle('en', 'wallet')).toBe(false);

    render(
      <>
        <BalanceCard balance={5000} />
        <QuickActions onSend={() => {}} onRequest={() => {}} />
        <PendingTransfers requests={[]} />
      </>,
    );

    expect(await screen.findByText('Available balance')).toBeInTheDocument();
    const html = document.body.innerHTML;
    for (const key of RAW_KEYS) {
      expect(html, `raw key "${key}" leaked into the first paint`).not.toContain(key);
    }
    expect(screen.getAllByText('Send Money').length).toBeGreaterThan(0);
    expect(screen.getByText('Pending transfers')).toBeInTheDocument();
  });

  it('shows translated labels in a modal after its namespace loads on demand', async () => {
    await bootstrapI18n();

    function Harness() {
      return <QuickActions onSend={() => {}} onRequest={() => {}} />;
    }

    const { rerender } = render(<Harness />);
    // Open Send Money on the very next render, with no awaiting in between.
    rerender(
      <>
        <Harness />
        <SendMoneyModal onClose={() => {}} />
      </>,
    );

    expect(await screen.findByRole('heading', { name: 'Send Money' })).toBeInTheDocument();
    const html = document.body.innerHTML;
    for (const key of RAW_KEYS) {
      expect(html, `raw key "${key}" leaked into the modal`).not.toContain(key);
    }
  });

  it('renders translations after a namespace import fails once and then succeeds', async () => {
    // Fresh instance with NO preloaded bundles, wired to a loader that fails
    // its first dynamic import. The backend's bounded retry must recover, so
    // the namespace is never terminally failed for the session.
    let attempts = 0;
    const instance = createInstance();
    await instance
      .use(
        new ViteI18nBackend(() => async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('transient chunk failure');
          return { default: enWallet as unknown as Record<string, unknown> };
        }),
      )
      // Deliberately NOT `.use(initReactI18next)`: that would rebind the
      // library-wide default instance and leak into other tests. The instance
      // is supplied explicitly through <I18nextProvider>.
      .init({
        lng: 'en',
        fallbackLng: 'en',
        ns: ['wallet'],
        defaultNS: 'wallet',
        react: { useSuspense: false },
        interpolation: { escapeValue: false },
      });

    expect(attempts).toBe(2);
    expect(instance.hasResourceBundle('en', 'wallet')).toBe(true);

    render(
      <I18nextProvider i18n={instance}>
        <BalanceCard balance={5000} />
      </I18nextProvider>,
    );
    expect(document.body.innerHTML).not.toContain('balanceCard.label');
    expect(screen.getByText('Available balance')).toBeInTheDocument();
  });

  it('still honours language selection and loads Turkish wallet labels', async () => {
    setBrowserLanguages(['tr-TR', 'tr']);

    await bootstrapI18n();

    expect(i18n.language).toBe('tr');
    expect(document.documentElement.getAttribute('lang')).toBe('tr');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');

    render(
      <>
        <BalanceCard balance={5000} />
        <QuickActions onSend={() => {}} onRequest={() => {}} />
        <PendingTransfers requests={[]} />
      </>,
    );

    expect(await screen.findByText('Kullanılabilir bakiye')).toBeInTheDocument();
    expect(screen.getAllByText('Para Gönder').length).toBeGreaterThan(0);
    expect(screen.getByText('Bekleyen transferler')).toBeInTheDocument();
  });

  it('does not regress the synchronously bundled common/startup namespaces', async () => {
    expect(i18n.hasResourceBundle('en', 'common')).toBe(true);
    expect(i18n.hasResourceBundle('en', 'startup')).toBe(true);
    await bootstrapI18n();
    expect(i18n.hasResourceBundle('en', 'common')).toBe(true);
    expect(i18n.hasResourceBundle('en', 'startup')).toBe(true);
  });

  it('does not rely on component-level hard-coded English fallbacks', () => {
    const sources = import.meta.glob('../components/wallet/*.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;

    // e.g. t('send.title', 'Send Money') or t('send.title', { defaultValue: ... })
    const fallbackPattern = /\bt\(\s*['"][^'"]+['"]\s*,\s*(['"]|\{[^)]*defaultValue)/;
    expect(Object.keys(sources).length).toBeGreaterThan(0);
    for (const [file, source] of Object.entries(sources)) {
      expect(fallbackPattern.test(source), `${file} added a hard-coded fallback`).toBe(false);
    }
  });
});
