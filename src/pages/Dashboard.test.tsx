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
    funds: [],
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
      currentUser: { id: 'c-1', familyId: 'f1', role: 'child', displayName: 'Ada' },
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

describe('Parent Living Home family tools', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['home', 'common']);
    await i18n.changeLanguage('en');
    store.state = baseState();
  });

  it('shows first-class Goals, Wallets and Pet Box actions', () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /open goals/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open wallets/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open pet box/i })).toBeInTheDocument();
  });

  it.each([
    ['Open Goals', '/goals', 'Goals destination'],
    ['Open Wallets', '/wallets', 'Wallets destination'],
    ['Open Pet Box', '/pet-box', 'Pet Box destination'],
  ])('navigates from %s to %s', async (accessibleName, path, destination) => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path={path} element={<div>{destination}</div>} />
        </Routes>
      </MemoryRouter>,
    );
    screen.getByRole('button', { name: accessibleName }).click();
    expect(await screen.findByText(destination)).toBeInTheDocument();
  });

  it('uses canonical child wallet balances and excludes any parent wallet value', () => {
    store.state = baseState({
      myWallet: { id: 'owner-1', balance: 99_999 },
      childWallets: [
        { id: 'c-1', balance: 2_450 },
        { id: 'c-2', balance: 7_550 },
      ],
      familyMembers: [
        { id: 'c-1', role: 'child', displayName: 'Ada' },
        { id: 'c-2', role: 'child', displayName: 'Grace' },
      ],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('family-tools-wallets')).toHaveTextContent('Total child balance');
    expect(screen.getByTestId('family-tools-wallets')).toHaveTextContent('£100.00');
    expect(screen.getByTestId('family-tools-wallets')).not.toHaveTextContent('£1,099.99');
  });

  it('uses the highest-progress active goal and never a completed goal', () => {
    store.state = baseState({
      savingsGoals: [
        { id: 'g-low', title: 'Books', status: 'active', currentAmountPence: 200, targetAmountPence: 1_000 },
        { id: 'g-high', title: 'Bike', status: 'active', currentAmountPence: 820, targetAmountPence: 1_000 },
        { id: 'g-done', title: 'Already bought', status: 'completed', currentAmountPence: 1_000, targetAmountPence: 1_000 },
      ],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('family-tools-goals')).toHaveTextContent('82% closest goal');
    expect(screen.getByTestId('family-tools-goals')).not.toHaveTextContent('Bike');
    expect(screen.getByTestId('family-tools-goals')).not.toHaveTextContent('Already bought');
  });

  it('uses the real summed Pet Box fund balance as its single metric', () => {
    store.state = baseState({
      funds: [
        { id: 'f-1', name: 'Milo', balance: 1_250 },
        { id: 'f-2', name: 'Luna', balance: 2_500 },
      ],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('family-tools-cat-box')).toHaveTextContent('£37.50');
    expect(screen.getByTestId('family-tools-cat-box')).toHaveTextContent('saved');
    expect(screen.getByTestId('family-tools-cat-box')).not.toHaveTextContent('2 active funds');
  });

  it('shows honest empty states without invented progress', () => {
    store.state = baseState({ savingsGoals: [], childWallets: [], funds: [] });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('family-tools-goals')).toHaveTextContent('No active goals');
    expect(screen.getByTestId('family-tools-wallets')).toHaveTextContent('No child wallets');
    expect(screen.getByTestId('family-tools-cat-box')).toHaveTextContent('No active funds');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('does not invent metrics while feature data is unavailable', () => {
    store.state = baseState({ savingsGoals: undefined, childWallets: undefined, funds: undefined });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    for (const testId of ['family-tools-goals', 'family-tools-wallets', 'family-tools-cat-box']) {
      expect(screen.getByTestId(testId)).toHaveTextContent('Not available');
    }
    for (const testId of ['family-tools-goals', 'family-tools-wallets', 'family-tools-cat-box']) {
      expect(screen.getByTestId(testId)).not.toHaveTextContent('£0.00');
    }
  });

  it('adapts the wallet support label for a single child', () => {
    store.state = baseState({
      childWallets: [{ id: 'c-1', balance: 2_450 }],
      familyMembers: [{ id: 'c-1', role: 'child', displayName: 'Ada' }],
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('family-tools-wallets')).toHaveTextContent('£24.50');
    expect(screen.getByTestId('family-tools-wallets')).toHaveTextContent('Wallet');
    expect(screen.getByTestId('family-tools-wallets')).not.toHaveTextContent('Wallets');
    expect(screen.getByTestId('family-tools-wallets')).not.toHaveTextContent('1 child wallet');
  });

  it('places Your crew before Family tools in document order', () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const crew = screen.getByRole('heading', { name: 'Your crew' });
    const tools = screen.getByRole('heading', { name: 'Family tools' });
    expect(crew.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('stacks full-width cards on mobile and never uses a horizontal carousel', () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const layout = screen.getByTestId('family-tools-layout');
    expect(layout).toHaveClass('grid', 'grid-cols-1');
    expect(layout).not.toHaveClass('overflow-x-auto');
    for (const card of screen.getAllByTestId(/family-tools-(goals|wallets|cat-box)/)) {
      expect(card).toHaveClass('w-full');
      expect(card).not.toHaveClass('min-w-[15rem]');
    }
  });

  it('uses three desktop columns when Pet Box is enabled', () => {
    store.state = baseState({ familyData: { name: 'The Testers', petBoxEnabled: true } });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.getByTestId('family-tools-layout')).toHaveClass('md:grid-cols-3');
    expect(screen.getAllByTestId(/family-tools-(goals|wallets|cat-box)/)).toHaveLength(3);
  });

  it('omits Pet Box and expands to two desktop columns when access is disabled', () => {
    store.state = baseState({ familyData: { name: 'The Testers', petBoxEnabled: false } });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.queryByTestId('family-tools-cat-box')).not.toBeInTheDocument();
    expect(screen.getByTestId('family-tools-layout')).toHaveClass('md:grid-cols-2');
    expect(screen.getAllByTestId(/family-tools-(goals|wallets)/)).toHaveLength(2);
  });

  it('never renders parent-only family tool cards on Child Home', () => {
    store.state = baseState({
      currentUser: { id: 'c-1', familyId: 'f1', role: 'child', displayName: 'Ada' },
      myWallet: { id: 'c-1', balance: 2_450 },
    });
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(screen.queryByTestId('parent-family-tools')).not.toBeInTheDocument();
    expect(screen.queryByTestId('family-tools-wallets')).not.toBeInTheDocument();
    expect(screen.getByTestId('child-living-home')).toBeInTheDocument();
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
