import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';
import type { NormalizedTransaction } from '../../lib/transactionModel';

vi.mock('../reversals/HistoryActionControl', () => ({
  HistoryActionControl: () => <button type="button">History action</button>,
}));

import { TransactionDetailsSheet } from './TransactionDetailsSheet';

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

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open details</button>
      <TransactionDetailsSheet
        isOpen={open}
        onClose={() => setOpen(false)}
        transaction={transaction}
        actionSource={{ sourceKind: 'wallet_transaction', source: { id: 'tx-1' } }}
        currency="£"
      />
    </>
  );
}

describe('TransactionDetailsSheet focus containment', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['wallet', 'goals', 'rewards', 'reversals']);
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
