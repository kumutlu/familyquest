import { fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import i18n from '../../i18n/config';
import { bootstrapResources } from '../../lib/bootstrapQueries';
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext';
import { MoneyPrivacyToggle } from '../privacy/MoneyPrivacyToggle';

const store = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));

vi.mock('../../store/useStore', () => ({
  useStore: (selector?: (state: typeof store.state) => unknown) =>
    typeof selector === 'function' ? selector(store.state) : store.state,
}));

vi.mock('../reversals/HistoryActionControl', () => ({
  HistoryActionControl: ({ sourceKind, source }: { sourceKind: string; source: { id: string } }) => (
    <span>{`history-action:${sourceKind}:${source.id}`}</span>
  ),
}));

import { TransactionHistoryScreen } from './TransactionHistoryScreen';

function render(ui: ReactElement) {
  return rtlRender(<MoneyPrivacyProvider>{ui}</MoneyPrivacyProvider>);
}

const currentTimestamp = () => ({ toMillis: () => Date.now() });
const consumedHistoryResources = [
  'members',
  'walletTransactions',
  'savingsGoals',
  'goalLedger',
  'rewards',
  'redemptions',
  'behaviourEvents',
  'funds',
  'petboxRequests',
  'transferRequests',
  'moneyRequests',
  'reversals',
] as const;

function baseStore(): Record<string, unknown> {
  const bootstrapStatus = Object.fromEntries(
    bootstrapResources.map(resource => [resource, resource === 'reversals' ? 'idle' : 'ready']),
  );

  return {
    currentUser: {
      id: 'child-1',
      familyId: 'family-1',
      role: 'child',
      displayName: 'Alex',
    },
    familyData: { id: 'family-1', currencyCode: 'TRY', currency: '£' },
    familyMembers: [
      { id: 'child-1', displayName: 'Alex' },
      { id: 'parent-1', displayName: 'Taylor' },
    ],
    rewards: [{ id: 'reward-1', title: 'Movie Night' }],
    savingsGoals: [{
      id: 'goal-1',
      title: 'New Bike',
      targetAmountPence: 20_000,
      currentAmountPence: 5_000,
    }],
    funds: [{ id: 'fund-1', name: 'Pet Box' }],
    walletTransactions: [],
    reversals: [],
    goalLedger: [],
    redemptions: [],
    behaviourEvents: [],
    petboxRequests: [],
    transferRequests: [],
    moneyRequests: [],
    loading: false,
    bootstrapError: null,
    bootstrapStatus,
    featureErrors: {},
    retryBootstrap: vi.fn(),
  };
}

beforeEach(async () => {
  localStorage.clear();
  await i18n.loadNamespaces(['common', 'wallet', 'goals', 'rewards', 'reversals']);
  await i18n.changeLanguage('en');
  store.state = baseStore();
});

