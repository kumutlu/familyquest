import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';

const api = vi.hoisted(() => ({
  approveJoinRequest: vi.fn(), rejectJoinRequest: vi.fn(),
  depositToWallet: vi.fn(), withdrawFromWallet: vi.fn(), transferWalletFunds: vi.fn(),
}));

const h = vi.hoisted(() => ({ navigate: vi.fn() }));

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
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => h.navigate };
});
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
vi.mock('../dashboard/RewardsSummaryCard', () => ({
  RewardsSummaryCard: () => (
    <div data-testid="rewards-summary">
      <button type="button" aria-label="Manage rewards">Manage rewards</button>
      Rewards Summary
    </div>
  ),
}));

import { ParentDashboard } from './ParentDashboard';

function baseState() {
  return {
    currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner' },
    familyData: { id: 'family-1', currency: '£', inviteCode: 'ABC123' },
    tasks: [], familyMembers: [], feed: [], rewards: [], childWallets: [],
    walletTransactions: [], loading: false,
    appReady: true, familyLoading: false,
    joinRequests: [
      { id: 'request-1', uid: 'joiner-1', displayName: 'First Joiner', status: 'pending' },
      { id: 'request-2', uid: 'joiner-2', displayName: 'Second Joiner', status: 'pending' },
    ],
    taskCompletions: [], bootstrapStatus: { family: 'ready', members: 'ready', wallets: 'ready' },
  } as any;
}

beforeEach(async () => {
  await i18n.loadNamespaces([
    'common', 'auth', 'family', 'tasks', 'wallet', 'goals', 'rewards',
    'dashboard', 'approvals', 'settings', 'notifications', 'errors',
    'behaviour', 'profile', 'funds', 'requests', 'reversals',
  ]);
  await i18n.changeLanguage('en');
});

