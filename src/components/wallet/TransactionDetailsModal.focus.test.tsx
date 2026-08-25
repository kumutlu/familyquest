import { render as rtlRender, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext';

// Mock the heavy/store-dependent children so we can test focus behaviour in isolation.
vi.mock('../ui/CurrencyDisplay', () => ({
  CurrencyDisplay: ({ amountPence }: any) => <span>{`£${(amountPence / 100).toFixed(2)}`}</span>,
}));
vi.mock('../reversals/HistoryActionControl', () => ({
  HistoryActionControl: () => <span>history-control</span>,
}));

import { TransactionDetailsModal } from './TransactionDetailsModal';

function render(ui: ReactElement) {
  const result = rtlRender(<MoneyPrivacyProvider>{ui}</MoneyPrivacyProvider>);
  return {
    ...result,
    rerender: (next: ReactElement) => result.rerender(
      <MoneyPrivacyProvider>{next}</MoneyPrivacyProvider>,
    ),
  };
}

function Harness({ open }: { open: boolean }) {
  return (
    <>
      <button type="button" id="trigger">
        Open
      </button>
      <TransactionDetailsModal
        isOpen={open}
        onClose={() => {}}
        transaction={{ id: 'tx-1', type: 'deposit', amount: 100, status: 'completed' }}
      />
    </>
  );
}

describe('TransactionDetailsModal focus return (28)', () => {
  it('returns focus to the triggering element when closed', () => {
    const { rerender } = render(<Harness open={false} />);
    const trigger = screen.getByText('Open') as HTMLButtonElement;
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    rerender(<Harness open={true} />);
    expect(screen.getByText('Transaction Details')).toBeInTheDocument();

    rerender(<Harness open={false} />);
    // Focus should be restored to the trigger button after the sheet closes.
    expect(document.activeElement).toBe(trigger);
  });
});
