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

describe('transactionAdapter transfer subtitles (no raw description echo)', () => {
  it('1. transfer_out title comes from the shared transferTitle helper', () => {
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
    expect(tx.title).toBe('Sent £10.00 to Mnalium');
  });

  it('2. transfer_in title comes from the shared transferTitle helper', () => {
    const tx = adaptOne({
      id: 'w2',
      type: 'transfer_in',
      amountPence: 1000,
      counterpartyChildId: 'child-2',
      childId: 'child-1',
      timestamp: TS,
      status: 'completed',
      description: 'Received from Mnalium',
    });
    expect(tx.title).toBe('Received £10.00 from Mnalium');
  });

  it('3. subtitle never repeats the raw "Sent to X" description', () => {
    const tx = adaptOne({
      id: 'w3',
      type: 'transfer_out',
      amountPence: -1000,
      counterpartyChildId: 'child-2',
      childId: 'child-1',
      timestamp: TS,
      status: 'completed',
      description: 'Sent to Mnalium',
    });
    expect(tx.subtitle).not.toBe('Sent to Mnalium');
    expect(tx.subtitle).not.toBe(tx.title);
  });

  it('3b. subtitle never repeats the raw "Received from X" description', () => {
    const tx = adaptOne({
      id: 'w4',
      type: 'transfer_in',
      amountPence: 1000,
      counterpartyChildId: 'child-2',
      childId: 'child-1',
      timestamp: TS,
      status: 'completed',
      description: 'Received from Mnalium',
    });
    expect(tx.subtitle).not.toBe('Received from Mnalium');
    expect(tx.subtitle).not.toBe(tx.title);
  });

  it('4. preserves a genuine user note as the subtitle', () => {
    const tx = adaptOne({
      id: 'w5',
      type: 'transfer_out',
      amountPence: -1000,
      counterpartyChildId: 'child-2',
      childId: 'child-1',
      timestamp: TS,
      status: 'completed',
      description: 'Birthday money for you',
    });
    expect(tx.subtitle).toBe('Birthday money for you');
  });

  it('4b. preserves the stored note field', () => {
    const tx = adaptOne({
      id: 'w6',
      type: 'transfer_out',
      amountPence: -1000,
      counterpartyChildId: 'child-2',
      childId: 'child-1',
      timestamp: TS,
      note: 'Birthday money',
      description: 'Sent to Mnalium',
    });
    expect(tx.note).toBe('Birthday money');
  });

  it('6. legacy row with an unsigned amount still renders the unified title', () => {
    const tx = adaptOne({
      id: 'w7',
      type: 'transfer_out',
      amount: 500,
      counterpartyChildId: 'child-2',
      childId: 'child-1',
      timestamp: TS,
      description: 'Sent to Mnalium',
    });
    expect(tx.title).toBe('Sent £5.00 to Mnalium');
    expect(tx.subtitle).not.toBe('Sent to Mnalium');
  });

  it('6b. a row with no amount at all is skipped safely (no crash, no label)', () => {
    const rows = adaptAllTransactions({
      walletTransactions: [{
        id: 'w9',
        type: 'transfer_out',
        counterpartyChildId: 'child-2',
        childId: 'child-1',
        timestamp: TS,
        description: 'Sent to Mnalium',
      }],
      opts,
    });
    expect(rows).toEqual([]);
  });

  it('7. withdrawal rendering is unchanged', () => {
    const tx = adaptOne({
      id: 'w8',
      type: 'withdrawal',
      amount: 250,
      childId: 'child-1',
      parentRef: 'parent-1',
      timestamp: TS,
      description: 'Cash out',
    });
    expect(tx.title).toBe('Money withdrawn');
    expect(tx.subtitle).toBe('Cash out');
    expect(tx.amountPence).toBe(-250);
  });
});