describe('TransactionHistoryScreen states', () => {
  it('announces loading progress', () => {
    store.state.loading = true;

    render(<TransactionHistoryScreen />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading wallet');
  });

  it('shows a friendly alert and retries a failed bootstrap', () => {
    const retryBootstrap = vi.fn();
    store.state.currentUser = null;
    store.state.bootstrapError = 'FirebaseError: permission-denied';
    store.state.retryBootstrap = retryBootstrap;

    render(<TransactionHistoryScreen />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("We couldn't load recent activity.");
    expect(alert).not.toHaveTextContent('permission-denied');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(retryBootstrap).toHaveBeenCalledOnce();
  });

  it('renders the accessible empty state when no source has activity', () => {
    render(<TransactionHistoryScreen />);

    expect(screen.getByRole('heading', { name: 'Recent Transactions' })).toBeInTheDocument();
    expect(screen.getByText('No wallet activity yet')).toBeInTheDocument();
    expect(screen.getAllByText('Money added or sent will appear here.')).toHaveLength(2);
  });

  it.each(consumedHistoryResources)(
    'keeps loading while consumed resource %s is unresolved',
    resource => {
      store.state.bootstrapStatus = {
        ...(store.state.bootstrapStatus as Record<string, string>),
        [resource]: 'loading',
      };

      render(<TransactionHistoryScreen />);

      expect(screen.getByRole('status')).toHaveTextContent('Loading transaction history');
      expect(screen.queryByText('No wallet activity yet')).not.toBeInTheDocument();
    },
  );

  it('surfaces a failed optional history source and retries without showing a false empty state', () => {
    const retryBootstrap = vi.fn();
    store.state.bootstrapStatus = {
      ...(store.state.bootstrapStatus as Record<string, string>),
      transferRequests: 'error',
    };
    store.state.featureErrors = {
      transferRequests: '[Transfer requests] permission-denied: denied',
    };
    store.state.retryBootstrap = retryBootstrap;

    render(<TransactionHistoryScreen />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("We couldn't load transaction history.");
    expect(alert).not.toHaveTextContent('permission-denied');
    expect(screen.queryByText('No wallet activity yet')).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(retryBootstrap).toHaveBeenCalledOnce();
  });

  it('recognizes a child money-request listener error keyed by listener suffix', () => {
    store.state.bootstrapStatus = {
      ...(store.state.bootstrapStatus as Record<string, string>),
      moneyRequests: 'error',
    };
    store.state.featureErrors = {
      'moneyRequests:0': '[Money requests] unavailable: offline',
    };

    render(<TransactionHistoryScreen />);

    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load transaction history.");
    expect(screen.queryByText('No wallet activity yet')).not.toBeInTheDocument();
  });
});

describe('TransactionHistoryScreen interactions', () => {
  it('toggles money rows, balances, and details without masking points or changing actions', () => {
    store.state.walletTransactions = [{
      id: 'private-history-row',
      type: 'deposit',
      amountPence: 37_461,
      balanceAfter: 26_350,
      status: 'completed',
      childId: 'child-1',
      description: 'Private history deposit',
      createdAt: currentTimestamp(),
    }];
    store.state.redemptions = [{
      id: 'private-history-points',
      rewardId: 'reward-1',
      userId: 'child-1',
      costPaid: 83,
      status: 'completed',
      familyId: 'family-1',
      createdAt: currentTimestamp(),
      redeemedAt: currentTimestamp(),
    }];

    render(
      <>
        <MoneyPrivacyToggle />
        <TransactionHistoryScreen />
      </>,
    );

    expect(document.body.innerHTML).toContain('374.61');
    expect(document.body.innerHTML).toContain('263.50');
    expect(screen.getByText('-83 points')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));

    expect(document.body.innerHTML).not.toContain('374.61');
    expect(document.body.innerHTML).not.toContain('263.50');
    expect(screen.getByText('-83 points')).toBeInTheDocument();
    const moneyRow = screen.getByRole('button', { name: /added to Alex’s wallet/ });
    expect(moneyRow).not.toHaveAccessibleName(/374\.61|263\.50/);

    fireEvent.click(moneyRow);
    expect(screen.getByRole('dialog', { name: 'Transaction Details' })).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('374.61');
    expect(document.body.innerHTML).not.toContain('263.50');

    fireEvent.click(screen.getByRole('button', { name: 'Show money amounts' }));
    expect(document.body.innerHTML).toContain('374.61');
    expect(document.body.innerHTML).toContain('263.50');
  });

  it('uses store reward data and presents point transactions as points', () => {
    store.state.redemptions = [{
      id: 'redemption-1',
      rewardId: 'reward-1',
      userId: 'child-1',
      costPaid: 75,
      status: 'completed',
      familyId: 'family-1',
      createdAt: currentTimestamp(),
      redeemedAt: currentTimestamp(),
    }];

    render(<TransactionHistoryScreen />);

    expect(screen.getAllByText(/Movie Night/).length).toBeGreaterThan(0);
    expect(screen.getByText('-75 points')).toBeInTheDocument();
  });

  it('filters transactions by category and exposes the pressed state', () => {
    store.state.walletTransactions = [
      {
        id: 'income-1',
        type: 'deposit',
        amountPence: 1_000,
        status: 'completed',
        childId: 'child-1',
        description: 'Pocket money',
        createdAt: currentTimestamp(),
      },
      {
        id: 'expense-1',
        type: 'withdrawal',
        amountPence: -250,
        status: 'completed',
        childId: 'child-1',
        description: 'Cinema ticket',
        createdAt: currentTimestamp(),
      },
    ];

    render(<TransactionHistoryScreen />);

    const expenseFilter = screen.getByRole('button', { name: 'Expense' });
    fireEvent.click(expenseFilter);
    expect(expenseFilter).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Cinema ticket/)).toBeInTheDocument();
    expect(screen.queryByText(/Pocket money/)).not.toBeInTheDocument();
    expect(screen.getByTestId('human-readable-event-card')).toHaveTextContent(/-(?:₺|TRY\s*)2\.50/);
  });

  it('searches transaction context and clears the query accessibly', async () => {
    store.state.walletTransactions = [
      {
        id: 'parent-deposit',
        type: 'deposit',
        amountPence: 500,
        status: 'completed',
        childId: 'child-1',
        parentRef: 'parent-1',
        description: 'Weekly allowance',
        createdAt: currentTimestamp(),
      },
      {
        id: 'other-deposit',
        type: 'deposit',
        amountPence: 300,
        status: 'completed',
        childId: 'child-1',
        description: 'Bonus',
        createdAt: currentTimestamp(),
      },
    ];

    render(<TransactionHistoryScreen />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search transactions...' }), {
      target: { value: 'allowance' },
    });
    await waitFor(() => expect(screen.queryByText(/Bonus/)).not.toBeInTheDocument());
    expect(screen.getByText(/Weekly allowance/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText(/Bonus/)).toBeInTheDocument();
  });

  it('uses structured names for parent-history rows and searches linked transfer parties', async () => {
    store.state.familyMembers = [
      { id: 'child-1', displayName: 'Alex' },
      { id: 'child-2', displayName: 'Sam' },
      { id: 'parent-1', displayName: 'Taylor' },
    ];
    store.state.walletTransactions = [{
      id: 'family-transfer-leg',
      type: 'transfer_out',
      amountPence: 400,
      status: 'completed',
      childId: 'child-1',
      counterpartyChildId: 'child-2',
      transferRequestId: 'family-transfer',
      actorId: 'parent-1',
      note: 'Shared project',
      createdAt: currentTimestamp(),
    }];
    store.state.transferRequests = [{
      id: 'family-transfer',
      fromChildId: 'child-1',
      toChildId: 'child-2',
      amountPence: 400,
      status: 'approved',
      createdAt: currentTimestamp(),
    }];

    render(<TransactionHistoryScreen />);

    expect(screen.getByText(/sent from Alex to Sam/)).toBeInTheDocument();
    expect(screen.getByText('Performed by: Alex')).toBeInTheDocument();
    expect(screen.getByText('Approved by: Taylor')).toBeInTheDocument();
    expect(screen.getByText('Shared project').parentElement).toHaveTextContent('Note: Shared project');

    fireEvent.click(screen.getByRole('button', { name: /sent from Alex to Sam/ }));
    const details = screen.getByRole('dialog', { name: 'Transaction Details' });
    expect(within(details).getByText('From')).toBeInTheDocument();
    expect(within(details).getByText('Sam')).toBeInTheDocument();
    expect(within(details).getByText('Approved by')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search transactions...' }), {
      target: { value: 'sam' },
    });

    await waitFor(() => expect(screen.getByText(/sent from Alex to Sam/)).toBeInTheDocument());
  });

  it('distinguishes filtered no-results from a truly empty history and clears the filter', () => {
    store.state.walletTransactions = [{
      id: 'income-1',
      type: 'deposit',
      amountPence: 1_000,
      status: 'completed',
      childId: 'child-1',
      description: 'Pocket money',
      createdAt: currentTimestamp(),
    }];

    render(<TransactionHistoryScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Expense' }));
    expect(screen.getByText('No matching transactions')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 transactions shown');
    expect(screen.queryByText('No wallet activity yet')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    expect(screen.getByText(/Pocket money/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 transaction shown');
  });

  it('offers a contextual clear action when search has no results', async () => {
    store.state.walletTransactions = [{
      id: 'income-1',
      type: 'deposit',
      amountPence: 1_000,
      status: 'completed',
      childId: 'child-1',
      description: 'Pocket money',
      createdAt: currentTimestamp(),
    }];

    render(<TransactionHistoryScreen />);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search transactions...' }), {
      target: { value: 'cinema' },
    });
    await waitFor(() => expect(screen.getByText('No matching transactions')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    expect(screen.getByText(/Pocket money/)).toBeInTheDocument();
  });

  it('uses Turkish history and adapter copy without English fallback text', async () => {
    await i18n.changeLanguage('tr');
    store.state.walletTransactions = [{
      id: 'expense-tr',
      type: 'withdrawal',
      amountPence: -250,
      status: 'completed',
      childId: 'child-1',
      description: 'Sinema bileti',
      createdAt: currentTimestamp(),
    }];

    render(<TransactionHistoryScreen />);

    expect(await screen.findByText(/Alex adlı çocuğun cüzdanından çekildi/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'İşlemleri ara...' }), {
      target: { value: 'sinema' },
    });
    expect(screen.getByRole('button', { name: 'Aramayı temizle' })).toBeInTheDocument();
  });

  it('formats reward transaction amounts as Turkish points', async () => {
    await i18n.changeLanguage('tr');
    store.state.redemptions = [{
      id: 'redemption-tr',
      rewardId: 'reward-1',
      userId: 'child-1',
      costPaid: 75,
      status: 'completed',
      familyId: 'family-1',
      createdAt: currentTimestamp(),
      redeemedAt: currentTimestamp(),
    }];

    render(<TransactionHistoryScreen />);

    expect(await screen.findByText('-75 puan')).toBeInTheDocument();
    expect(screen.queryByText(/points/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /-75 puan/ }));
    expect(within(screen.getByRole('dialog', { name: 'İşlem Ayrıntıları' }))
      .getAllByText('-75 puan').length).toBeGreaterThan(0);
  });

  it('opens labelled details and closes them with Escape', () => {
    store.state.walletTransactions = [{
      id: 'expense-1',
      type: 'withdrawal',
      amountPence: -250,
      status: 'completed',
      childId: 'child-1',
      description: 'Cinema ticket',
      createdAt: currentTimestamp(),
    }];

    render(<TransactionHistoryScreen />);

    fireEvent.click(screen.getByRole('button', { name: /withdrawn from Alex’s wallet.*-(?:₺|TRY\s*)2\.50/ }));
    expect(screen.getByRole('dialog', { name: 'Transaction Details' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Transaction Details' }))
      .toHaveTextContent(/-(?:₺|TRY\s*)2\.50/);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Transaction Details' })).not.toBeInTheDocument();
  });

  it('keeps request details connected to their canonical reversal source', () => {
    store.state.transferRequests = [{
      id: 'transfer-1',
      familyId: 'family-1',
      fromChildId: 'child-1',
      fromChildName: 'Alex',
      toChildId: 'child-2',
      toChildName: 'Sam',
      amountPence: 400,
      status: 'pending',
      createdAt: currentTimestamp(),
    }];

    render(<TransactionHistoryScreen />);

    fireEvent.click(screen.getByRole('button', { name: /sent from Alex to Sam.*-.*4\.00/ }));
    expect(screen.getByText('history-action:transfer_request:transfer-1')).toBeInTheDocument();
  });
});
