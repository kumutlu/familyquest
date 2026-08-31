import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/config';

const store = vi.hoisted(() => ({ state: {} as any }));

vi.mock('../store/useStore', () => ({ useStore: () => store.state }));
// The approvals sheet embeds the real Approval Center behind a Wave 1 sheet;
// its internals are covered by its own tests.
vi.mock('../components/parent/ApprovalCenter', () => ({
  ApprovalCenter: () => <div>Approval Center Section</div>,
}));

import { Dashboard } from './Dashboard';

const readyBootstrap = {
  members: 'ready',
  tasks: 'ready',
  rewards: 'ready',
  feed: 'ready',
  wallet: 'ready',
} as any;

function baseState(overrides: Record<string, unknown> = {}) {
  return {
    currentUser: {
      id: 'owner-1',
      familyId: 'family-1',
      role: 'owner',
      displayName: 'Kemal',
      rewardPoints: 0,
    },
    familyMembers: [{ id: 'c-1', role: 'child', displayName: 'Ada' }],
    familyData: { name: 'The Testers' },
    loading: false,
    feed: [],
    // Activated family (child + reward + task) so Focus Mode stays off.
    tasks: [{ id: 't-1', title: 'Brush teeth', isActive: true, assigneeId: 'c-1' }],
    rewards: [{ id: 'r-1', title: 'Gold Star', pointsCost: 10 }],
    taskCompletions: [],
    transferRequests: [],
    moneyRequests: [],
    petboxRequests: [],
    profileUpdateRequests: [],
    goalRequests: [],
    childJoinRequests: [],
    savingsGoals: [],
    challenges: [],
    walletTransactions: [],
    myWallet: null,
    childWallets: [],
    myGamificationSummary: null,
    myDailyProgress: null,
    bootstrapStatus: readyBootstrap,
    retryFeature: () => undefined,
    ...overrides,
  };
}

describe('Dashboard role routing (Queki v2)', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['home', 'common', 'dashboard']);
    await i18n.changeLanguage('en');
    store.state = baseState();
  });

  it.each(['parent', 'owner', 'admin'])('renders the Parent Living Home for %s', role => {
    store.state = baseState({
      currentUser: { id: 'p1', familyId: 'f1', role, displayName: 'Kemal', rewardPoints: 0 },
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('parent-living-home')).toBeInTheDocument();
    expect(screen.queryByTestId('child-living-home')).not.toBeInTheDocument();
  });

  it('renders the Child Living Home for the child role', () => {
    store.state = baseState({
      currentUser: { id: 'c-1', familyId: 'f1', role: 'child', displayName: 'Ada', rewardPoints: 10 },
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('child-living-home')).toBeInTheDocument();
    expect(screen.queryByTestId('parent-living-home')).not.toBeInTheDocument();
  });

  it('renders Child Living Home even when an optional background resource failed', () => {
    store.state = baseState({
      currentUser: { id: 'c-1', familyId: 'f1', role: 'child', displayName: 'Ada' },
      bootstrapStatus: {
        ...readyBootstrap,
        goalRequests: 'error',
        petboxRequests: 'error',
      },
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('child-living-home')).toBeInTheDocument();
    expect(screen.queryByTestId('living-home-error')).not.toBeInTheDocument();
  });
});

describe('Parent Living Home priorities', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['home', 'common']);
    await i18n.changeLanguage('en');
  });

  it('surfaces the compact approvals card while items are pending', () => {
    store.state = baseState({
      taskCompletions: [
        { id: 'c1', status: 'pending_approval' },
        { id: 'c2', status: 'pending_approval' },
        { id: 'c3', status: 'pending_approval' },
      ],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('priority-approvals')).toBeInTheDocument();
    expect(screen.getByText('3 waiting for you')).toBeInTheDocument();
    // The full history is NOT on Home — it lives behind the review sheet.
    expect(screen.queryByText('Approval Center Section')).not.toBeInTheDocument();
  });

  it('shows the calm state instead of an approvals card when nothing is pending', () => {
    store.state = baseState();
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.queryByTestId('priority-approvals')).not.toBeInTheDocument();
    expect(screen.getByTestId('parent-all-calm')).toBeInTheDocument();
  });

  it('never renders the legacy activity feed or reversal history as primary content', () => {
    store.state = baseState({
      feed: [
        { id: 'f1', text: 'Old activity entry', timestamp: new Date() },
        { id: 'f2', text: 'Another old entry', timestamp: new Date() },
      ],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.queryByText('Old activity entry')).not.toBeInTheDocument();
    expect(screen.queryByText('Recent Activity')).not.toBeInTheDocument();
  });

  it('makes the Family Wallet hero a labelled action to the canonical Wallets overview', async () => {
    store.state = baseState({ childWallets: [{ id: 'c-1', balance: 62537 }] });
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/wallets" element={<div>Wallets overview</div>} />
        </Routes>
      </MemoryRouter>,
    );
    const walletAction = screen.getByRole('link', { name: /open family wallets/i });
    expect(walletAction).toHaveClass('cursor-pointer');
    walletAction.click();
    expect(await screen.findByText('Wallets overview')).toBeInTheDocument();
  });

  it('keeps Focus Mode for families whose setup is still incomplete', () => {
    store.state = baseState({ tasks: [], rewards: [] });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('dashboard-focus-mode')).toBeInTheDocument();
    expect(screen.queryByTestId('parent-living-home')).not.toBeInTheDocument();
  });
});

