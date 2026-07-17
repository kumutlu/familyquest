import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

// Mutable store so each test can supply its own slice of state.
const mockStore: any = {
  currentUser: { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Muhammed Osman' },
  myWallet: { balance: 0 },
  familyData: { id: 'family-1', currency: '£' },
  walletTransactions: [],
  transferRequests: [],
  familyMembers: [],
  loading: false,
  bootstrapError: null,
  featureErrors: {},
  bootstrapStatus: {},
  retryBootstrap: vi.fn(),
};

vi.mock('../store/useStore', () => ({
  useStore: () => mockStore,
}));
vi.mock('../components/wallet/TransactionDetailsModal', () => ({
  TransactionDetailsModal: ({ isOpen, transaction }: any) =>
    isOpen && transaction ? <span>{`details:${transaction.id}`}</span> : null,
}));
vi.mock('../components/wallet/SendMoneyModal', () => ({
  SendMoneyModal: () => <span>send-money-open</span>,
}));
vi.mock('../components/wallet/RequestMoneyModal', () => ({
  RequestMoneyModal: () => <span>request-money-open</span>,
}));

import { Wallet } from './Wallet';

const daysAgo = (n: number) => ({ toDate: () => new Date(Date.now() - n * 86_400_000) });
const thisMonth = () => ({ toDate: () => new Date() });

beforeEach(() => {
  mockStore.currentUser = { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Muhammed Osman' };
  mockStore.myWallet = { balance: 0 };
  mockStore.walletTransactions = [];
  mockStore.transferRequests = [];
  mockStore.familyMembers = [];
  mockStore.loading = false;
  mockStore.bootstrapError = null;
  mockStore.featureErrors = {};
  mockStore.bootstrapStatus = {};
});

describe('1. Child sees the banking-style wallet layout', () => {
  it('renders the account header, balance card, insights and recent transactions', () => {
    mockStore.myWallet = { balance: 2450 };
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    expect(screen.getByText('Muhammed Osman')).toBeInTheDocument();
    expect(screen.getByText('My Wallet')).toBeInTheDocument();
    expect(screen.getByText('Available balance')).toBeInTheDocument();
    expect(screen.getByText('Money In')).toBeInTheDocument();
    expect(screen.getByText('Money Out')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Recent Transactions')).toBeInTheDocument();
  });
});

describe('2 & 3. Parent / Owner do not see child wallet quick actions', () => {
  it('hides Send Money and Request Money from an owner', () => {
    mockStore.currentUser = { id: 'owner-1', familyId: 'family-1', role: 'owner', displayName: 'Owner' };
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /send money/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request money/i })).not.toBeInTheDocument();
  });

  it('hides Send Money and Request Money from a parent', () => {
    mockStore.currentUser = { id: 'parent-1', familyId: 'family-1', role: 'parent', displayName: 'Parent' };
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /send money/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request money/i })).not.toBeInTheDocument();
  });
});

describe('4 & 5. Balance uses canonical wallet data, not legacy walletBalance', () => {
  it('shows myWallet.balance and ignores the legacy users.walletBalance field', () => {
    mockStore.currentUser = { id: 'child-1', familyId: 'family-1', role: 'child', walletBalance: 12345 };
    mockStore.myWallet = { balance: 63900 }; // £639.00
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    expect(screen.getByText('£639.00')).toBeInTheDocument();
    expect(screen.queryByText('£123.45')).not.toBeInTheDocument();
  });
});

describe('6. £0.00 renders correctly', () => {
  it('renders £0.00 for an empty wallet', () => {
    mockStore.myWallet = { balance: 0 };
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('£0.00').length).toBeGreaterThanOrEqual(1);
  });
});

describe('7. Send Money opens the existing modal', () => {
  it('opens SendMoneyModal when the action is tapped', () => {
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /send money/i }));
    expect(screen.getByText('send-money-open')).toBeInTheDocument();
  });
});

describe('8. Request Money appears only when genuinely supported', () => {
  it('shows Request Money for a child (the flow is implemented)', () => {
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /request money/i })).toBeInTheDocument();
  });
});

