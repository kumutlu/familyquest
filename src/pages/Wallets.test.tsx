import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import i18n from '../i18n/config';
import { MoneyPrivacyProvider } from '../components/privacy/MoneyPrivacyContext';
import { MoneyPrivacyToggle } from '../components/privacy/MoneyPrivacyToggle';

// Mutable store so each test can supply its own slice of state.
const mockStore: any = {
  currentUser: { id: 'parent-1', familyId: 'family-1', role: 'owner', walletBalance: 0 },
  familyMembers: [],
  childWallets: [],
  walletTransactions: [],
  loading: false,
};

vi.mock('../store/useStore', () => ({
  useStore: (selector?: (state: typeof mockStore) => unknown) =>
    typeof selector === 'function' ? selector(mockStore) : mockStore,
}));
vi.mock('../components/wallet/AddMoneyModal', () => ({
  AddMoneyModal: () => <div data-testid="add-money-modal-mock" />,
}));

import { Wallets } from './Wallets';

function render(ui: ReactElement) {
  return rtlRender(<MoneyPrivacyProvider>{ui}</MoneyPrivacyProvider>);
}

// Recent activity is limited to the 3 most recent ledger entries (slice(0, 3)).
const ts = (y: number, m: number, d: number, h = 12) => {
  const date = new Date(y, m, d, h, 0);
  return { toDate: () => date, toMillis: () => date.getTime() };
};
const recentLedger = (childId: string) => [
  { id: 't5', childId, type: 'deposit', amountPence: 55900, createdAt: ts(2026, 6, 14) },
  { id: 't4', childId, type: 'deposit', amountPence: 8000, createdAt: ts(2026, 6, 13) },
  { id: 't3', childId, type: 'financial_penalty', amountPence: -3000, createdAt: ts(2026, 6, 12) },
  { id: 't2', childId, type: 'withdrawal', amountPence: -500, createdAt: ts(2026, 6, 11) },
  { id: 't1', childId, type: 'deposit', amountPence: 200, createdAt: ts(2026, 6, 10) },
];

beforeEach(async () => {
  localStorage.clear();
  await i18n.loadNamespaces(['common', 'wallet', 'help']);
  await i18n.changeLanguage('en');
  mockStore.currentUser = { id: 'parent-1', familyId: 'family-1', role: 'owner', walletBalance: 0 };
  mockStore.familyMembers = [];
  mockStore.childWallets = [];
  mockStore.walletTransactions = [];
  mockStore.transferRequests = [];
  mockStore.moneyRequests = [];
  mockStore.familyData = { id: 'family-1', currency: '£' };
  mockStore.loading = false;
});

