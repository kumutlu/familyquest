import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';
import type { HumanReadableFamilyEvent } from '../../lib/humanReadableFamilyEvent';
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext';
import { MoneyPrivacyToggle } from '../privacy/MoneyPrivacyToggle';
import { TransactionDetailsSheet } from './TransactionDetailsSheet';

const timestamp = new Date('2026-08-25T10:30:00.000Z').getTime();

function event(overrides: Partial<HumanReadableFamilyEvent> = {}): HumanReadableFamilyEvent {
  return {
    transaction: {
      id: 'wallet-technical-reference-123456',
      timestamp,
      type: 'transfer_out',
      amountPence: -300,
      currency: '£',
      unit: 'money',
      direction: 'out',
      status: 'reversed',
      title: 'Legacy title that must not be the event detail',
      subtitle: 'legacy-relationship-id',
      icon: 'ArrowUpRight',
      iconBg: 'bg-gray-100',
      iconColor: 'text-gray-900',
      reversalReason: 'Duplicate transfer',
      reversible: true,
      searchText: '',
      category: 'expense',
      isPending: false,
      isCompleted: false,
      isReversed: true,
    },
    eventKind: 'transfer_out',
    subject: { id: 'child-private-id', name: 'Alisya' },
    actor: { id: 'actor-private-id', name: 'Alisya' },
    approver: { id: 'approver-private-id', name: 'Ada' },
    reverser: { id: 'reverser-private-id', name: 'Bob' },
    from: { id: 'from-private-id', name: 'Alisya' },
    to: { id: 'to-private-id', name: 'Mnalium' },
    amountPence: -300,
    unit: 'money',
    currency: '£',
    note: 'Birthday share',
    timestamp,
    reversalOccurredAt: new Date('2026-08-26T11:45:00.000Z').getTime(),
    status: 'reversed',
    sourceType: 'wallet_transaction',
    sourceId: 'source-private-id',
    headline: '£3.00 sent from Alisya to Mnalium',
    metadata: [],
    ...overrides,
  };
}

