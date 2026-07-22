import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n/config';
import { bootstrapResources } from '../../lib/bootstrapQueries';

const store = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));

vi.mock('../../store/useStore', () => ({
  useStore: () => store.state,
}));

vi.mock('../reversals/HistoryActionControl', () => ({
  HistoryActionControl: ({ sourceKind, source }: { sourceKind: string; source: { id: string } }) => (
    <span>{`history-action:${sourceKind}:${source.id}`}</span>
  ),
}));

import { TransactionHistoryScreen } from './TransactionHistoryScreen';

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

    expect(screen.getByText(/Movie Night/)).toBeInTheDocument();
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
    expect(screen.getByText(/-(?:₺|TRY\s*)2\.50/)).toBeInTheDocument();
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

    expect(await screen.findByText('Para çekildi')).toBeInTheDocument();
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
      .getByText('-75 puan')).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: /Money withdrawn.*-(?:₺|TRY\s*)2\.50/ }));
    expect(screen.getByRole('dialog', { name: 'Transaction Details' })).toBeInTheDocument();
    expect(screen.getAllByText(/-(?:₺|TRY\s*)2\.50/).length).toBeGreaterThanOrEqual(2);
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

    fireEvent.click(screen.getByRole('button', { name: /Transfer request.*-.*4\.00/ }));
    expect(screen.getByText('history-action:transfer_request:transfer-1')).toBeInTheDocument();
  });
});