describe('Parent Wallets page money privacy', () => {
  it('toggles a child balance and amount-bearing activity label without accessible leakage', () => {
    mockStore.familyMembers = [
      { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Mnalium' },
    ];
    mockStore.childWallets = [{ id: 'child-1', balance: 73_124 }];
    mockStore.walletTransactions = [{
      id: 'private-activity',
      childId: 'child-1',
      type: 'deposit',
      amountPence: 91_837,
      description: 'Added £918.37',
      note: 'Split lunch £374.26',
      createdAt: ts(2026, 6, 14),
    }];

    render(
      <>
        <MoneyPrivacyToggle />
        <MemoryRouter><Wallets /></MemoryRouter>
      </>,
    );

    expect(document.body).toHaveTextContent('£731.24');
    expect(document.body).toHaveTextContent('£918.37 added to Mnalium’s wallet');
    expect(document.body).toHaveTextContent('Split lunch £374.26');

    fireEvent.click(screen.getByRole('button', { name: 'Hide money amounts' }));

    expect(document.body.innerHTML).not.toContain('731.24');
    expect(document.body.innerHTML).not.toContain('918.37');
    expect(document.body.innerHTML).not.toContain('374.26');
    expect(screen.getAllByText('£••••').length).toBeGreaterThanOrEqual(3);

    fireEvent.click(screen.getByRole('button', { name: 'Show money amounts' }));

    expect(document.body).toHaveTextContent('£731.24');
    expect(document.body).toHaveTextContent('£918.37 added to Mnalium’s wallet');
    expect(document.body).toHaveTextContent('Split lunch £374.26');
  });
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
  it('keeps standalone requests out of recent activity without losing a joined wallet transfer leg', () => {
    mockStore.familyMembers = [
      { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Mnalium' },
      { id: 'child-2', familyId: 'family-1', role: 'child', displayName: 'Mostium' },
      { id: 'parent-1', familyId: 'family-1', role: 'parent', displayName: 'Ada' },
    ];
    mockStore.childWallets = [{ id: 'child-1', balance: 10_000 }];
    mockStore.walletTransactions = [
      { id: 'wallet-transfer', type: 'transfer_out', amountPence: 300, childId: 'child-1', transferRequestId: 'joined-transfer', actorId: 'parent-1', status: 'completed', createdAt: ts(2026, 7, 25) },
      { id: 'wallet-deposit', type: 'deposit', amountPence: 200, childId: 'child-1', parentRef: 'parent-1', status: 'completed', createdAt: ts(2026, 7, 24) },
      { id: 'wallet-withdrawal', type: 'withdrawal', amountPence: 100, childId: 'child-1', parentRef: 'parent-1', status: 'completed', createdAt: ts(2026, 7, 23) },
    ];
    mockStore.transferRequests = [
      { id: 'joined-transfer', fromChildId: 'child-1', toChildId: 'child-2', amountPence: 300, status: 'approved', reviewedBy: 'parent-1', reviewedByName: 'Ada', createdAt: ts(2026, 7, 25) },
      { id: 'pending-transfer', fromChildId: 'child-1', toChildId: 'child-2', amountPence: 400, status: 'pending', createdAt: ts(2026, 7, 27) },
    ];
    mockStore.moneyRequests = [
      { id: 'rejected-money', requesterId: 'child-1', requestedFromId: 'parent-1', amountPence: 500, status: 'rejected', reviewedBy: 'parent-1', reviewedByName: 'Ada', createdAt: ts(2026, 7, 26) },
    ];

    render(<MemoryRouter><Wallets /></MemoryRouter>);

    const joinedWalletTransfer = screen.getByText('£3.00 sent from Mnalium to Mostium').closest('article');
    expect(joinedWalletTransfer).toBeInTheDocument();
    expect(joinedWalletTransfer).toHaveTextContent('Performed by: Mnalium');
    expect(joinedWalletTransfer).toHaveTextContent('Approved by: Ada');
    expect(screen.getByText('£2.00 added to Mnalium’s wallet')).toBeInTheDocument();
    expect(screen.getByText('£1.00 withdrawn from Mnalium’s wallet')).toBeInTheDocument();
    expect(screen.queryByText('£4.00 sent from Mnalium to Mostium')).not.toBeInTheDocument();
    expect(screen.queryByText('£5.00 requested by Mnalium')).not.toBeInTheDocument();
  });

  it('passes linked request collections to render a Turkish parent-funded request payment truthfully', async () => {
    await i18n.changeLanguage('tr');
    mockStore.familyMembers = [
      { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Mnalium' },
      { id: 'parent-1', familyId: 'family-1', role: 'parent', displayName: 'Ada' },
    ];
    mockStore.childWallets = [{ id: 'child-1', balance: 425 }];
    mockStore.walletTransactions = [{
      id: 'request-payment', type: 'request_payment', amountPence: 425, childId: 'child-1', actorId: 'parent-1',
      moneyRequestId: 'money-1', status: 'completed', createdAt: ts(2026, 7, 25),
    }];
    mockStore.moneyRequests = [{
      id: 'money-1', requesterId: 'child-1', requestedFromId: 'parent-1', amountPence: 425,
      status: 'approved', reviewedBy: 'parent-1', reviewedByName: 'Ada', createdAt: ts(2026, 7, 24),
    }];

    render(<MemoryRouter><Wallets /></MemoryRouter>);

    expect(screen.getByText(/Ada tarafından Mnalium kişisine gönderildi/)).toBeInTheDocument();
    expect(screen.getByText('Mnalium tarafından yapıldı')).toBeInTheDocument();
    expect(screen.getByText('Ada tarafından onaylandı')).toBeInTheDocument();
    expect(screen.queryByText('Ada tarafından yapıldı')).not.toBeInTheDocument();
  });

  it('omits the date for a legacy row without a persisted timestamp', () => {
    mockStore.familyMembers = [
      { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Mnalium' },
    ];
    mockStore.childWallets = [{ id: 'child-1', balance: 60600 }];
    mockStore.walletTransactions = [{
      id: 'legacy-no-date',
      childId: 'child-1',
      type: 'transfer_out',
      counterpartyChildId: 'child-2',
      description: 'Sent to Mnalium',
      status: 'completed',
    }];

    render(<MemoryRouter><Wallets /></MemoryRouter>);

    expect(screen.getByText('Sent to Mnalium')).toBeInTheDocument();
    expect(screen.queryByText(/1970/)).not.toBeInTheDocument();
  });

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
    expect(screen.getByText('£559.00 added to Mnalium’s wallet')).toBeInTheDocument();
    expect(screen.getByText('£80.00 added to Mnalium’s wallet')).toBeInTheDocument();
    expect(screen.getByText('£30.00 deducted from Mnalium’s wallet')).toBeInTheDocument();

    // Older ledger rows are not shown (limited to 3).
    expect(screen.queryByText('£5.00 withdrawn from Mnalium’s wallet')).not.toBeInTheDocument();
    expect(screen.queryByText('£2.00 added to Mnalium’s wallet')).not.toBeInTheDocument();
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
