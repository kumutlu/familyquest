import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext';
import { MoneyPrivacyToggle } from '../privacy/MoneyPrivacyToggle';
import type { HumanReadableFamilyEvent } from '../../lib/humanReadableFamilyEvent';
import { HumanReadableEventCard } from './HumanReadableEventCard';

const timestamp = new Date('2026-08-25T10:30:00.000Z').getTime();

function event(overrides: Partial<HumanReadableFamilyEvent>): HumanReadableFamilyEvent {
  return {
    transaction: {
      id: 'wallet-1',
      timestamp,
      type: 'deposit',
      amountPence: 100,
      currency: '£',
      unit: 'money',
      direction: 'in',
      status: 'completed',
      title: 'Money added',
      subtitle: '',
      icon: 'ArrowDownRight',
      iconBg: 'bg-success-50',
      iconColor: 'text-success-600',
      reversible: true,
      searchText: '',
      category: 'income',
      isPending: false,
      isCompleted: true,
      isReversed: false,
      source: 'wallet_transaction',
      sourceId: 'wallet-1',
    },
    eventKind: 'deposit',
    amountPence: 100,
    unit: 'money',
    currency: '£',
    timestamp,
    status: 'completed',
    sourceType: 'wallet_transaction',
    sourceId: 'wallet-1',
    headline: '£1.00 added to Mostium’s wallet',
    metadata: [],
    ...overrides,
  };
}

function renderCard(value: HumanReadableFamilyEvent, onClick = vi.fn()) {
  render(
    <MoneyPrivacyProvider>
      <HumanReadableEventCard event={value} onClick={onClick} />
    </MoneyPrivacyProvider>,
  );
  return onClick;
}

beforeEach(async () => {
  localStorage.clear();
  await i18n.loadNamespaces('wallet');
  await i18n.changeLanguage('en');
});

