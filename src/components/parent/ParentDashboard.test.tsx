import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  approveJoinRequest: vi.fn(), rejectJoinRequest: vi.fn(),
  depositToWallet: vi.fn(), withdrawFromWallet: vi.fn(), transferWalletFunds: vi.fn(),
}));

const store = vi.hoisted(() => ({
  state: {
    currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner' },
    familyData: { currency: '£' },
    tasks: [], familyMembers: [], feed: [], rewards: [], childWallets: [],
    walletTransactions: [], loading: false,
    joinRequests: [
      { id: 'request-1', uid: 'joiner-1', displayName: 'First Joiner', status: 'pending' },
      { id: 'request-2', uid: 'joiner-2', displayName: 'Second Joiner', status: 'pending' },
    ],
    taskCompletions: [], bootstrapStatus: { wallets: 'ready' },
  } as any,
}));

vi.mock('../../lib/api', () => api);
vi.mock('../../store/useStore', () => ({ useStore: () => store.state }));
vi.mock('./ApprovalCenter', () => ({ ApprovalCenter: () => <div>Approval Center Section</div> }));
vi.mock('../reversals/ReversalHistoryPanel', () => ({ ReversalHistoryPanel: () => null }));
vi.mock('../reversals/HistoryActionControl', () => ({ HistoryActionControl: () => null }));
vi.mock('../forms/TaskFormModal', () => ({
  TaskFormModal: ({ isOpen }: any) => (isOpen ? <div>Task Form Modal</div> : null),
}));
vi.mock('../forms/RewardFormModal', () => ({
  RewardFormModal: ({ isOpen }: any) => (isOpen ? <div>Reward Form Modal</div> : null),
}));
vi.mock('../forms/BehaviourFormModal', () => ({
  BehaviourFormModal: ({ isOpen }: any) => (isOpen ? <div>Behaviour Form Modal</div> : null),
}));

import { ParentDashboard } from './ParentDashboard';

function baseState() {
  return {
    currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner' },
    familyData: { currency: '£' },
    tasks: [], familyMembers: [], feed: [], rewards: [], childWallets: [],
    walletTransactions: [], loading: false,
    joinRequests: [
      { id: 'request-1', uid: 'joiner-1', displayName: 'First Joiner', status: 'pending' },
      { id: 'request-2', uid: 'joiner-2', displayName: 'Second Joiner', status: 'pending' },
    ],
    taskCompletions: [], bootstrapStatus: { wallets: 'ready' },
  } as any;
}

describe('ParentDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.state = baseState();
  });

  it('keeps concurrent join cards independently disabled and loading', async () => {
    api.approveJoinRequest.mockImplementation(() => new Promise(() => {}));
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);

    const buttons = screen.getAllByRole('button', { name: 'Approve as Child' });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Approving…' })).toHaveLength(2));
    expect(
      screen.getAllByRole('button', { name: 'Approving…' }).every(button => button.hasAttribute('disabled')),
    ).toBe(true);
    expect(api.approveJoinRequest).toHaveBeenCalledTimes(2);
  });

  it('renders the dashboard sections (approvals + activity + quick actions)', () => {
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);
    expect(screen.getByText('Approval Center Section')).toBeInTheDocument();
    expect(screen.getByText('Recent Family Activity')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Task' })).toBeInTheDocument();
  });

  it('opens the existing task modal from the New Task quick action', () => {
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'New Task' }));
    expect(screen.getByText('Task Form Modal')).toBeInTheDocument();
  });

  it('opens the existing reward modal from the New Reward quick action', () => {
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'New Reward' }));
    expect(screen.getByText('Reward Form Modal')).toBeInTheDocument();
  });

  it('opens the existing behaviour modal from the Log Behaviour quick action', () => {
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Log Behaviour' }));
    expect(screen.getByText('Behaviour Form Modal')).toBeInTheDocument();
  });

  it('shows a loading state and never the child cards while loading', () => {
    store.state = { ...baseState(), loading: true };
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);
    expect(screen.getByText(/Loading Dashboard/)).toBeInTheDocument();
    expect(screen.queryByText('£0.00')).not.toBeInTheDocument();
  });

  it('shows a friendly error state and logs the technical detail', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.state = { ...baseState(), bootstrapError: 'firestore/permission-denied: missing index' };
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);
    expect(screen.getByText(/couldn.t load your family dashboard/i)).toBeInTheDocument();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
