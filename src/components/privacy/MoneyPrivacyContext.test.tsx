import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MoneyPrivacyProvider, useMoneyPrivacy } from './MoneyPrivacyContext';
import { MoneyPrivacyToggle } from './MoneyPrivacyToggle';
import { MoneyValue } from './MoneyValue';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import i18n from '../../i18n/config';

const store = vi.hoisted(() => ({
  currentUser: { id: 'user-a' } as { id: string } | null,
  familyData: null as { currencyCode?: 'GBP' | 'USD' | 'EUR' | 'TRY'; currency?: string } | null,
}));

vi.mock('../../store/useStore', () => ({
  useStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

function Probe() {
  const { isMoneyHidden, maskFormattedMoney } = useMoneyPrivacy();

  return <p>{isMoneyHidden ? maskFormattedMoney('£12.34') : '£12.34'}</p>;
}

function PrivacyControls() {
  return (
    <>
      <MoneyPrivacyToggle />
      <MoneyValue>£12.34</MoneyValue>
    </>
  );
}

describe('MoneyPrivacyProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    store.currentUser = { id: 'user-a' };
    store.familyData = null;
  });

  it('defaults to visible and persists a toggle for the authenticated user', async () => {
    const user = userEvent.setup();

    render(
      <MoneyPrivacyProvider>
        <Probe />
        <MoneyPrivacyToggle />
      </MoneyPrivacyProvider>,
    );

    expect(screen.getByText('£12.34')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide money amounts' }));

    expect(screen.queryByText('£12.34')).not.toBeInTheDocument();
    expect(localStorage.getItem('queki.moneyPrivacy:user-a')).toBe('true');
  });

  it('restores the same user preference after remounting', async () => {
    localStorage.setItem('queki.moneyPrivacy:user-a', 'true');

    const { unmount } = render(
      <MoneyPrivacyProvider><Probe /></MoneyPrivacyProvider>,
    );

    await waitFor(() => expect(screen.getByText('£••••')).toBeInTheDocument());
    unmount();

    render(<MoneyPrivacyProvider><Probe /></MoneyPrivacyProvider>);

    await waitFor(() => expect(screen.getByText('£••••')).toBeInTheDocument());
  });

  it('resets to visible when a different user has no preference', async () => {
    localStorage.setItem('queki.moneyPrivacy:user-a', 'true');

    const { rerender } = render(
      <MoneyPrivacyProvider><Probe /></MoneyPrivacyProvider>,
    );
    await waitFor(() => expect(screen.getByText('£••••')).toBeInTheDocument());

    store.currentUser = { id: 'user-b' };
    rerender(<MoneyPrivacyProvider><Probe /></MoneyPrivacyProvider>);

    await waitFor(() => expect(screen.getByText('£12.34')).toBeInTheDocument());
  });

  it('falls back to visible for malformed persisted data', async () => {
    localStorage.setItem('queki.moneyPrivacy:user-a', 'not-a-boolean');

    render(<MoneyPrivacyProvider><Probe /></MoneyPrivacyProvider>);

    await waitFor(() => expect(screen.getByText('£12.34')).toBeInTheDocument());
  });

  it('uses accessible labels and masks without retaining any original digits', async () => {
    const user = userEvent.setup();

    render(
      <MoneyPrivacyProvider>
        <PrivacyControls />
      </MoneyPrivacyProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Hide money amounts' }));

    expect(screen.getByRole('button', { name: 'Show money amounts' })).toBeInTheDocument();
    expect(screen.getByText('£••••')).toBeInTheDocument();
    expect(screen.queryByText(/12\.34/)).not.toBeInTheDocument();
    expect(screen.getByText('£••••').textContent).not.toMatch(/\d/);
  });

  it('masks only CurrencyDisplay values explicitly marked as wallet money', async () => {
    localStorage.setItem('queki.moneyPrivacy:user-a', 'true');

    render(
      <MoneyPrivacyProvider>
        <CurrencyDisplay amountPence={1234} />
        <CurrencyDisplay amountPence={1234} privacy="wallet" />
      </MoneyPrivacyProvider>,
    );

    await waitFor(() => expect(screen.getByText('£••••')).toBeInTheDocument());
    expect(screen.getByText('£12.34')).toBeInTheDocument();
  });

  it.each([
    ['en', 'USD', '$••••'],
    ['tr', 'TRY', '₺••••'],
  ] as const)('preserves %s %s currency context while removing every digit', async (language, currencyCode, expectedMask) => {
    localStorage.setItem('queki.moneyPrivacy:user-a', 'true');
    store.familyData = { currencyCode };
    await act(async () => { await i18n.changeLanguage(language); });

    render(
      <MoneyPrivacyProvider>
        <CurrencyDisplay amountPence={12345} privacy="wallet" />
      </MoneyPrivacyProvider>,
    );

    const masked = await screen.findByText(expectedMask);
    expect(masked.textContent).not.toMatch(/\p{Nd}/u);
  });

  it('retains explicit GBP, USD, EUR and TRY codes while masking their values', async () => {
    localStorage.setItem('queki.moneyPrivacy:user-a', 'true');

    render(
      <MoneyPrivacyProvider>
        {(['GBP', 'USD', 'EUR', 'TRY'] as const).map(code => (
          <MoneyValue key={code}>{`${code} 12.34`}</MoneyValue>
        ))}
      </MoneyPrivacyProvider>,
    );

    for (const code of ['GBP', 'USD', 'EUR', 'TRY']) {
      expect(await screen.findByText(`${code} ••••`)).toBeInTheDocument();
    }
    expect(document.body.textContent).not.toMatch(/\p{Nd}/u);
  });
});
