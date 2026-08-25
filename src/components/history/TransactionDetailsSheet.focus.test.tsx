import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';
import type { NormalizedTransaction } from '../../lib/transactionModel';
import type { HumanReadableFamilyEvent } from '../../lib/humanReadableFamilyEvent';
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext';

vi.mock('../reversals/HistoryActionControl', () => ({
  HistoryActionControl: () => <button type="button">History action</button>,
}));

import { TransactionDetailsSheet } from './TransactionDetailsSheet';

function render(ui: ReactElement) {
  return rtlRender(<MoneyPrivacyProvider>{ui}</MoneyPrivacyProvider>);
}

const transaction: NormalizedTransaction = {
  id: 'tx-1',
  timestamp: Date.now(),
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
  reversible: false,
  searchText: '',
  category: 'income',
  isPending: false,
  isCompleted: true,
  isReversed: false,
};

const event: HumanReadableFamilyEvent = {
  transaction,
  eventKind: 'deposit',
  amountPence: 100,
  unit: 'money',
  currency: '£',
  timestamp: transaction.timestamp,
  status: 'completed',
  sourceType: 'manual',
  sourceId: 'tx-1',
  headline: '£1.00 added',
  metadata: [],
};

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open details</button>
      <TransactionDetailsSheet
        isOpen={open}
        onClose={() => setOpen(false)}
        event={event}
        actionSource={{ sourceKind: 'wallet_transaction', source: { id: 'tx-1' } }}
        currency="£"
      />
    </>
  );
}

describe('TransactionDetailsSheet focus containment', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.loadNamespaces(['common', 'wallet', 'goals', 'rewards', 'reversals']);
    await i18n.changeLanguage('en');
  });

  it('sets initial focus, wraps Tab both ways, escapes, and restores the trigger', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open details' });
    trigger.focus();
    fireEvent.click(trigger);

    const close = screen.getByRole('button', { name: 'Close' });
    const action = screen.getByRole('button', { name: 'History action' });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(action);

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});
