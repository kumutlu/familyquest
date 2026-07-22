import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

// Mutable store so each test can supply its own slice of state.
const mockStore: any = {
  currentUser: { id: 'parent-1', familyId: 'family-1', role: 'owner', walletBalance: 0 },
  familyMembers: [],
  childWallets: [],
  walletTransactions: [],
  loading: false,
};

vi.mock('../store/useStore', () => ({
  useStore: () => mockStore,
}));
vi.mock('../components/wallet/AddMoneyModal', () => ({
  AddMoneyModal: () => <div data-testid="add-money-modal-mock" />,
}));

import { Wallets } from './Wallets';

// Recent activity is limited to the 3 most recent ledger entries (slice(0, 3)).
const ts = (y: number, m: number, d: number, h = 12) => {
  const date = new Date(y, m, d, h, 0);
  return { toDate: () => date, toMillis: () => date.getTime() };
};
const recentLedger = (childId: string) => [
  { id: 't5', childId, description: 'Added £559.00', amountPence: 55900, createdAt: ts(2026, 6, 14) },
  { id: 't4', childId, description: 'Transfer received £80.00', amountPence: 8000, createdAt: ts(2026, 6, 13) },
  { id: 't3', childId, description: 'Behaviour penalty -£30.00', amountPence: -3000, createdAt: ts(2026, 6, 12) },
  { id: 't2', childId, description: 'Deducted -£5.00', amountPence: -500, createdAt: ts(2026, 6, 11) },
  { id: 't1', childId, description: 'Added £2.00', amountPence: 200, createdAt: ts(2026, 6, 10) },
];

beforeEach(() => {
  mockStore.currentUser = { id: 'parent-1', familyId: 'family-1', role: 'owner', walletBalance: 0 };
  mockStore.familyMembers = [];
  mockStore.childWallets = [];
  mockStore.walletTransactions = [];
  mockStore.familyData = { id: 'family-1', currency: '£' };
  mockStore.loading = false;
});

describe('Parent Wallets page balance single source of truth', () => {
  it('formats balances with canonical family currencyCode', () => {
    mockStore.familyData = { id: 'family-1', currencyCode: 'TRY', currency: '£' };
    mockStore.familyMembers = [
      { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Mnalium' },
    ];
    mockStore.childWallets = [{ id: 'child-1', balance: 1_234 }];

    render(<MemoryRouter><Wallets /></MemoryRouter>);

    expect(screen.getByText(/₺12\.34|TRY\s*12\.34/)).toBeInTheDocument();
    expect(screen.queryByText('£12.34')).not.toBeInTheDocument();
  });

  it('shows walletDoc.balance (£606.00), NOT the legacy walletBalance (£639.00)', () => {
    // Legacy profile field deliberately set to a different (wrong) value to prove it is ignored.
    mockStore.currentUser = { id: 'parent-1', familyId: 'family-1', role: 'owner', walletBalance: 63900 };
    mockStore.familyMembers = [
      { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Mnalium', walletBalance: 63900 },
    ];
    // Canonical source: families/{familyId}/wallets/{child-1}.balance = 60600 (£606.00)
    mockStore.childWallets = [{ id: 'child-1', balance: 60600 }];
    mockStore.walletTransactions = recentLedger('child-1');

    render(
      <MemoryRouter>
        <Wallets />
      </MemoryRouter>,
    );

    // The authoritative balance must be rendered.
    expect(screen.getByText('£606.00')).toBeInTheDocument();
    // The legacy profile value must NEVER be rendered.
    expect(screen.queryByText('£639.00')).not.toBeInTheDocument();
  });

  it('shows £0.00 when the wallet document is missing (no legacy fallback)', () => {
    mockStore.familyMembers = [
      { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Mnalium', walletBalance: 63900 },
    ];
    // No wallet document present for child-1 -> must not show the legacy 63900.
    mockStore.childWallets = [];

    render(
      <MemoryRouter>
        <Wallets />
      </MemoryRouter>,
    );

    expect(screen.getByText('£0.00')).toBeInTheDocument();
    expect(screen.queryByText('£639.00')).not.toBeInTheDocument();
  });
});

describe('Parent Wallets page recent activity from wallet_transactions ledger', () => {
  it('renders the 3 most recent ledger rows for the child, independent of balance', () => {
    mockStore.familyMembers = [
      { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Mnalium', walletBalance: 63900 },
    ];
    mockStore.childWallets = [{ id: 'child-1', balance: 60600 }];
    mockStore.walletTransactions = recentLedger('child-1');

    render(
      <MemoryRouter>
        <Wallets />
      </MemoryRouter>,
    );

    // Balance remains the canonical walletDoc value.
    expect(screen.getByText('£606.00')).toBeInTheDocument();

    // Recent activity comes from wallet_transactions (top 3 by recency).
    expect(screen.getByText('Added £559.00')).toBeInTheDocument();
    expect(screen.getByText('Transfer received £80.00')).toBeInTheDocument();
    expect(screen.getByText('Behaviour penalty -£30.00')).toBeInTheDocument();

    // Older ledger rows are not shown (limited to 3).
    expect(screen.queryByText('Deducted -£5.00')).not.toBeInTheDocument();
    expect(screen.queryByText('Added £2.00')).not.toBeInTheDocument();
  });

  it('matches child by user document id (wallets/{childId} and wallet_transactions.childId)', () => {
    mockStore.familyMembers = [
      { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Mnalium', walletBalance: 63900 },
      { id: 'child-2', familyId: 'family-1', role: 'child', displayName: 'Other', walletBalance: 0 },
    ];
    // Wallet doc id must equal the child's user document id for the join to succeed.
    mockStore.childWallets = [{ id: 'child-1', balance: 60600 }];
    mockStore.walletTransactions = [
      { id: 't1', childId: 'child-1', description: 'Added £559.00', amountPence: 55900, createdAt: ts(2026, 6, 14) },
    ];

    render(
      <MemoryRouter>
        <Wallets />
      </MemoryRouter>,
    );

    // Mnalium's card shows the canonical balance joined by id.
    expect(screen.getByText('£606.00')).toBeInTheDocument();
    expect(screen.queryByText('£639.00')).not.toBeInTheDocument();
  });
});

describe('Parent Wallets page — Manage Wallet action', () => {
  it('1. shows a "Manage Wallet" action (not "Add Money") for each child', () => {
    mockStore.familyMembers = [
      { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Mnalium', walletBalance: 0 },
    ];
    mockStore.childWallets = [{ id: 'child-1', balance: 0 }];

    render(
      <MemoryRouter>
        <Wallets />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Manage Wallet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add money' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Money' })).not.toBeInTheDocument();
  });

  it('2. opens the deposit/withdraw modal when Manage Wallet is clicked', () => {
    mockStore.familyMembers = [
      { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Mnalium', walletBalance: 0 },
    ];
    mockStore.childWallets = [{ id: 'child-1', balance: 0 }];

    render(
      <MemoryRouter>
        <Wallets />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('add-money-modal-mock')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Manage Wallet' }));
    expect(screen.getByTestId('add-money-modal-mock')).toBeInTheDocument();
  });
});
