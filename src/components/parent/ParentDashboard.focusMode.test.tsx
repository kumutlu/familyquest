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
    bootstrapStatus: { family: 'ready', members: 'ready', wallets: 'ready' },
    ...overrides,
  } as any;
}

const renderDashboard = () => render(<MemoryRouter><ParentDashboard /></MemoryRouter>);

beforeEach(async () => {
  vi.clearAllMocks();
  store.state = baseState();
  await i18n.loadNamespaces([
    'common', 'auth', 'family', 'tasks', 'wallet', 'goals', 'rewards',
    'dashboard', 'approvals', 'settings', 'notifications', 'errors',
    'behaviour', 'profile', 'funds', 'requests', 'reversals',
  ]);
  await i18n.changeLanguage('en');
});

describe('ParentDashboard Focus Mode', () => {
  it('enters focus mode when setup is incomplete', () => {
    renderDashboard();
    expect(screen.getByTestId('dashboard-focus-mode')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
  });

  it('hides every non-essential dashboard widget while focus mode is active', () => {
    renderDashboard();
    for (const label of [
      'Weekly Warriors', 'Wallet Summary', 'Goal Summary', 'Rewards Summary',
      'Children Overview', 'Recent Activity', 'Pending Approvals', 'Quick Actions',
    ]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('renders exactly one primary CTA', () => {
    renderDashboard();
    expect(screen.getAllByRole('button', { name: 'Add your first child' })).toHaveLength(1);
    // The legacy duplicate onboarding surfaces must not appear alongside it.
    expect(screen.queryByRole('button', { name: 'Add Child' })).not.toBeInTheDocument();
    expect(screen.queryByText('Continue Setup')).not.toBeInTheDocument();
  });

  it('leaves focus mode automatically once setup is complete', () => {
    store.state = baseState({
      familyMembers: [owner, child],
      rewards: [{ id: 'r1' }],
      tasks: [{ id: 't1' }],
    });
    renderDashboard();
    expect(screen.queryByTestId('dashboard-focus-mode')).not.toBeInTheDocument();
    expect(screen.getByText('Children Overview')).toBeInTheDocument();
    expect(screen.getByText('Recent Activity')).toBeInTheDocument();
  });

  it('never applies focus mode to an existing activated family', () => {
    store.state = baseState({
      familyMembers: [owner, child, { id: 'p2', role: 'parent' }],
      rewards: [{ id: 'r1' }, { id: 'r2' }],
      tasks: [{ id: 't1' }, { id: 't2' }],
      joinRequests: [{ id: 'jr1', status: 'pending', uid: 'x', displayName: 'New' }],
    });
    renderDashboard();
    expect(screen.queryByTestId('dashboard-focus-mode')).not.toBeInTheDocument();
    expect(screen.getByText('Weekly Warriors')).toBeInTheDocument();
  });

  it('does not put children into focus mode', () => {
    store.state = baseState({ currentUser: { ...child, familyId: 'family-1' }, familyMembers: [child] });
    renderDashboard();
    expect(screen.queryByTestId('dashboard-focus-mode')).not.toBeInTheDocument();
  });
});