function renderSheet(value: HumanReadableFamilyEvent) {
  render(
    <MoneyPrivacyProvider>
      <TransactionDetailsSheet
        isOpen
        onClose={vi.fn()}
        event={value}
        currency="£"
      />
    </MoneyPrivacyProvider>,
  );
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

describe('TransactionDetailsSheet audit fields', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.loadNamespaces(['common', 'wallet', 'goals', 'rewards', 'reversals']);
    await i18n.changeLanguage('en');
  });

  it('renders every supported structured audit field without exposing technical references', () => {
    renderSheet(event());

    expect(screen.getByText('Event')).toBeInTheDocument();
    expect(screen.getAllByText('£3.00 sent from Alisya to Mnalium').length).toBeGreaterThan(0);
    expect(screen.getByText('Child')).toBeInTheDocument();
    expect(screen.getAllByText('Alisya').length).toBeGreaterThan(0);
    expect(screen.getByText('Amount')).toBeInTheDocument();
    expect(screen.getAllByText('-£3.00').length).toBeGreaterThan(0);
    expect(screen.getByText('From')).toBeInTheDocument();
    expect(screen.getByText('To')).toBeInTheDocument();
    expect(screen.getByText('Performed by')).toBeInTheDocument();
    expect(screen.getByText('Approved by')).toBeInTheDocument();
    expect(screen.getByText('Reversed by')).toBeInTheDocument();
    expect(screen.getByText('Reversed at')).toBeInTheDocument();
    expect(screen.getByText('Date / time')).toBeInTheDocument();
    expect(screen.getByText('Note')).toBeInTheDocument();
    expect(screen.getByText('Birthday share')).toBeInTheDocument();
    expect(screen.getByText('Reason')).toBeInTheDocument();
    expect(screen.getByText('Duplicate transfer')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getAllByText('Reversed').length).toBeGreaterThan(0);
    expect(screen.queryByText('Reference')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('123456');
    expect(document.body).not.toHaveTextContent('source-private-id');
    expect(document.body).not.toHaveTextContent('legacy-relationship-id');
  });

  it('omits an unavailable original date and renders the stored reversal completion time', () => {
    renderSheet(event({
      timestamp: undefined,
      reversalOccurredAt: new Date('2026-08-26T11:45:00.000Z').getTime(),
    }));

    expect(screen.queryByText('Date / time')).not.toBeInTheDocument();
    expect(screen.getByText('Reversed at')).toBeInTheDocument();
    expect(screen.getByText(/Aug 26, 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/1970/)).not.toBeInTheDocument();
  });

  it('omits unavailable roles and never manufactures names from raw identifiers', () => {
    renderSheet(event({
      subject: undefined,
      actor: undefined,
      approver: undefined,
      reverser: undefined,
      from: undefined,
      to: undefined,
      note: undefined,
      transaction: {
        ...event().transaction,
        reversalReason: undefined,
        isReversed: false,
        status: 'completed',
      },
      status: 'completed',
      headline: '£3.00 transferred',
    }));

    expect(screen.getByText('Event')).toBeInTheDocument();
    expect(screen.getAllByText('£3.00 transferred').length).toBeGreaterThan(0);
    expect(screen.getByText('Amount')).toBeInTheDocument();
    expect(screen.getByText('Date / time')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.queryByText('Child')).not.toBeInTheDocument();
    expect(screen.queryByText('From')).not.toBeInTheDocument();
    expect(screen.queryByText('To')).not.toBeInTheDocument();
    expect(screen.queryByText('Performed by')).not.toBeInTheDocument();
    expect(screen.queryByText('Approved by')).not.toBeInTheDocument();
    expect(screen.queryByText('Reversed by')).not.toBeInTheDocument();
    expect(screen.queryByText('Note')).not.toBeInTheDocument();
    expect(screen.queryByText('Reason')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('child-private-id');
    expect(document.body).not.toHaveTextContent('actor-private-id');
  });

  it('does not derive a performer from a legacy parent reference on a structured event', () => {
    render(
      <MoneyPrivacyProvider>
        <TransactionDetailsSheet
          isOpen
          onClose={vi.fn()}
          event={event({
            actor: undefined,
            transaction: { ...event().transaction, parentRef: 'parent-private-id' },
          })}
          currency="£"
        />
      </MoneyPrivacyProvider>,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('Performed by')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('parent-private-id');
  });

  it('uses localized Turkish labels for structured audit fields', async () => {
    await i18n.changeLanguage('tr');

    renderSheet(event());

    expect(screen.getByText('Etkinlik')).toBeInTheDocument();
    expect(screen.getByText('Tutar')).toBeInTheDocument();
    expect(screen.getByText('Gönderen')).toBeInTheDocument();
    expect(screen.getByText('Alıcı')).toBeInTheDocument();
    expect(screen.getByText('İşlemi yapan')).toBeInTheDocument();
    expect(screen.getByText('Onaylayan')).toBeInTheDocument();
    expect(screen.getByText('Geri alan')).toBeInTheDocument();
    expect(screen.getByText('Tarih / saat')).toBeInTheDocument();
  });

  it('renders points as points rather than currency', () => {
    renderSheet(event({
      transaction: {
        ...event().transaction,
        type: 'reward_redemption',
        amountPence: -500,
        unit: 'points',
        direction: 'out',
        isReversed: false,
        status: 'completed',
        reversalReason: undefined,
      },
      eventKind: 'reward_redemption',
      amountPence: -500,
      unit: 'points',
      status: 'completed',
      reverser: undefined,
      headline: '500 points redeemed by Alisya',
    }));

    expect(screen.getAllByText('-500 points').length).toBeGreaterThan(0);
    expect(screen.queryByText(/£5\.00/)).not.toBeInTheDocument();
  });

  it('fixture J removes wallet-money digits from the detail sheet while retaining points', () => {
    const privacyEvent = event({
      amountPence: -1937,
      headline: '£19.37 sent from Alisya to Mnalium',
      note: 'Wallet note £55.73',
      transaction: {
        ...event().transaction,
        amountPence: -1937,
        direction: 'out',
        title: '£19.37 sent from Alisya to Mnalium',
        reversalReason: 'Receipt total £64.82',
      },
    });

    const { container } = render(
      <MoneyPrivacyProvider>
        <MoneyPrivacyToggle />
        <TransactionDetailsSheet
          isOpen
          onClose={vi.fn()}
          event={privacyEvent}
          currency="£"
        />
      </MoneyPrivacyProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));

    assertNoWalletMoneyLeak(container, ['19.37', '55.73', '64.82']);
    expect(screen.getByRole('dialog')).toHaveTextContent('£••••');

    const pointsEvent = event({
      transaction: {
        ...event().transaction,
        type: 'reward_redemption',
        amountPence: -500,
        unit: 'points',
        direction: 'out',
        isReversed: false,
        status: 'completed',
        reversalReason: undefined,
      },
      eventKind: 'reward_redemption',
      amountPence: -500,
      unit: 'points',
      status: 'completed',
      reverser: undefined,
      headline: '500 points redeemed by Alisya',
    });

    renderSheet(pointsEvent);
    expect(screen.getAllByText('-500 points').length).toBeGreaterThan(0);
  });
});
