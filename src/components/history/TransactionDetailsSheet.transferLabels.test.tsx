import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import i18n from '../../i18n/config';
import { adaptAllTransactions } from '../../lib/transactionAdapter';
import type { NormalizedTransaction } from '../../lib/transactionModel';
import type { HumanReadableFamilyEvent } from '../../lib/humanReadableFamilyEvent';
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext';
import { MoneyPrivacyToggle } from '../privacy/MoneyPrivacyToggle';
import { TransactionDetailsSheet } from './TransactionDetailsSheet';

const TS = new Date('2026-01-15T10:00:00.000Z').getTime();
const nameResolver = (id: string) => (id === 'child-2' ? 'Mnalium' : undefined);

function adaptOne(record: Record<string, unknown>) {
  const [tx] = adaptAllTransactions({
    walletTransactions: [record],
    opts: { nameResolver, currentUserId: 'child-1' },
  });
  return tx;
}

function eventFor(transaction: NormalizedTransaction): HumanReadableFamilyEvent {
  return {
    transaction,
    eventKind: transaction.type,
    amountPence: transaction.amountPence,
    unit: transaction.unit,
    currency: transaction.currency,
    timestamp: transaction.timestamp,
    status: transaction.status,
    sourceType: transaction.source ?? 'manual',
    sourceId: transaction.sourceId ?? transaction.id,
    headline: transaction.title,
    metadata: [],
  };
}

function render(ui: ReactElement) {
  return rtlRender(<MoneyPrivacyProvider>{ui}</MoneyPrivacyProvider>);
}

beforeEach(async () => {
  localStorage.clear();
  await i18n.loadNamespaces(['common', 'wallet', 'goals', 'rewards', 'reversals']);
  await i18n.changeLanguage('en');
});

describe('8. TransactionDetailsSheet inherits corrected normalized transfer data', () => {
  it('shows the unified transfer title and never the raw "Sent to X" echo', () => {
    const tx = adaptOne({
      id: 'w1',
      type: 'transfer_out',
      amountPence: -1000,
      counterpartyChildId: 'child-2',
      childId: 'child-1',
      timestamp: TS,
      status: 'completed',
      description: 'Sent to Mnalium',
    });

    render(
      <TransactionDetailsSheet
        isOpen
        onClose={() => {}}
        event={eventFor(tx)}
        currency="£"
      />,
    );

    expect(document.body).toHaveTextContent('Sent £10.00 to Mnalium');
    expect(screen.queryByText('Sent to Mnalium')).not.toBeInTheDocument();
  });

  it('toggles transfer title and detail amount without losing the sheet', () => {
    const tx = adaptOne({
      id: 'private-history-sheet',
      type: 'transfer_out',
      amountPence: -92_736,
      balanceAfter: 81_625,
      counterpartyChildId: 'child-2',
      childId: 'child-1',
      timestamp: TS,
      status: 'completed',
      description: 'Sent to Mnalium',
    });

    render(
      <>
        <MoneyPrivacyToggle />
        <TransactionDetailsSheet
          isOpen
          onClose={() => {}}
          event={eventFor(tx)}
          currency="£"
        />
      </>,
    );

    expect(document.body.innerHTML).toContain('927.36');

    fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));

    expect(screen.getByRole('dialog', { name: 'Transaction Details' })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('927.36');

    fireEvent.click(screen.getByRole('button', { name: 'Show money amounts' }));
    expect(document.body.innerHTML).toContain('927.36');
  });
});