describe('9. Pending transfers are separate from settled transactions', () => {
  it('shows a pending request in its own section, not inside Recent Transactions', () => {
    mockStore.myWallet = { balance: 500 };
    mockStore.transferRequests = [
      {
        id: 'tr-1',
        fromChildId: 'child-1',
        toChildId: 'child-2',
        toChildName: 'Child Two',
        amountPence: 500,
        status: 'pending',
        createdAt: { toDate: () => new Date() },
      },
    ];
    mockStore.walletTransactions = [
      { id: 'tx-1', childId: 'child-1', type: 'deposit', amount: 100, description: 'Pocket money', timestamp: thisMonth() },
    ];
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('transfer-requests-section')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for parent approval/)).toBeInTheDocument();
    const recent = screen.getByText('Recent Transactions').closest('section')!;
    expect(recent).not.toHaveTextContent('Child Two');
  });
});

describe('10 & 11. Pending transfer does not reduce balance and is excluded from Money Out', () => {
  it('keeps balance and Money Out unchanged when a pending request exists', () => {
    mockStore.myWallet = { balance: 500 };
    mockStore.transferRequests = [
      {
        id: 'tr-1',
        fromChildId: 'child-1',
        toChildId: 'child-2',
        toChildName: 'Child Two',
        amountPence: 500,
        status: 'pending',
        createdAt: { toDate: () => new Date() },
      },
    ];
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    // Balance is the canonical wallet value, unaffected by the pending request.
    expect(screen.getAllByText('£5.00').length).toBeGreaterThanOrEqual(1);
    // Money Out is £0.00 because the pending request is not a ledger row.
    expect(screen.getAllByText('£0.00').length).toBeGreaterThanOrEqual(1);
  });
});

describe('12. Approved outgoing transfer counts in Money Out', () => {
  it('sums transfer_out into Money Out for the current month', () => {
    mockStore.myWallet = { balance: 1000 };
    mockStore.walletTransactions = [
      { id: 't1', childId: 'child-1', type: 'transfer_out', amountPence: -500, description: 'Sent to Osman', timestamp: thisMonth() },
    ];
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    expect(screen.getByText('£5.00')).toBeInTheDocument(); // Money Out
  });
});

describe('13. Approved incoming transfer counts in Money In', () => {
  it('sums transfer_in into Money In for the current month', () => {
    mockStore.myWallet = { balance: 1000 };
    mockStore.walletTransactions = [
      { id: 't1', childId: 'child-1', type: 'transfer_in', amountPence: 200, description: 'Received from Alin', timestamp: thisMonth() },
    ];
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    expect(screen.getByText('£2.00')).toBeInTheDocument(); // Money In
  });
});

describe('14. Deposit counts in Money In', () => {
  it('sums deposits into Money In', () => {
    mockStore.myWallet = { balance: 1000 };
    mockStore.walletTransactions = [
      { id: 't1', childId: 'child-1', type: 'deposit', amount: 300, description: 'Pocket', timestamp: thisMonth() },
    ];
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    expect(screen.getByText('£3.00')).toBeInTheDocument(); // Money In
  });
});

describe('15. Withdrawal counts in Money Out', () => {
  it('sums withdrawals into Money Out', () => {
    mockStore.myWallet = { balance: 1000 };
    mockStore.walletTransactions = [
      { id: 't1', childId: 'child-1', type: 'withdrawal', amount: 150, description: 'Cash', timestamp: thisMonth() },
    ];
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    expect(screen.getByText('£1.50')).toBeInTheDocument(); // Money Out
  });
});

describe('16. Rejected transfer does not affect totals', () => {
  it('excludes a rejected request from pending and from all totals', () => {
    mockStore.myWallet = { balance: 800 };
    mockStore.transferRequests = [
      {
        id: 'tr-1',
        fromChildId: 'child-1',
        toChildId: 'child-2',
        toChildName: 'Child Two',
        amountPence: 500,
        status: 'rejected',
        createdAt: { toDate: () => new Date() },
      },
    ];
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    // Rejected request is not shown as pending.
    expect(screen.queryByText(/Waiting for parent approval/)).not.toBeInTheDocument();
    expect(screen.getByText('No pending transfers')).toBeInTheDocument();
    // Balance and Money Out are unaffected.
    expect(screen.getByText('£8.00')).toBeInTheDocument();
    expect(screen.getAllByText('£0.00').length).toBeGreaterThanOrEqual(1);
  });
});

