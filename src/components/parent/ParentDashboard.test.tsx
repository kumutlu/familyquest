import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  approveJoinRequest: vi.fn(), rejectJoinRequest: vi.fn(), depositToWallet: vi.fn(), withdrawFromWallet: vi.fn(), transferWalletFunds: vi.fn(),
}));

vi.mock('../../lib/api', () => api);
vi.mock('../../store/useStore', () => ({
  useStore: () => ({
    currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner' }, familyData: { currency: '£' },
    tasks: [], familyMembers: [], feed: [], rewards: [], childWallets: [], walletTransactions: [], loading: false,
    joinRequests: [
      { id: 'request-1', uid: 'joiner-1', displayName: 'First Joiner', status: 'pending' },
      { id: 'request-2', uid: 'joiner-2', displayName: 'Second Joiner', status: 'pending' },
    ],
  }),
}));
vi.mock('./ApprovalCenter', () => ({ ApprovalCenter: () => null }));
vi.mock('../reversals/ReversalHistoryPanel', () => ({ ReversalHistoryPanel: () => null }));
vi.mock('../forms/TaskFormModal', () => ({ TaskFormModal: () => null }));
vi.mock('../forms/RewardFormModal', () => ({ RewardFormModal: () => null }));
vi.mock('../forms/BehaviourFormModal', () => ({ BehaviourFormModal: () => null }));

import { ParentDashboard } from './ParentDashboard';

describe('ParentDashboard join review loading', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps concurrent join cards independently disabled and loading', async () => {
    api.approveJoinRequest.mockImplementation(() => new Promise(() => {}));
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);

    const buttons = screen.getAllByRole('button', { name: 'Approve as Child' });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Approving…' })).toHaveLength(2));
    expect(screen.getAllByRole('button', { name: 'Approving…' }).every(button => button.hasAttribute('disabled'))).toBe(true);
    expect(api.approveJoinRequest).toHaveBeenCalledTimes(2);
  });
});
