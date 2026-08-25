import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';
import type { HumanReadableFamilyEvent } from '../../lib/humanReadableFamilyEvent';
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext';
import { MoneyPrivacyToggle } from '../privacy/MoneyPrivacyToggle';
import { HumanReadableEventCard } from './HumanReadableEventCard';

const timestamp = new Date('2026-08-25T10:30:00.000Z').getTime();

function event(overrides: Partial<HumanReadableFamilyEvent>): HumanReadableFamilyEvent {
  return {
    transaction: {
      id: 'wallet-privacy-event',
      timestamp,
      type: 'deposit',
      amountPence: 1937,
      currency: '£',
      unit: 'money',
      direction: 'in',
      status: 'completed',
      title: 'Wallet activity',
      subtitle: 'Supporting wallet amount £64.82',
      icon: 'ArrowDownRight',
      iconBg: 'bg-success-50',
      iconColor: 'text-success-600',
      reversible: true,
      searchText: '',
      category: 'income',
      isPending: false,
      isCompleted: true,
      isReversed: false,
      balanceAfter: 9128,
    },
    eventKind: 'deposit',
    amountPence: 1937,
    unit: 'money',
    currency: '£',
    timestamp,
    status: 'completed',
    sourceType: 'wallet_transaction',
    sourceId: 'wallet-privacy-event',
    headline: '£19.37 added to Alisya’s wallet',
    note: 'Wallet note £55.73',
    metadata: [],
    subject: { id: 'alisya', name: 'Alisya' },
    ...overrides,
  };
}

function assertNoWalletMoneyLeak(container: HTMLElement, originalAmounts: readonly string[]) {
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

describe('HumanReadableEventCard wallet-money privacy', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.loadNamespaces('wallet');
    await i18n.changeLanguage('en');
  });

  it.each([
    ['deposit', event({}), ['19.37', '55.73', '64.82', '91.28']],
    ['withdrawal', event({
      transaction: { ...event({}).transaction, type: 'withdrawal', amountPence: -2846, direction: 'out' },
      eventKind: 'withdrawal',
      amountPence: -2846,
      headline: '£28.46 withdrawn from Alisya’s wallet',
    }), ['28.46', '55.73', '64.82', '91.28']],
    ['transfer', event({
      transaction: { ...event({}).transaction, type: 'transfer_out', amountPence: -3755, direction: 'out' },
      eventKind: 'transfer_out',
      amountPence: -3755,
      headline: '£37.55 sent from Alisya to Mnalium',
      from: { id: 'alisya', name: 'Alisya' },
      to: { id: 'mnalium', name: 'Mnalium' },
    }), ['37.55', '55.73', '64.82', '91.28']],
    ['request', event({
      transaction: { ...event({}).transaction, type: 'transfer_request', amountPence: -4664, direction: 'out' },
      eventKind: 'transfer_request',
      amountPence: -4664,
      headline: '£46.64 requested from Alisya by Mnalium',
      from: { id: 'alisya', name: 'Alisya' },
      to: { id: 'mnalium', name: 'Mnalium' },
    }), ['46.64', '55.73', '64.82', '91.28']],
    ['money request', event({
      transaction: { ...event({}).transaction, type: 'money_request', amountPence: -5773, direction: 'out' },
      eventKind: 'money_request',
      amountPence: -5773,
      headline: '£57.73 requested by Ada',
      actor: { id: 'ada', name: 'Ada' },
    }), ['57.73', '55.73', '64.82', '91.28']],
  ] as const)('fixture J masks every wallet-money surface for a %s history card', (_kind, value, originalAmounts) => {
    const { container } = render(
      <MoneyPrivacyProvider>
        <MoneyPrivacyToggle />
        <HumanReadableEventCard event={value} onClick={vi.fn()} />
      </MoneyPrivacyProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));

    const card = screen.getByTestId('human-readable-event-card');
    assertNoWalletMoneyLeak(container, originalAmounts);
    for (const originalAmount of originalAmounts) {
      expect(card).not.toHaveAccessibleName(new RegExp(originalAmount.replace('.', '\\.'), 'u'));
    }
    expect(card).toHaveTextContent('£••••');
  });

  it('fixture J keeps points visible while wallet money is hidden', () => {
    const { container } = render(
      <MoneyPrivacyProvider>
        <MoneyPrivacyToggle />
        <HumanReadableEventCard
          event={event({
            transaction: {
              ...event({}).transaction,
              type: 'reward_redemption',
              unit: 'points',
              amountPence: -500,
              direction: 'out',
              balanceAfter: undefined,
            },
            eventKind: 'reward_redemption',
            amountPence: -500,
            unit: 'points',
            headline: '500 points redeemed by Alisya',
            note: 'Receipt total £55.73',
          })}
          onClick={vi.fn()}
        />
      </MoneyPrivacyProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));

    expect(screen.getByTestId('human-readable-event-card')).toHaveTextContent('-500 points');
    assertNoWalletMoneyLeak(container, ['55.73']);
  });

  it('fixture J leaves goal titles and amounts visible and accessible under wallet privacy', () => {
    render(
      <MoneyPrivacyProvider>
        <MoneyPrivacyToggle />
        <HumanReadableEventCard
          event={event({
            goalTitle: 'Bike £23.45',
            headline: '£19.37 added to Alisya’s wallet',
            note: 'Wallet note £55.73',
          })}
          onClick={vi.fn()}
        />
      </MoneyPrivacyProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));

    const card = screen.getByTestId('human-readable-event-card');
    expect(card).toHaveTextContent('Bike £23.45');
    expect(card).toHaveAccessibleName(/Bike £23\.45/u);
    expect(card).not.toHaveAccessibleName(/19\.37|55\.73/u);
  });
});