describe('HumanReadableEventCard', () => {
  it.each([
    ['parent deposit', event({
      subject: { id: 'mnalium', name: 'Mnalium' },
      actor: { id: 'parent-ada', name: 'Ada' },
      amountPence: 9000,
      headline: '£90.00 added to Mnalium’s wallet',
    }), '£90.00 added to Mnalium’s wallet', '+£90.00', 'Performed by: Ada'],
    ['parent withdrawal', event({
      eventKind: 'withdrawal',
      subject: { id: 'alisya', name: 'Alisya' },
      actor: { id: 'parent-ada', name: 'Ada' },
      amountPence: -255,
      headline: '£2.55 withdrawn from Alisya’s wallet',
    }), '£2.55 withdrawn from Alisya’s wallet', '-£2.55', 'Performed by: Ada'],
    ['child transfer', event({
      eventKind: 'transfer_out',
      subject: { id: 'alisya', name: 'Alisya' },
      from: { id: 'alisya', name: 'Alisya' },
      to: { id: 'mnalium', name: 'Mnalium' },
      actor: { id: 'alisya', name: 'Alisya' },
      approver: { id: 'parent-ada', name: 'Ada' },
      amountPence: -300,
      headline: '£3.00 sent from Alisya to Mnalium',
    }), '£3.00 sent from Alisya to Mnalium', '-£3.00', 'Approved by: Ada'],
  ] as const)('renders a factual %s hierarchy', (_label, value, headline, amount, attribution) => {
    const onClick = renderCard(value);

    expect(screen.getByText(headline)).toBeInTheDocument();
    expect(screen.getByText(amount)).toBeInTheDocument();
    expect(screen.getByText(attribution)).toBeInTheDocument();
    expect(screen.getByTestId('history-subject-marker')).toHaveTextContent(value.subject?.name?.[0] ?? '');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(value.subject?.name ?? headline) }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('keeps notes secondary and labels a persisted reverser without inventing reward approval', () => {
    renderCard(event({
      transaction: {
        ...event({}).transaction,
        id: 'reward-1',
        type: 'reward_redemption',
        unit: 'points',
        amountPence: -500,
        direction: 'out',
        status: 'reversed',
        icon: 'Gift',
        isReversed: true,
        isCompleted: false,
        category: 'reward',
      },
      eventKind: 'reward_redemption',
      subject: { id: 'mostium', name: 'Mostium' },
      actor: { id: 'mostium', name: 'Mostium' },
      reverser: { id: 'parent-bob', name: 'Bob' },
      amountPence: -500,
      unit: 'points',
      note: 'veciiz',
      status: 'reversed',
      rewardTitle: 'Movie night',
      headline: '500 points redeemed by Mostium',
    }));

    expect(screen.getByText('500 points redeemed by Mostium')).toBeInTheDocument();
    expect(screen.getByText('Movie night')).toBeInTheDocument();
    expect(screen.getByText('-500 points')).toBeInTheDocument();
    expect(screen.getByText('Performed by: Mostium')).toBeInTheDocument();
    expect(screen.getByText('Reversed by: Bob')).toBeInTheDocument();
    expect(screen.queryByText(/Approved by:/)).not.toBeInTheDocument();
    expect(screen.getByText('veciiz').parentElement).toHaveTextContent('Note: veciiz');
    expect(screen.getAllByText(/veciiz/)).toHaveLength(1);
    expect(screen.getByText('Reversed')).toBeInTheDocument();
  });

  it('shows the stored reversal completion time separately from the original event time', () => {
    renderCard(event({
      status: 'reversed',
      reverser: { id: 'parent-bob', name: 'Bob' },
      reversalOccurredAt: new Date('2026-08-26T11:45:00.000Z').getTime(),
    }));

    expect(screen.getByText('Reversed by: Bob')).toBeInTheDocument();
    expect(screen.getByText(/Reversed at: Aug 26, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Aug 25, 2026/)).toBeInTheDocument();
  });

  it('omits the history date when the source did not persist one', () => {
    renderCard(event({ timestamp: undefined }));

    expect(screen.queryByText(/1970/)).not.toBeInTheDocument();
  });

  it('includes every visible structured name and balance in the accessible row name', () => {
    renderCard(event({
      subject: { id: 'mostium', name: 'Mostium' },
      rewardTitle: 'Movie night',
      goalTitle: 'Bike fund',
      fundName: 'Pet Box',
      transaction: { ...event({}).transaction, balanceAfter: 1234 },
    }));

    expect(screen.getByRole('button')).toHaveAccessibleName(
      /Movie night\. Bike fund\. Pet Box\..*Balance: £12\.34/,
    );
  });

  it('masks a visible balance in the accessible row name when money privacy is enabled', () => {
    render(
      <MoneyPrivacyProvider>
        <MoneyPrivacyToggle />
        <HumanReadableEventCard
          event={event({
            subject: { id: 'mostium', name: 'Mostium' },
            transaction: { ...event({}).transaction, balanceAfter: 1234 },
          })}
          onClick={vi.fn()}
        />
      </MoneyPrivacyProvider>,
    );

    const card = screen.getByTestId('human-readable-event-card');
    expect(card).toHaveAccessibleName(/Balance: £12\.34/);
    fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));
    expect(card).toHaveAccessibleName(/Balance: £••••/);
    expect(card).not.toHaveAccessibleName(/12\.34/);
  });

  it('masks wallet-money titles but keeps goal amounts visible when money privacy is enabled', () => {
    render(
      <MoneyPrivacyProvider>
        <MoneyPrivacyToggle />
        <HumanReadableEventCard
          event={event({
            subject: { id: 'mostium', name: 'Mostium' },
            rewardTitle: 'Movie £12.34',
            goalTitle: 'Bike £23.45',
            fundName: 'Pet Box £34.56',
          })}
          onClick={vi.fn()}
        />
      </MoneyPrivacyProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));
    const card = screen.getByTestId('human-readable-event-card');
    expect(card).toHaveTextContent('Movie £••••');
    expect(card).toHaveTextContent('Bike £23.45');
    expect(card).toHaveTextContent('Pet Box £••••');
    expect(card).toHaveAccessibleName(/Bike £23\.45/);
    expect(card).not.toHaveAccessibleName(/12\.34|34\.56/);
  });

  it('masks wallet-money prose and balance on a points event without masking the points amount', () => {
    render(
      <MoneyPrivacyProvider>
        <MoneyPrivacyToggle />
        <HumanReadableEventCard
          event={event({
            transaction: {
              ...event({}).transaction,
              type: 'unknown',
              unit: 'points',
              amountPence: -500,
              direction: 'out',
              category: 'adjustment',
              balanceAfter: 1234,
            },
            eventKind: 'unknown',
            amountPence: -500,
            unit: 'points',
            headline: 'Points adjustment £9.87',
            note: 'Reason £45.67',
            rewardTitle: 'Movie £12.34',
            goalTitle: 'Bike £23.45',
            fundName: 'Pet Box £34.56',
          })}
          onClick={vi.fn()}
        />
      </MoneyPrivacyProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));
    const card = screen.getByTestId('human-readable-event-card');
    expect(card).toHaveTextContent('-500 points');
    expect(card).toHaveTextContent('Points adjustment £••••');
    expect(card).toHaveTextContent('Movie £••••');
    expect(card).toHaveTextContent('Bike £23.45');
    expect(card).toHaveTextContent('Pet Box £••••');
    expect(card).toHaveTextContent('Reason £••••');
    expect(card).toHaveTextContent('Balance: £••••');
    expect(card).toHaveAccessibleName(/Bike £23\.45/);
    expect(card).not.toHaveAccessibleName(/9\.87|12\.34|34\.56|45\.67/);
    expect(card).not.toHaveAccessibleName(/Balance: £12\.34/);
  });

  it('localizes a transfer request with stored endpoints in Turkish', async () => {
    await i18n.changeLanguage('tr');

    renderCard(event({
      transaction: {
        ...event({}).transaction,
        type: 'transfer_request',
        amountPence: -400,
        direction: 'out',
      },
      eventKind: 'transfer_request',
      amountPence: -400,
      currency: '₺',
      from: { id: 'alex', name: 'Alex' },
      to: { id: 'sam', name: 'Sam' },
      headline: 'Transfer request',
    }));

    expect(screen.getByText(/Alex tarafından Sam kişisine gönderildi/)).toBeInTheDocument();
    expect(screen.queryByText('Transfer request')).not.toBeInTheDocument();
  });
});
