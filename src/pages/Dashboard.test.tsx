import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/config';

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
    rewards: [{ id: 'r-1', title: 'Gold Star' }],
    taskCompletions: [],
    moneyRequests: [] as any[],
    myGamificationSummary: null,
    myDailyProgress: null,
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
vi.mock('../components/dashboard/GamificationSummaryCard', () => ({
  GamificationSummaryCard: ({ summary }: { summary: any }) => (
    <div data-testid="gamification-summary">
      {summary?.isAvailable ? `Level ${summary.level}` : 'Loading…'}
    </div>
  ),
}));
vi.mock('../components/dashboard/TaskSummaryCard', () => ({
  TaskSummaryCard: () => <div data-testid="task-summary">Tasks</div>,
}));
vi.mock('../components/dashboard/WalletSummaryCard', () => ({
  WalletSummaryCard: () => <div data-testid="wallet-summary">Wallet</div>,
}));
vi.mock('../components/dashboard/GoalSummaryCard', () => ({
  GoalSummaryCard: () => <div data-testid="goal-summary">Goals</div>,
}));
vi.mock('../components/dashboard/PetBoxSummaryCard', () => ({
  PetBoxSummaryCard: () => <div data-testid="petbox-summary">PetBox</div>,
}));

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
      // Activated family (child + reward + task) so Focus Mode stays off.
      rewards: [{ id: 'r-1', title: 'Gold Star' }],
      taskCompletions: [],
      moneyRequests: [],
      myGamificationSummary: null,
      myDailyProgress: null,
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

  it('does not claim recent activity is empty while the feed is pending', () => {
    store.state.currentUser.role = 'child';
    store.state.bootstrapStatus = { feed: 'loading' };
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('recent-activity-loading')).toBeInTheDocument();
    expect(screen.queryByText('No family activity yet.')).not.toBeInTheDocument();
  });

  it('treats the legacy admin role as a parent (isParentRole, not strict parent)', () => {
    store.state.currentUser.role = 'admin';
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByText('Approval Center Section')).toBeInTheDocument();
  });
});

describe('Dashboard summary cards', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['dashboard', 'requests', 'wallet']);
    await i18n.changeLanguage('en');
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
      rewards: [{ id: 'r-1', title: 'Gold Star' }],
      taskCompletions: [],
      moneyRequests: [],
      myGamificationSummary: null,
      myDailyProgress: null,
    };
  });

  it('parent dashboard renders wallet summary with family aggregate', () => {
    store.state.currentUser.role = 'parent';
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const summary = screen.getByTestId('wallet-summary');
    expect(summary).toBeInTheDocument();
    // Parent sees the family aggregate surface, never the child "My Wallet".
    expect(screen.queryByText('My Wallet')).not.toBeInTheDocument();
  });

  it('child dashboard renders the correct wallet summary (own balance)', () => {
    store.state.currentUser.role = 'child';
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('wallet-summary')).toBeInTheDocument();
    // Children must not see the parent "Family Wallets" management surface.
    expect(screen.queryByText('Family Wallets')).not.toBeInTheDocument();
  });

  it('child dashboard renders goals summary', () => {
    store.state.currentUser.role = 'child';
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const summary = screen.getByTestId('goal-summary');
    expect(summary).toBeInTheDocument();
  });

  it('child dashboard renders pet box summary', () => {
    store.state.currentUser.role = 'child';
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const summary = screen.getByTestId('petbox-summary');
    expect(summary).toBeInTheDocument();
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

  it('child dashboard renders gamification summary above quick summaries', () => {
    store.state.currentUser.role = 'child';
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const gamification = screen.getByTestId('gamification-summary');
    const tasks = screen.getByTestId('task-summary');
    // Gamification summary appears before quick summaries section
    expect(gamification.compareDocumentPosition(tasks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

describe('Dashboard gamification summary', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['dashboard', 'requests', 'wallet']);
    await i18n.changeLanguage('en');
  });

  it('child dashboard shows loading state when summary is unavailable', () => {
    store.state = {
      currentUser: { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Child' },
      feed: [],
      loading: false,
      myWallet: { id: 'w-1', balance: 100 },
      childWallets: [],
      familyMembers: [],
      savingsGoals: [],
      funds: [],
      tasks: [],
      taskCompletions: [],
      moneyRequests: [],
      myGamificationSummary: null,
      myDailyProgress: null,
    };
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('gamification-summary')).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('child dashboard shows level when summary is available', () => {
    store.state = {
      currentUser: { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Child' },
      feed: [],
      loading: false,
      myWallet: { id: 'w-1', balance: 100 },
      childWallets: [],
      familyMembers: [],
      savingsGoals: [],
      funds: [],
      tasks: [],
      taskCompletions: [],
      moneyRequests: [],
      myGamificationSummary: {
        schemaVersion: 1,
        familyId: 'family-1',
        childId: 'child-1',
        xpTotal: 1500,
        level: 2,
        currentStreak: 1,
        bestStreak: 3,
        perfectDayCount: 0,
        lastQualifiedDayKey: null,
        projectionRevision: 1,
        foldedThrough: null,
        rebuildRequired: false,
        earliestDirtyCursor: null,
        projectionStatus: 'ready',
        updatedAt: Date.now(),
      },
      myDailyProgress: {
        schemaVersion: 1,
        familyId: 'family-1',
        childId: 'child-1',
        dayKey: '20240115',
        timezone: 'Europe/London',
        eligibilitySnapshotId: 'snap1',
        dailyGoalPercentage: 80,
        eligiblePoints: 100,
        approvedPoints: 80,
        eligibleTaskCount: 4,
        approvedTaskCount: 3,
        progressPercentage: 80,
        dailyGoalReached: true,
        perfectDayReached: false,
        finalized: true,
        contributingLogicalCompletionKeys: [],
        invalidatedLogicalCompletionKeys: [],
        calculatedAt: Date.now(),
      },
    };
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('gamification-summary')).toBeInTheDocument();
    expect(screen.getByText('Level 2')).toBeInTheDocument();
  });

  it('child dashboard shows rebuilding state when rebuildRequired is true', () => {
    store.state = {
      currentUser: { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Child' },
      feed: [],
      loading: false,
      myWallet: { id: 'w-1', balance: 100 },
      childWallets: [],
      familyMembers: [],
      savingsGoals: [],
      funds: [],
      tasks: [],
      taskCompletions: [],
      moneyRequests: [],
      myGamificationSummary: {
        schemaVersion: 1,
        familyId: 'family-1',
        childId: 'child-1',
        xpTotal: 1500,
        level: 2,
        currentStreak: 1,
        bestStreak: 3,
        perfectDayCount: 1,
        lastQualifiedDayKey: null,
        projectionRevision: 1,
        foldedThrough: null,
        rebuildRequired: true,
        earliestDirtyCursor: null,
        projectionStatus: 'ready',
        updatedAt: Date.now(),
      },
      myDailyProgress: null,
    };
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('gamification-summary')).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('child dashboard shows no misleading zeroes when summary is unavailable', () => {
    store.state = {
      currentUser: { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Child' },
      feed: [],
      loading: false,
      myWallet: { id: 'w-1', balance: 100 },
      childWallets: [],
      familyMembers: [],
      savingsGoals: [],
      funds: [],
      tasks: [],
      taskCompletions: [],
      moneyRequests: [],
      myGamificationSummary: null,
      myDailyProgress: null,
    };
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    // Should show "Loading…" not "0" for streaks/level
    expect(screen.queryByText('Level 0')).not.toBeInTheDocument();
    expect(screen.queryByText('Current Streak')).not.toBeInTheDocument();
  });
});
