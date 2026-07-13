import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ reverseTransaction: vi.fn(), cancelPendingApproval: vi.fn() }));
const store = vi.hoisted(() => ({ state: {} as any }));
vi.mock('../../lib/reversalApi', () => ({ reverseTransaction: api.reverseTransaction }));
vi.mock('../../lib/api', () => ({ cancelPendingApproval: api.cancelPendingApproval }));
vi.mock('../../store/useStore', () => ({ useStore: () => store.state }));

import { HistoryActionControl } from './HistoryActionControl';

const baseState = () => ({
  currentUser: { id: 'parent-1', familyId: 'family-1', role: 'parent', displayName: 'Parent' },
  familyMembers: [{ id: 'child-1', displayName: 'Alex', rewardPoints: 20 }], childWallets: [{ id: 'child-1', balance: 500 }],
  funds: [], tasks: [], rewards: [], reversals: [],
});

describe('HistoryActionControl', () => {
  beforeEach(() => { vi.clearAllMocks(); store.state = baseState(); });

  it('renders persisted reversal reason, actor, and completedAt rather than epoch time', () => {
    store.state.reversals = [{ sourceKind: 'wallet_transaction', sourceId: 'tx-1', reason: 'Duplicate', actorName: 'Owner', completedAt: { toDate: () => new Date('2026-07-13T10:00:00Z') } }];
    render(<HistoryActionControl sourceKind="wallet_transaction" source={{ id: 'tx-1', type: 'deposit', effectSnapshot: { schemaVersion: 1, entityType: 'wallet_transaction', familyId: 'family-1', actorId: 'parent-1', childId: 'child-1', walletDeltaPence: 100, xpAdjustment: 0 } }} />);
    expect(screen.getByText('Reversed')).toBeInTheDocument();
    expect(screen.getByText('Duplicate')).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.queryByText(/1970/)).not.toBeInTheDocument();
  });

  it('routes a real child-created pending request through parent cancellation and updates immediately', async () => {
    api.cancelPendingApproval.mockResolvedValue(undefined);
    render(<HistoryActionControl sourceKind="transfer_request" source={{ id: 'request-1', status: 'pending', fromChildId: 'child-1' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.cancelPendingApproval).toHaveBeenCalledWith('family-1', 'transfer', 'request-1'));
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('does not expose a reversal control to a child', () => {
    store.state.currentUser = { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Alex' };
    render(<HistoryActionControl sourceKind="wallet_transaction" source={{ id: 'tx-1', type: 'deposit', effectSnapshot: { schemaVersion: 1, entityType: 'wallet_transaction', familyId: 'family-1', actorId: 'parent-1', childId: 'child-1', walletDeltaPence: 100, xpAdjustment: 0 } }} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
