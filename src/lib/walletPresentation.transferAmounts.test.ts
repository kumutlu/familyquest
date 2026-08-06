import { describe, expect, it } from 'vitest';
import { transactionPresentation } from './walletPresentation';

/**
 * Wallet recent-activity rows must show the real transaction amount inline for
 * transfers, exactly like withdrawals already do. Amounts come strictly from
 * the stored signed `amountPence` (pence, integer) — never inferred from
 * balance changes.
 */

const nameResolver = (id: string) => (id === 'child-2' ? 'Mnalium' : undefined);

describe('wallet activity — transfer amounts', () => {
  it('renders amount and recipient for transfer_out', () => {
    const p = transactionPresentation(
      { type: 'transfer_out', amountPence: -1000, counterpartyChildId: 'child-2', description: 'Sent to Mnalium' },
      { nameResolver },
    );
    expect(p.title).toBe('Sent £10.00 to Mnalium');
    expect(p.direction).toBe('out');
  });

  it('renders amount and sender for transfer_in', () => {
    const p = transactionPresentation(
      { type: 'transfer_in', amountPence: 1000, counterpartyChildId: 'child-2', description: 'Received from Mnalium' },
      { nameResolver },
    );
    expect(p.title).toBe('Received £10.00 from Mnalium');
    expect(p.direction).toBe('in');
  });

  it('formats pence to pounds correctly and never duplicates the negative sign', () => {
    const p = transactionPresentation(
      { type: 'transfer_out', amountPence: -12345, counterpartyChildId: 'child-2' },
      { nameResolver },
    );
    expect(p.title).toBe('Sent £123.45 to Mnalium');
    expect(p.title).not.toContain('-');
  });

  it('does not regress existing withdrawal rendering', () => {
    const p = transactionPresentation({ type: 'withdrawal', amount: 500, note: 'Cash out' });
    expect(p.title).toBe('Cash out');
    expect(p.subtitle).toBe('By Parent');
  });

  it('falls back safely when a legacy transfer has no amount', () => {
    const p = transactionPresentation(
      { type: 'transfer_out', counterpartyChildId: 'child-2', description: 'Sent to Mnalium' },
      { nameResolver },
    );
    expect(p.title).toBe('Sent to Mnalium');
  });

  it('falls back to a generic label when a legacy transfer has neither amount nor description', () => {
    const p = transactionPresentation({ type: 'transfer_in', counterpartyChildId: 'child-2' }, { nameResolver });
    expect(p.title).toBe('Received');
  });
});
