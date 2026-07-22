import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';
import type { NormalizedTransaction } from '../../lib/transactionModel';

const store = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));

vi.mock('../../store/useStore', () => ({ useStore: () => store.state }));
vi.mock('../../lib/api', () => ({ cancelPendingApproval: vi.fn() }));
vi.mock('../../lib/reversalApi', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/reversalApi')>();
  return { ...actual, reverseTransaction: vi.fn() };
});

import { TransactionDetailsSheet } from './TransactionDetailsSheet';

const normalizedTransaction: NormalizedTransaction = {
  id: 'wallet-1',
  timestamp: Date.now(),
  type: 'withdrawal',
  amountPence: -250,
  currency: '£',
  unit: 'money',
  direction: 'out',
  status: 'completed',
  title: 'Money withdrawn',
  subtitle: '',
  icon: 'ArrowUpRight',
  iconBg: 'bg-gray-100',
  iconColor: 'text-gray-900',
  source: 'wallet_transaction',
  sourceId: 'wallet-1',
  childId: 'child-1',
  reversible: false,
  searchText: '',
  category: 'expense',
  isPending: false,
  isCompleted: true,
  isReversed: false,
};

const rawWallet = {
  id: 'wallet-1',
  type: 'withdrawal',
  status: 'completed',
  effectSnapshot: {
    schemaVersion: 1,
    entityType: 'wallet_transaction',
    familyId: 'family-1',
    actorId: 'parent-1',
    childId: 'child-1',
    walletDeltaPence: -250,
    xpAdjustment: 0,
  },
};

function NestedDialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open transaction</button>
      <TransactionDetailsSheet
        isOpen={open}
        onClose={() => setOpen(false)}
        transaction={normalizedTransaction}
        actionSource={{ sourceKind: 'wallet_transaction', source: rawWallet }}
        currency="£"
      />
    </>
  );
}

describe('TransactionDetailsSheet raw reversal source integration', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['wallet', 'goals', 'rewards', 'reversals']);
    await i18n.changeLanguage('en');
    store.state = {
      currentUser: {
        id: 'parent-1', familyId: 'family-1', role: 'parent', displayName: 'Taylor',
      },
      familyData: { id: 'family-1', currencyCode: 'GBP' },
      familyMembers: [{ id: 'child-1', displayName: 'Alex', rewardPoints: 0 }],
      childWallets: [{ id: 'child-1', balance: 500 }],
      funds: [],
      tasks: [],
      rewards: [],
      reversals: [],
    };
  });

  it('passes the raw effect snapshot to the real HistoryActionControl', () => {
    render(
      <TransactionDetailsSheet
        isOpen
        onClose={vi.fn()}
        transaction={normalizedTransaction}
        actionSource={{ sourceKind: 'wallet_transaction', source: rawWallet }}
        currency="£"
      />,
    );

    expect(screen.getByRole('button', { name: 'Refund' })).toBeInTheDocument();
  });

  it('coordinates nested and parent dialog focus ownership', () => {
    render(<NestedDialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Open transaction' });
    trigger.focus();
    fireEvent.click(trigger);

    const parentDialog = screen.getByRole('dialog', { name: 'Transaction Details' });
    const parentClose = within(parentDialog).getByRole('button', { name: 'Close' });
    const refundOpener = within(parentDialog).getByRole('button', { name: 'Refund' });
    expect(document.activeElement).toBe(parentClose);

    refundOpener.focus();
    fireEvent.click(refundOpener);
    const nestedDialog = screen.getByRole('dialog', { name: 'Refund donation' });
    const reason = within(nestedDialog).getByRole('textbox', { name: 'Reason' });
    const nestedRefund = within(nestedDialog).getByRole('button', { name: 'Refund' });
    expect(document.activeElement).toBe(reason);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(nestedRefund);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(reason);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Refund donation' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Transaction Details' })).toBeInTheDocument();
    expect(document.activeElement).toBe(refundOpener);

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(parentClose);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});
