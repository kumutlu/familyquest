import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ reverseTransaction: vi.fn(), cancelPendingApproval: vi.fn() }));
vi.mock('../../lib/reversalApi', () => ({ reverseTransaction: api.reverseTransaction }));
vi.mock('../../lib/api', () => ({ cancelPendingApproval: api.cancelPendingApproval }));
vi.mock('../../store/useStore', () => ({
  useStore: () => ({
    currentUser: { id: 'parent-1', familyId: 'family-1', role: 'parent', displayName: 'Parent' },
    familyData: { currency: '£' }, familyMembers: [{ id: 'child-1', displayName: 'Alex', rewardPoints: 20 }],
    childWallets: [{ id: 'child-1', balance: 500 }], funds: [], reversals: [],
    walletTransactions: [{ id: 'tx-1', type: 'deposit', status: 'completed', note: 'Pocket money', timestamp: { toDate: () => new Date('2026-07-13') }, effectSnapshot: { schemaVersion: 1, entityType: 'wallet_transaction', familyId: 'family-1', actorId: 'parent-1', childId: 'child-1', walletDeltaPence: 300, xpAdjustment: 0 } }],
    fundTransactions: [], behaviourEvents: [], taskCompletions: [], redemptions: [], transferRequests: [], moneyRequests: [], petboxRequests: [],
  }),
}));

import { ReversalHistoryPanel } from './ReversalHistoryPanel';

describe('ReversalHistoryPanel', () => {
  beforeEach(() => { vi.clearAllMocks(); api.reverseTransaction.mockResolvedValue({ status: 'completed' }); });

  it('updates a completed action to Reversed immediately with audit metadata', async () => {
    render(<ReversalHistoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Duplicate entry' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByText('Reversed')).toBeInTheDocument());
    expect(screen.getByText('Duplicate entry')).toBeInTheDocument();
    expect(screen.getByText(/by Parent/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse' })).not.toBeInTheDocument();
  });
});
