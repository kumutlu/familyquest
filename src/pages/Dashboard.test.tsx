import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  state: {
    currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner', displayName: 'Kemal' },
    feed: [],
    loading: false,
    myWallet: { id: 'w-1', balance: 1234 },
    childWallets: [{ id: 'w-1', balance: 500 }, { id: 'w-2', balance: 250 }],
    familyMembers: [{ id: 'c-1', role: 'child' }, { id: 'c-2', role: 'child' }],
    savingsGoals: [
      { goalId: 'g-1', title: 'Bike', status: 'active', currentAmountPence: 500, targetAmountPence: 1000 },
    ],
    funds: [{ id: 'f-1', name: 'Rex', species: 'dog', balance: 1500, emergencyGoal: 5000 }],
    tasks: [
      { id: 't-1', title: 'Brush teeth', isActive: true, assigneeId: 'owner-1' },
    ],
    taskCompletions: [],
    moneyRequests: [] as any[],
  } as any,
}));

vi.mock('../store/useStore', () => ({ useStore: () => store.state }));
// Render the real ParentDashboard so we can verify the Phase 3 summary cards
// appear for parents. Mock its heavy sub-components to keep the test focused.
vi.mock('../components/parent/ApprovalCenter', () => ({ ApprovalCenter: () => <div>Approval Center Section</div> }));
vi.mock('../components/reversals/ReversalHistoryPanel', () => ({ ReversalHistoryPanel: () => null }));
vi.mock('../components/reversals/HistoryActionControl', () => ({ HistoryActionControl: () => null }));
vi.mock('../components/forms/TaskFormModal', () => ({ TaskFormModal: () => null }));
vi.mock('../components/forms/RewardFormModal', () => ({ RewardFormModal: () => null }));
vi.mock('../components/forms/BehaviourFormModal', () => ({ BehaviourFormModal: () => null }));

import { Dashboard } from './Dashboard';

describe('Dashboard role routing', () => {
  beforeEach(() => {
    store.state = {
      currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner', displayName: 'Kemal' },
      feed: [],
      loading: false,
      myWallet: { id: 'w-1', balance: 1234 },
      childWallets: [{ id: 'w-1', balance: 500 }, { id: 'w-2', balance: 250 }],
      familyMembers: [{ id: 'c-1', role: 'child' }, { id: 'c-2', role: 'child' }],
      savingsGoals: [
        { goalId: 'g-1', title: 'Bike', status: 'active', currentAmountPence: 500, targetAmountPence: 1000 },
      ],
      funds: [{ id: 'f-1', name: 'Rex', species: 'dog', balance: 1500, emergencyGoal: 5000 }],
      tasks: [{ id: 't-1', title: 'Brush teeth', isActive: true, assigneeId: 'owner-1' }],
      taskCompletions: [],
      moneyRequests: [],
    };
  });

  it.each(['parent', 'owner'])('shows the parent dashboard for the %s role', role => {
    store.state.currentUser.role = role;
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByText('Approval Center Section')).toBeInTheDocument();
    expect(screen.queryByText('Total Points')).not.toBeInTheDocument();
  });

  it('shows the child dashboard for the child role (no parent quick actions)', () => {
    store.state.currentUser.role = 'child';
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.queryByText('Approval Center Section')).not.toBeInTheDocument();
    expect(screen.queryByText('New Task')).not.toBeInTheDocument();
    expect(screen.getByText('Total Points')).toBeInTheDocument();
  });

  it('treats the legacy admin role as a parent (isParentRole, not strict parent)', () => {
    store.state.currentUser.role = 'admin';
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByText('Approval Center Section')).toBeInTheDocument();
  });
});

describe('Dashboard summary cards', () => {
  beforeEach(() => {
    store.state = {
      currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner', displayName: 'Kemal' },
      feed: [],
      loading: false,
      myWallet: { id: 'w-1', balance: 1234 },
      childWallets: [{ id: 'w-1', balance: 500 }, { id: 'w-2', balance: 250 }],
      familyMembers: [{ id: 'c-1', role: 'child' }, { id: 'c-2', role: 'child' }],
      savingsGoals: [
        { goalId: 'g-1', title: 'Bike', status: 'active', currentAmountPence: 500, targetAmountPence: 1000 },
      ],
      funds: [{ id: 'f-1', name: 'Rex', species: 'dog', balance: 1500, emergencyGoal: 5000 }],
      tasks: [{ id: 't-1', title: 'Brush teeth', isActive: true, assigneeId: 'owner-1' }],
      taskCompletions: [],
      moneyRequests: [],
    };
  });

  it('parent dashboard renders wallet summary with family aggregate', () => {
    store.state.currentUser.role = 'parent';
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const summary = screen.getByTestId('wallet-summary');
    expect(summary).toBeInTheDocument();
    // Parent sees the family aggregate surface, never the child "My Wallet".
    expect(within(summary).getByText('Family Wallets')).toBeInTheDocument();
    expect(within(summary).getByText('£7.50')).toBeInTheDocument();
    expect(screen.queryByText('My Wallet')).not.toBeInTheDocument();
  });

  it('child dashboard renders the correct wallet summary (own balance)', () => {
    store.state.currentUser.role = 'child';
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('wallet-summary')).toBeInTheDocument();
    expect(screen.getByText('My Wallet')).toBeInTheDocument();
    expect(screen.getByText('£12.34')).toBeInTheDocument();
    // Children must not see the parent "Family Wallets" management surface.
    expect(screen.queryByText('Family Wallets')).not.toBeInTheDocument();
  });

  it('child dashboard renders goals summary', () => {
    store.state.currentUser.role = 'child';
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const summary = screen.getByTestId('goal-summary');
    expect(summary).toBeInTheDocument();
    expect(within(summary).getByText('1')).toBeInTheDocument();
  });

  it('child dashboard renders pet box summary', () => {
    store.state.currentUser.role = 'child';
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const summary = screen.getByTestId('petbox-summary');
    expect(summary).toBeInTheDocument();
    expect(within(summary).getByText('1')).toBeInTheDocument();
  });

  it('child dashboard renders the task summary as the first quick summary', () => {
    store.state.currentUser.role = 'child';
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const tasks = screen.getByTestId('task-summary');
    const wallet = screen.getByTestId('wallet-summary');
    expect(tasks.compareDocumentPosition(wallet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('summary cards are placed above Recent Activity', () => {
    store.state.currentUser.role = 'child';
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const summary = screen.getByTestId('wallet-summary');
    const recent = screen.getByText('Recent Activity');
    expect(summary.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('child dashboard renders summary cards in Tasks -> Wallet -> Goals -> Pet Box order', () => {
    store.state.currentUser.role = 'child';
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const tasks = screen.getByTestId('task-summary');
    const wallet = screen.getByTestId('wallet-summary');
    const goals = screen.getByTestId('goal-summary');
    const petbox = screen.getByTestId('petbox-summary');
    expect(tasks.compareDocumentPosition(wallet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(wallet.compareDocumentPosition(goals) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(goals.compareDocumentPosition(petbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('places Your Requests between Quick summaries and Recent Activity', () => {
    store.state.currentUser.role = 'child';
    store.state.moneyRequests = [
      { id: 'mr-1', category: 'money_request', requesterId: 'child-1', requestedFromId: 'owner-1', amountPence: 100, status: 'pending_acceptance', createdAt: { toDate: () => new Date() } },
    ];
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const petbox = screen.getByTestId('petbox-summary');
    const requests = screen.getByText('Your Requests');
    const recent = screen.getByText('Recent Activity');
    expect(petbox.compareDocumentPosition(requests) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(requests.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