describe('ParentDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.state = baseState();
  });

  it('keeps concurrent join cards independently disabled and loading', async () => {
    api.approveJoinRequest.mockImplementation(() => new Promise(() => {}));
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);

    const buttons = screen.getAllByRole('button', { name: 'Confirm child' });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Approving…' })).toHaveLength(2));
    expect(
      screen.getAllByRole('button', { name: 'Approving…' }).every(button => button.hasAttribute('disabled')),
    ).toBe(true);
    expect(api.approveJoinRequest).toHaveBeenCalledTimes(2);
  });

  it('defaults approval to child and sends an explicitly selected parent role', async () => {
    api.approveJoinRequest.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);

    fireEvent.click(screen.getAllByRole('button', { name: 'Confirm child' })[0]);
    await waitFor(() => expect(api.approveJoinRequest).toHaveBeenCalledWith(
      'family-1', 'request-1', 'child',
    ));

    fireEvent.change(screen.getByLabelText('Approval role for Second Joiner'), {
      target: { value: 'parent' },
    });
    expect(screen.getByRole('button', { name: 'Confirm parent/adult' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm parent/adult' }));
    await waitFor(() => expect(api.approveJoinRequest).toHaveBeenCalledWith(
      'family-1', 'request-2', 'parent',
    ));
  });

  it('offers only child or parent/adult approval roles and explains parent permissions', () => {
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);
    const roleSelect = screen.getByLabelText('Approval role for First Joiner');
    expect(roleSelect).toHaveValue('child');
    expect(screen.getAllByRole('option', { name: 'Approve as child' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('option', { name: 'Approve as parent or adult' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('option', { name: /^Approve as adult$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /owner/i })).not.toBeInTheDocument();
    expect(screen.getByText(
      'Choose child for a child account, or parent/adult for a trusted adult who should help manage the family.',
    )).toBeInTheDocument();
  });

  it('renders dashboard sections in the correct order: Quick Actions → Approval Center → Family Bulletin → Summary → Children → Activity', () => {
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'New Task' })).toBeInTheDocument();
    expect(screen.getByText('Approval Center Section')).toBeInTheDocument();
    expect(screen.getByText('Recent Family Activity')).toBeInTheDocument();
    expect(screen.getByTestId('rewards-summary')).toBeInTheDocument();
  });

  it('shows the first-child prompt on Home only after authoritative empty membership loads', () => {
    store.state = { ...baseState(), joinRequests: [] };
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);
    expect(screen.getByRole('dialog', { name: 'Set up your family' })).toBeInTheDocument();
  });

  it('does not enter focus mode while setup resources are still loading', () => {
    store.state = {
      ...baseState(),
      familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Existing Child' }],
      bootstrapStatus: {
        family: 'ready', members: 'ready', tasks: 'loading', rewards: 'loading', wallets: 'ready',
      },
    };
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);
    expect(screen.queryByTestId('dashboard-focus-mode')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Task' })).toBeInTheDocument();
  });

  it('hides the first-child prompt while members load or when member loading fails', () => {
    for (const status of ['loading', 'error']) {
      store.state = {
        ...baseState(),
        joinRequests: [],
        bootstrapStatus: { family: 'ready', members: status, wallets: 'ready' },
      };
      const rendered = render(<MemoryRouter><ParentDashboard /></MemoryRouter>);
      expect(screen.queryByRole('dialog', { name: 'Set up your family' })).not.toBeInTheDocument();
      rendered.unmount();
    }
  });

  it('closes the first-child prompt when a child arrives asynchronously', () => {
    store.state = { ...baseState(), joinRequests: [] };
    const rendered = render(<MemoryRouter><ParentDashboard /></MemoryRouter>);
    expect(screen.getByRole('dialog', { name: 'Set up your family' })).toBeInTheDocument();

    store.state = {
      ...store.state,
      familyMembers: [{ id: 'child-1', role: 'child', isManaged: true }],
    };
    rendered.rerender(<MemoryRouter><ParentDashboard /></MemoryRouter>);
    expect(screen.queryByRole('dialog', { name: 'Set up your family' })).not.toBeInTheDocument();
  });

  it('opens the existing task modal from the New Task quick action', () => {
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'New Task' }));
    expect(screen.getByText('Task Form Modal')).toBeInTheDocument();
  });

  it('keeps Add a child available on Home after the setup prompt is no longer eligible', () => {
    store.state = {
      ...baseState(),
      familyData: {
        ...baseState().familyData,
        setup: { welcomePromptCompleted: true },
      },
      familyMembers: [{ id: 'child-1', role: 'child', displayName: 'Existing Child' }],
      // Activated family: setup complete, so Focus Mode stays off.
      rewards: [{ id: 'r-1', title: 'Gold Star' }],
      tasks: [{ id: 't-1', title: 'Tidy room' }],
    };
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);

    expect(screen.queryByRole('dialog', { name: 'Set up your family' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a child' }));
    expect(screen.getByRole('dialog', { name: 'Add your child' })).toBeInTheDocument();
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

describe('ParentDashboard summary cards (Phase 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.navigate.mockClear();
    store.state = {
      ...baseState(),
      childWallets: [
        { id: 'c-1', balance: 500 },
        { id: 'c-2', balance: 250 },
      ],
      familyMembers: [
        { id: 'c-1', role: 'child' },
        { id: 'c-2', role: 'child' },
      ],
      rewards: [{ id: 'r-1', title: 'Gold Star' }],
      tasks: [{ id: 't-1', title: 'Tidy room' }],
      savingsGoals: [
        { goalId: 'g-1', title: 'Bike', status: 'active', currentAmountPence: 500, targetAmountPence: 1000 },
        { goalId: 'g-2', title: 'Tablet', status: 'active', currentAmountPence: 200, targetAmountPence: 800 },
      ],
      funds: [
        { id: 'f-1', name: 'Rex', species: 'dog', balance: 1500, emergencyGoal: 5000 },
      ],
    };
  });

  it('renders the wallet, goals, rewards, and pet box summary cards when Pet Box is enabled', () => {
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);
    expect(screen.getByTestId('wallet-summary')).toBeInTheDocument();
    expect(screen.getByTestId('goal-summary')).toBeInTheDocument();
    expect(screen.getByTestId('rewards-summary')).toBeInTheDocument();
    expect(screen.getByTestId('petbox-summary')).toBeInTheDocument();
  });

  it('renders wallet, goals, and rewards summary cards when Pet Box is disabled', () => {
    store.state = {
      ...baseState(),
      familyData: { petBoxEnabled: false },
      childWallets: [
        { id: 'c-1', balance: 500 },
        { id: 'c-2', balance: 250 },
      ],
      familyMembers: [
        { id: 'c-1', role: 'child' },
        { id: 'c-2', role: 'child' },
      ],
      rewards: [{ id: 'r-1', title: 'Gold Star' }],
      tasks: [{ id: 't-1', title: 'Tidy room' }],
      savingsGoals: [
        { goalId: 'g-1', title: 'Bike', status: 'active', currentAmountPence: 500, targetAmountPence: 1000 },
      ],
      funds: [],
    };
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);
    expect(screen.getByTestId('wallet-summary')).toBeInTheDocument();
    expect(screen.getByTestId('goal-summary')).toBeInTheDocument();
    expect(screen.getByTestId('rewards-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('petbox-summary')).not.toBeInTheDocument();
  });

  it('shows the parent/owner family wallet aggregate and links to /wallets', () => {
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);
    // Parent aggregate surface, never the child "My Wallet" surface.
    expect(screen.getByText('Family Wallets')).toBeInTheDocument();
    expect(screen.queryByText('My Wallet')).not.toBeInTheDocument();
    expect(screen.getByText('£7.50')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Manage family wallets/i }));
    expect(h.navigate).toHaveBeenCalledWith('/wallets');
  });

  it('shows active goals count and links to /goals', () => {
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);
    expect(screen.getByText('2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /View all goals/i }));
    expect(h.navigate).toHaveBeenCalledWith('/goals');
  });

  it('shows pet box overview and links to /pet-box', () => {
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);
    expect(screen.getByText('1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Open Pet Box/i }));
    expect(h.navigate).toHaveBeenCalledWith('/pet-box');
  });

  it('shows the rewards summary card', () => {
    store.state = {
      ...baseState(),
      rewards: [
        { id: 'r-1', title: 'Gold Star' },
        { id: 'r-2', title: 'Badge' },
      ],
    };
    render(<MemoryRouter><ParentDashboard /></MemoryRouter>);
    expect(screen.getByTestId('rewards-summary')).toBeInTheDocument();
  });
});