describe('Family-size adaptation', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['home', 'common']);
    await i18n.changeLanguage('en');
  });

  it('single-child families get one focused overview card, not a scroller', () => {
    store.state = baseState({
      familyMembers: [{ id: 'c-1', role: 'child', displayName: 'Ada' }],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('children-overview-single')).toBeInTheDocument();
    expect(screen.queryByTestId('children-overview-multi')).not.toBeInTheDocument();
  });

  it('multi-child families get the scalable overview row', () => {
    store.state = baseState({
      familyMembers: [
        { id: 'c-1', role: 'child', displayName: 'Ada' },
        { id: 'c-2', role: 'child', displayName: 'Grace' },
        { id: 'c-3', role: 'child', displayName: 'Alan' },
      ],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('children-overview-multi')).toBeInTheDocument();
    expect(screen.queryByTestId('children-overview-single')).not.toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Grace')).toBeInTheDocument();
    expect(screen.getByText('Alan')).toBeInTheDocument();
  });
});

describe('Child Living Home semantics (XP ≠ points ≠ money)', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['home', 'common']);
    await i18n.changeLanguage('en');
    store.state = baseState({
      currentUser: { id: 'c-1', familyId: 'f1', role: 'child', displayName: 'Ada', rewardPoints: 120 },
      myGamificationSummary: {
        xpTotal: 240,
        level: 2,
        currentStreak: 4,
        bestStreak: 9,
        rebuildRequired: false,
      },
      myWallet: { id: 'w-1', balance: 500 },
    });
  });

  it('renders XP with its gold identity and explicit unit', () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('child-xp-panel')).toHaveTextContent('XP');
    expect(screen.getByTestId('child-xp-panel')).toHaveTextContent('240');
  });

  it('renders points with an explicit pts unit, visually separate from XP', () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByLabelText('120 points')).toBeInTheDocument();
  });

  it('renders real money formatted as currency, never a bare number', () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('child-balance-chip')).toHaveTextContent('£5.00');
  });

  it('keeps streak meaning independent from both currencies', () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByLabelText('4 day streak')).toBeInTheDocument();
  });

  it('renders loading skeleton while core tasks/members are loading', () => {
    store.state = {
      ...store.state,
      bootstrapStatus: { ...readyBootstrap, tasks: 'loading' },
    };
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('child-living-home')).toBeInTheDocument();
    expect(screen.queryByTestId('child-all-done')).not.toBeInTheDocument();
  });

  it('renders recoverable error when core task resource fails', () => {
    store.state = {
      ...store.state,
      bootstrapStatus: { ...readyBootstrap, tasks: 'error' },
    };
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('living-home-error')).toBeInTheDocument();
    expect(screen.queryByTestId('child-living-home')).not.toBeInTheDocument();
  });

  it('renders without error when optional wallet or gamification data is null', () => {
    store.state = {
      ...store.state,
      myWallet: null,
      myGamificationSummary: null,
      myDailyProgress: null,
    };
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('child-living-home')).toBeInTheDocument();
    expect(screen.queryByTestId('child-balance-chip')).not.toBeInTheDocument();
  });
});
