import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';

const api = vi.hoisted(() => ({
  approveJoinRequest: vi.fn(), rejectJoinRequest: vi.fn(),
  depositToWallet: vi.fn(), withdrawFromWallet: vi.fn(), transferWalletFunds: vi.fn(),
}));
const h = vi.hoisted(() => ({ navigate: vi.fn() }));
const store = vi.hoisted(() => ({ state: {} as any }));

vi.mock('../../lib/api', () => api);
vi.mock('../../store/useStore', () => ({ useStore: () => store.state }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => h.navigate };
});
vi.mock('../reversals/ReversalHistoryPanel', () => ({ ReversalHistoryPanel: () => null }));
vi.mock('../reversals/HistoryActionControl', () => ({ HistoryActionControl: () => null }));
vi.mock('../forms/TaskFormModal', () => ({ TaskFormModal: () => null }));
vi.mock('../forms/RewardFormModal', () => ({ RewardFormModal: () => null }));
vi.mock('../forms/BehaviourFormModal', () => ({ BehaviourFormModal: () => null }));
vi.mock('../bulletin/FamilyBulletin', () => ({ FamilyBulletin: () => <div>Weekly Warriors</div> }));
vi.mock('../dashboard/WalletSummaryCard', () => ({ WalletSummaryCard: () => <div>Wallet Summary</div> }));
vi.mock('../dashboard/GoalSummaryCard', () => ({ GoalSummaryCard: () => <div>Goal Summary</div> }));
vi.mock('../dashboard/RewardsSummaryCard', () => ({ RewardsSummaryCard: () => <div>Rewards Summary</div> }));
vi.mock('../dashboard/PetBoxSummaryCard', () => ({ PetBoxSummaryCard: () => <div>Pet Box Summary</div> }));
vi.mock('./dashboard/ChildrenOverview', () => ({ ChildrenOverview: () => <div>Children Overview</div> }));
vi.mock('./dashboard/RecentActivity', () => ({ RecentActivity: () => <div>Recent Activity</div> }));
vi.mock('./dashboard/PendingApprovalsSection', () => ({ PendingApprovalsSection: () => <div>Pending Approvals</div> }));

import { ParentDashboard } from './ParentDashboard';

const owner = { id: 'owner-1', uid: 'owner-1', familyId: 'family-1', role: 'owner', displayName: 'Kemal' };
const child = { id: 'child-1', role: 'child', displayName: 'Ada' };

function baseState(overrides: Record<string, unknown> = {}) {
  return {
    currentUser: owner,
    familyData: { id: 'family-1', currency: '£', inviteCode: 'ABC123' },
    familyMembers: [owner],
    tasks: [], feed: [], rewards: [], childWallets: [], walletTransactions: [],
    joinRequests: [], taskCompletions: [],
    loading: false, appReady: true, familyLoading: false,
    bootstrapStatus: { family: 'ready', members: 'ready', wallets: 'ready', tasks: 'ready', rewards: 'ready' },
    ...overrides,
  } as any;
}

/** An established family: real members, rewards and tasks. */
function establishedState(overrides: Record<string, unknown> = {}) {
  return baseState({
    familyMembers: [owner, child, { id: 'p2', role: 'parent', displayName: 'Sam' }],
    rewards: [{ id: 'r1', name: 'Cinema' }, { id: 'r2', name: 'Ice cream' }],
    tasks: [{ id: 't1', title: 'Tidy room' }, { id: 't2', title: 'Homework' }],
    ...overrides,
  });
}

const renderDashboard = () => render(<MemoryRouter><ParentDashboard /></MemoryRouter>);

const queryInviteCard = () =>
  screen.queryByText('ABC123') ?? screen.queryByRole('button', { name: /invite/i });

beforeEach(async () => {
  vi.clearAllMocks();
  store.state = establishedState();
  await i18n.loadNamespaces([
    'common', 'auth', 'family', 'tasks', 'wallet', 'goals', 'rewards',
    'dashboard', 'approvals', 'settings', 'notifications', 'errors',
    'behaviour', 'profile', 'funds', 'requests', 'reversals',
  ]);
  await i18n.changeLanguage('en');
});

describe('ParentDashboard — established family (P0 regression)', () => {
  it('does not render the Invite Member card on Home', () => {
    renderDashboard();
    expect(queryInviteCard()).not.toBeInTheDocument();
  });

  it('does not render "You\'re all set" or any setup completion banner', () => {
    renderDashboard();
    expect(screen.queryByText(/you're all set/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/continue setup/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-focus-mode')).not.toBeInTheDocument();
  });

  it('renders the normal dashboard widgets immediately', () => {
    renderDashboard();
    for (const label of [
      'Weekly Warriors', 'Wallet Summary', 'Goal Summary', 'Rewards Summary',
      'Children Overview', 'Recent Activity', 'Pending Approvals',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('does not flash onboarding UI while data is loading', () => {
    store.state = establishedState({ loading: true });
    renderDashboard();
    expect(queryInviteCard()).not.toBeInTheDocument();
    expect(screen.queryByText(/you're all set/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-focus-mode')).not.toBeInTheDocument();
  });

  it('does not show the invite card during partial store hydration', () => {
    // Members hydrated first, rewards/tasks still empty collections.
    store.state = baseState({
      familyMembers: [owner, child],
      rewards: [],
      tasks: [],
      familyLoading: true,
      bootstrapStatus: { family: 'ready', members: 'loading', wallets: 'loading' },
    });
    renderDashboard();
    expect(queryInviteCard()).not.toBeInTheDocument();
    expect(screen.queryByText(/you're all set/i)).not.toBeInTheDocument();
  });

  it('still guides a brand new family through Focus Mode', () => {
    store.state = baseState();
    renderDashboard();
    expect(screen.getByTestId('dashboard-focus-mode')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add your first child' })).toHaveLength(1);
  });
});
