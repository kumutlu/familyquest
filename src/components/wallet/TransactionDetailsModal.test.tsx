import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../reversals/HistoryActionControl', () => ({ HistoryActionControl: ({ sourceKind, source }: any) => <span>{sourceKind}:{source.id}</span> }));
import { TransactionDetailsModal } from './TransactionDetailsModal';

describe('TransactionDetailsModal reversal integration', () => {
  it('routes pending transfer details to the canonical request source', () => {
    render(<TransactionDetailsModal isOpen onClose={vi.fn()} transaction={{ id: 'request-1', type: 'transfer_request_out', amountPence: 100, status: 'pending' }} />);
    expect(screen.getByText('transfer_request:request-1')).toBeInTheDocument();
  });
});
