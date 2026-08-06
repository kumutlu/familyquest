import { describe, expect, it } from 'vitest';
import { adaptAllTransactions } from './transactionAdapter';

const TS = new Date('2026-01-15T10:00:00.000Z').getTime();

const opts = {
  nameResolver: (id: string) => (id === 'child-2' ? 'Mnalium' : undefined),
  currentUserId: 'child-1',
};

function adaptOne(record: Record<string, unknown>) {
  const [tx] = adaptAllTransactions({ walletTransactions: [record], opts });
  return tx;
}

describe('transactionAdapter transfer amounts (history rows)', () => {
  it('renders transfer_out with the amount and counterparty', () => {
    const tx = adaptOne({
      id: 'w1',
      type: 'transfer_out',
      amountPence: -1000,
      counterpartyChildId: 'child-2',
      childId: 'child-1',
      timestamp: TS,
      status: 'completed',
      description: 'Transfer',
    });
    expect(tx.title).toBe('Sent £10.00 to Mnalium');
  });

  it('renders transfer_in with the amount and counterparty', () => {
    const tx = adaptOne({
      id: 'w2',
      type: 'transfer_in',
      amountPence: 1000,
      counterpartyChildId: 'child-2',
      childId: 'child-1',
      timestamp: TS,
      status: 'completed',
    });
    expect(tx.title).toBe('Received £10.00 from Mnalium');
  });

  it('keeps the note visible', () => {
    const tx = adaptOne({
      id: 'w3',
      type: 'transfer_out',
      amountPence: -1000,
      counterpartyChildId: 'child-2',
      childId: 'child-1',
      timestamp: TS,
      note: 'Birthday money',
    });
    expect(tx.note).toBe('Birthday money');
  });

  it('keeps the timestamp unchanged', () => {
    const tx = adaptOne({
      id: 'w4',
      type: 'transfer_in',
      amountPence: 1000,
      counterpartyChildId: 'child-2',
      childId: 'child-1',
      timestamp: TS,
    });
    expect(tx.timestamp).toBe(TS);
  });

  it('falls back safely when the amount is missing', () => {
    const tx = adaptOne({
      id: 'w5',
      type: 'transfer_out',
      amount: 500,
      counterpartyChildId: 'child-2',
      childId: 'child-1',
      timestamp: TS,
      description: 'Legacy transfer',
    });
    expect(tx.title).toBe('Sent £5.00 to Mnalium');
  });

  it('does not duplicate the title as the subtitle', () => {
    const tx = adaptOne({
      id: 'w6',
      type: 'transfer_out',
      amountPence: -1000,
      counterpartyChildId: 'child-2',
      childId: 'child-1',
      timestamp: TS,
      description: 'Sent £10.00 to Mnalium',
    });
    expect(tx.subtitle).not.toBe(tx.title);
  });

  it('leaves withdrawal rendering unchanged', () => {
    const tx = adaptOne({
      id: 'w7',
      type: 'withdrawal',
      amount: 250,
      childId: 'child-1',
      parentRef: 'parent-1',
      timestamp: TS,
    });
    expect(tx.title).toBe('Money withdrawn');
    expect(tx.amountPence).toBe(-250);
  });
});
