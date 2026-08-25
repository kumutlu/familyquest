import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n/config';
import type { HumanReadableFamilyEvent } from '../../lib/humanReadableFamilyEvent';
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext';
import { MoneyPrivacyToggle } from '../privacy/MoneyPrivacyToggle';
import { WalletActivityRow, type WalletActivityEvent } from './WalletActivityRow';

const timestamp = new Date('2026-08-25T10:00:00.000Z').getTime();

function event(overrides: Partial<WalletActivityEvent> = {}): WalletActivityEvent {
  return {
    transaction: {
      id: 'recent-wallet-privacy-row',
      timestamp,
      type: 'deposit',
      amountPence: 1937,
      currency: '£',
      unit: 'money',
      direction: 'in',
      status: 'completed',
      title: '£19.37 added to Alisya’s wallet',
      subtitle: 'Recent wallet balance £64.82',
      icon: 'ArrowDownRight',
      iconBg: 'bg-success-50',
      iconColor: 'text-success-600',
      reversible: true,
      searchText: '',
      category: 'income',
      isPending: false,
      isCompleted: true,
      isReversed: false,
    } as HumanReadableFamilyEvent['transaction'],
    eventKind: 'deposit',
    amountPence: 1937,
    unit: 'money',
    currency: '£',
    timestamp,
    status: 'completed',
    sourceType: 'wallet_transaction',
    sourceId: 'recent-wallet-privacy-row',
    headline: '£19.37 added to Alisya’s wallet',
    note: 'Wallet note £55.73',
    metadata: ['Balance after transaction: £91.28'],
    ...overrides,
  };
}

function assertNoWalletMoneyLeak(container: HTMLElement, originalAmounts: string[]) {
  const allText = container.textContent ?? '';
  const labelledOrTitledText = Array.from(container.querySelectorAll<HTMLElement>('[aria-label], [title]'))
    .flatMap(element => [element.getAttribute('aria-label') ?? '', element.getAttribute('title') ?? ''])
    .join(' ');
  const hiddenText = Array.from(container.querySelectorAll<HTMLElement>('[aria-hidden="true"], [hidden]'))
    .map(element => element.textContent ?? '')
    .join(' ');

  for (const originalAmount of originalAmounts) {
    expect(allText).not.toContain(originalAmount);
    expect(labelledOrTitledText).not.toContain(originalAmount);
    expect(hiddenText).not.toContain(originalAmount);
  }
}

describe('WalletActivityRow wallet-money privacy', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.loadNamespaces('wallet');
    await i18n.changeLanguage('en');
  });

  it('fixture J keeps original wallet digits out of recent-wallet text, labels, titles, and hidden DOM', () => {
    const { container } = render(
      <MoneyPrivacyProvider>
        <MoneyPrivacyToggle />
        <WalletActivityRow event={event()} />
      </MoneyPrivacyProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));

    assertNoWalletMoneyLeak(container, ['19.37', '55.73', '64.82', '91.28']);
    expect(container).toHaveTextContent('£••••');
  });

  it('fixture J leaves points visible when wallet money privacy is enabled', () => {
    render(
      <MoneyPrivacyProvider>
        <MoneyPrivacyToggle />
        <WalletActivityRow event={event({
          transaction: {
            ...event().transaction,
            type: 'reward_redemption',
            unit: 'points',
            amountPence: -500,
            direction: 'out',
          },
          eventKind: 'reward_redemption',
          amountPence: -500,
          unit: 'points',
          headline: '500 points redeemed by Alisya',
          note: undefined,
          metadata: ['500 points spent'],
        })} />
      </MoneyPrivacyProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));

    expect(screen.getByText('-500 points')).toBeInTheDocument();
    expect(screen.getByText('500 points redeemed by Alisya')).toBeInTheDocument();
    expect(screen.getByText('500 points spent')).toBeInTheDocument();
  });
});
