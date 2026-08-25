import { render as rtlRender, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n/config';
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext';
import type { HumanReadableFamilyEvent } from '../../lib/humanReadableFamilyEvent';
import { WalletActivityRow, type WalletActivityEvent } from './WalletActivityRow';

const timestamp = new Date('2026-08-25T10:00:00.000Z').getTime();

function event(overrides: Partial<WalletActivityEvent>): WalletActivityEvent {
  return {
    transaction: {} as HumanReadableFamilyEvent['transaction'],
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

function renderRow(value: WalletActivityEvent) {
  return rtlRender(
    <MoneyPrivacyProvider>
      <WalletActivityRow event={value} />
    </MoneyPrivacyProvider>,
  );
}

beforeEach(async () => {
  await i18n.loadNamespaces('wallet');
  await i18n.changeLanguage('en');
});

describe('WalletActivityRow', () => {
  it.each([
    ['A: parent deposit', event({
      subject: { id: 'mnalium', name: 'Mnalium' },
      actor: { id: 'parent-ada', name: 'Ada' },
      amountPence: 9000,
      headline: '£90.00 added to Mnalium’s wallet',
      metadata: ['Performed by: Ada'],
    }), '£90.00 added to Mnalium’s wallet', '+£90.00', 'Performed by: Ada'],
    ['B: parent withdrawal', event({
      eventKind: 'withdrawal',
      subject: { id: 'alisya', name: 'Alisya' },
      actor: { id: 'parent-ada', name: 'Ada' },
      amountPence: -255,
      headline: '£2.55 withdrawn from Alisya’s wallet',
      metadata: ['Performed by: Ada'],
    }), '£2.55 withdrawn from Alisya’s wallet', '-£2.55', 'Performed by: Ada'],
    ['C: Alisya to Mnalium transfer', event({
      eventKind: 'transfer_out',
      subject: { id: 'alisya', name: 'Alisya' },
      actor: { id: 'alisya', name: 'Alisya' },
      from: { id: 'alisya', name: 'Alisya' },
      to: { id: 'mnalium', name: 'Mnalium' },
      amountPence: -300,
      headline: '£3.00 sent from Alisya to Mnalium',
      metadata: ['Performed by: Alisya', 'Approved by: Ada'],
    }), '£3.00 sent from Alisya to Mnalium', '-£3.00', 'Performed by: Alisya'],
    ['D: Mnalium to Mostium transfer', event({
      eventKind: 'transfer_in',
      subject: { id: 'mostium', name: 'Mostium' },
      actor: { id: 'mnalium', name: 'Mnalium' },
      from: { id: 'mnalium', name: 'Mnalium' },
      to: { id: 'mostium', name: 'Mostium' },
      amountPence: 130,
      headline: '£1.30 sent from Mnalium to Mostium',
      metadata: ['Performed by: Mnalium', 'Approved by: Bob'],
    }), '£1.30 sent from Mnalium to Mostium', '+£1.30', 'Performed by: Mnalium'],
  ] as const)('%s renders the semantic title, signed amount, and factual attribution', (_label, value, title, amount, actor) => {
    renderRow(value);

    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(amount)).toBeInTheDocument();
    expect(screen.getByText(actor)).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.getByText('Status: Completed')).toBeInTheDocument();
  });

  it('H: keeps veciiz on a labelled note line instead of repeating it in the title', () => {
    renderRow(event({
      subject: { id: 'mostium', name: 'Mostium' },
      actor: { id: 'parent-ada', name: 'Ada' },
      note: 'veciiz',
      headline: '£1.00 added to Mostium’s wallet',
      metadata: ['Performed by: Ada'],
    }));

    expect(screen.getByText('£1.00 added to Mostium’s wallet')).toBeInTheDocument();
    expect(screen.getByText('+£1.00')).toBeInTheDocument();
    expect(screen.getByText('veciiz').parentElement).toHaveTextContent('Note: veciiz');
    expect(screen.getAllByText(/veciiz/)).toHaveLength(1);
    expect(screen.getByText('Aug 25, 2026')).toBeInTheDocument();
    expect(screen.getByText('Status: Completed')).toBeInTheDocument();
  });

  it('omits the date when a legacy activity has no persisted timestamp', () => {
    renderRow(event({
      eventKind: 'unknown',
      amountPence: 0,
      headline: 'Sent to Mnalium',
      timestamp: undefined,
    }));

    expect(screen.getByText('Sent to Mnalium')).toBeInTheDocument();
    expect(screen.queryByText(/1970/)).not.toBeInTheDocument();
  });

  it('omits actor text for a legacy withdrawal with no stored actor', () => {
    renderRow(event({
      eventKind: 'withdrawal',
      amountPence: -255,
      headline: '£2.55 withdrawn',
      note: 'Chestnut',
    }));

    expect(screen.getByText('£2.55 withdrawn')).toBeInTheDocument();
    expect(screen.queryByText(/Performed by:/)).not.toBeInTheDocument();
  });
});