describe('17. Transactions render newest first', () => {
  it('orders rows by descending date', () => {
    mockStore.walletTransactions = [
      { id: 'old', childId: 'child-1', type: 'deposit', amount: 100, description: 'Older tx', timestamp: daysAgo(5) },
      { id: 'new', childId: 'child-1', type: 'deposit', amount: 100, description: 'Newer tx', timestamp: daysAgo(1) },
    ];
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    const rows = screen.getAllByTestId('transaction-row');
    expect(rows[0].textContent).toContain('Newer tx');
    expect(rows[1].textContent).toContain('Older tx');
  });
});

describe('18 & 19. Incoming shows +, outgoing shows -', () => {
  it('prefixes incoming amounts with + and outgoing with -', () => {
    mockStore.walletTransactions = [
      { id: 'in', childId: 'child-1', type: 'transfer_in', amountPence: 200, description: 'Received from Alin', timestamp: thisMonth() },
      { id: 'out', childId: 'child-1', type: 'transfer_out', amountPence: -500, description: 'Sent to Osman', timestamp: thisMonth() },
    ];
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    const rows = screen.getAllByTestId('transaction-row');
    const inRow = rows.find(r => r.textContent?.includes('Received from Alin'))!;
    const outRow = rows.find(r => r.textContent?.includes('Sent to Osman'))!;
    expect(inRow.textContent).toContain('+£2.00');
    expect(outRow.textContent).toContain('-£5.00');
  });
});

describe('20. Transaction detail opens correctly', () => {
  it('opens the detail modal when a row is clicked', () => {
    mockStore.walletTransactions = [
      { id: 'tx-1', childId: 'child-1', type: 'deposit', amount: 100, description: 'Pocket money', timestamp: thisMonth() },
    ];
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('Pocket money'));
    expect(screen.getByText('details:tx-1')).toBeInTheDocument();
  });
});

describe('21. Missing optional transaction fields do not crash', () => {
  it('renders a minimal transaction without throwing', () => {
    mockStore.walletTransactions = [{ id: 'tx-min', type: 'deposit' }];
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    expect(screen.getByText('Money added')).toBeInTheDocument();
  });
});

describe('22. Long names do not overflow', () => {
  it('renders a very long title and counterparty without throwing', () => {
    mockStore.walletTransactions = [
      {
        id: 'tx-long',
        childId: 'child-1',
        type: 'transfer_out',
        amountPence: -12345,
        description: 'Sent to an extremely long sibling name that should truncate safely without breaking layout',
        counterpartyChildId: 'child-2',
        timestamp: thisMonth(),
      },
    ];
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('transaction-row')).toBeInTheDocument();
  });
});

describe('23. Empty wallet history shows the correct state', () => {
  it('shows the no-activity empty state', () => {
    mockStore.walletTransactions = [];
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    expect(screen.getByText('No wallet activity yet')).toBeInTheDocument();
    expect(screen.getByText(/Money added or sent will appear here/i)).toBeInTheDocument();
  });
});

describe('24. Empty pending state renders', () => {
  it('shows the no-pending-transfers empty state for a child', () => {
    mockStore.transferRequests = [];
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    expect(screen.getByText('No pending transfers')).toBeInTheDocument();
    expect(screen.getByText(/Everything is up to date/i)).toBeInTheDocument();
  });
});

describe('25 & 26. Wallet load failure shows a friendly error (never raw Firebase text)', () => {
  it('shows a friendly message and retry, hiding the raw error', () => {
    mockStore.bootstrapError = 'FirebaseError: permission-denied at wallets/child-1';
    render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    expect(screen.getByText(/We couldn’t load your wallet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/permission-denied/i)).not.toBeInTheDocument();
  });
});

describe('27. Mobile layout has no horizontal overflow', () => {
  it('uses a bounded, full-width centred container', () => {
    const { container } = render(
      <MemoryRouter>
        <Wallet />
      </MemoryRouter>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('max-w-2xl');
    expect(root.className).toContain('w-full');
    expect(root.className).toContain('px-4');
  });
});
