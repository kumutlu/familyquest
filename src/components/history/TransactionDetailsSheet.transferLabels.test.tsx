import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { adaptAllTransactions } from '../../lib/transactionAdapter';
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
        transaction={tx}
        nameResolver={nameResolver}
        currency="£"
      />,
    );

    expect(screen.getAllByText('Sent £10.00 to Mnalium').length).toBeGreaterThan(0);
    expect(screen.queryByText('Sent to Mnalium')).not.toBeInTheDocument();
  });
});
