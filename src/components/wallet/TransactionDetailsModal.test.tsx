import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import i18n from '../../i18n/config';
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext';
import { MoneyPrivacyToggle } from '../privacy/MoneyPrivacyToggle';

vi.mock('../reversals/HistoryActionControl', () => ({ HistoryActionControl: ({ sourceKind, source }: any) => <span>{sourceKind}:{source.id}</span> }));
import { TransactionDetailsModal } from './TransactionDetailsModal';

function render(ui: ReactElement) {
  return rtlRender(<MoneyPrivacyProvider>{ui}</MoneyPrivacyProvider>);
}

beforeEach(async () => {
  localStorage.clear();
  await i18n.loadNamespaces(['common', 'wallet']);
  await i18n.changeLanguage('en');
});

describe('TransactionDetailsModal reversal integration', () => {
  it('routes pending transfer details to the canonical request source', () => {
    render(<TransactionDetailsModal isOpen onClose={vi.fn()} transaction={{ id: 'request-1', type: 'transfer_request_out', amountPence: 100, status: 'pending' }} />);
    expect(screen.getByText('transfer_request:request-1')).toBeInTheDocument();
  });

  it('toggles the stored detail amount and amount-bearing title without text leakage', () => {
    render(
      <>
        <MoneyPrivacyToggle />
        <TransactionDetailsModal
          isOpen
          onClose={vi.fn()}
          transaction={{
            id: 'private-detail',
            type: 'transfer_out',
            amountPence: -18_542,
            counterpartyChildId: 'child-2',
            status: 'completed',
          }}
          nameResolver={id => id === 'child-2' ? 'Mnalium' : undefined}
        />
      </>,
    );

    expect(document.body.innerHTML).toContain('185.42');

    fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));

    expect(document.body.innerHTML).not.toContain('185.42');
    expect(screen.getAllByText('£••••').length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole('button', { name: 'Show money amounts' }));
    expect(document.body.innerHTML).toContain('185.42');
  });
});
