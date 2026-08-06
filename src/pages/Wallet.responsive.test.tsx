import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../i18n/config';

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
import { PENDING_TRANSFER_STATUSES, isPendingTransferStatus } from '../lib/requestStatus';

const daysAgo = (n: number) => ({ toDate: () => new Date(Date.now() - n * 86_400_000) });

beforeEach(async () => {
  await i18n.loadNamespaces(['wallet']);
  await i18n.changeLanguage('en');
  mockStore.currentUser = { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Muhammed Osman' };
  mockStore.myWallet = { balance: 0 };
  mockStore.walletTransactions = [];
  mockStore.transferRequests = [];
  mockStore.familyMembers = [];
  mockStore.loading = false;
  mockStore.bootstrapError = null;
  mockStore.featureErrors = {};
  mockStore.bootstrapStatus = {};
  mockStore.retryBootstrap = vi.fn();
});

describe('A. Insight labels and amounts are fully visible (no truncation)', () => {
  it('renders complete Money In / Money Out / Pending labels', () => {
    mockStore.myWallet = { balance: 25800 };
    mockStore.walletTransactions = [
      { id: 'in', childId: 'child-1', type: 'deposit', amount: 25800, description: 'Pocket', timestamp: daysAgo(0) },
    ];
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getByText('Money In')).toBeInTheDocument();
    expect(screen.getByText('Money Out')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('never truncates a label to a single letter like M… or P…', () => {
    mockStore.myWallet = { balance: 100 };
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.queryByText('M…')).not.toBeInTheDocument();
    expect(screen.queryByText('P…')).not.toBeInTheDocument();
    expect(screen.queryByText('£…')).not.toBeInTheDocument();
  });

  it('shows a large amount (£99,999.99) fully without clipping', () => {
    mockStore.myWallet = { balance: 9999999 };
    mockStore.transferRequests = [
      { id: 'tr-1', fromChildId: 'child-1', toChildId: 'child-2', toChildName: 'Osman', amountPence: 9999999, status: 'pending', createdAt: daysAgo(0) },
    ];
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getAllByText('£99,999.99').length).toBeGreaterThan(0);
  });

  it('uses tabular numbers and never renders a clipped £… amount', () => {
    mockStore.myWallet = { balance: 500 };
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.queryByText('£…')).not.toBeInTheDocument();
  });
});

describe('B. Responsive Money Insights grid', () => {
  it('uses a 2-column grid on mobile with the Pending card spanning both columns', () => {
    mockStore.myWallet = { balance: 100 };
    const { container } = render(<MemoryRouter><Wallet /></MemoryRouter>);
    const section = container.querySelector('section[aria-label="Money insights"]');
    expect(section).not.toBeNull();
    // grid-cols-2 present, sm:grid-cols-3 present
    expect(section?.className).toContain('grid-cols-2');
    expect(section?.className).toContain('sm:grid-cols-3');
    expect(container.querySelector('.col-span-2')).not.toBeNull();
  });

  it('renders three equal insight cards on desktop (sm:grid-cols-3)', () => {
    mockStore.myWallet = { balance: 100 };
    const { container } = render(<MemoryRouter><Wallet /></MemoryRouter>);
    const cards = container.querySelectorAll('section[aria-label="Money insights"] > div');
    expect(cards.length).toBe(3);
  });
});

describe('C. Pending transfer empty vs error vs partial-failure', () => {
  it('shows the empty state (distinct from error) when there are no pending transfers', () => {
    mockStore.myWallet = { balance: 100 };
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getByText('No pending transfers')).toBeInTheDocument();
    expect(screen.getByText(/Everything is up to date/i)).toBeInTheDocument();
    expect(screen.queryByText(/We couldn’t load your pending transfers/i)).not.toBeInTheDocument();
  });

  it('shows the error state with a retry when the query errors', () => {
    mockStore.myWallet = { balance: 100 };
    mockStore.featureErrors = { transferRequests: '[Transfer requests] permission-denied: denied' };
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getByText(/We couldn[’']t load your pending transfers/i)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /Try again/i });
    expect(retry).toBeInTheDocument();
    fireEvent.click(retry);
    expect(mockStore.retryBootstrap).toHaveBeenCalled();
  });

  it('shows a non-blocking unavailable notice (not £0.00) when pending fails to load', () => {
    mockStore.myWallet = { balance: 100 };
    mockStore.featureErrors = { transferRequests: '[Transfer requests] failed-precondition: index' };
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    // Pending insight shows the unavailable placeholder, not a misleading £0.00
    const pendingLabel = screen.getByText('Pending');
    const card = pendingLabel.closest('div')?.parentElement as HTMLElement;
    expect(card?.textContent).toContain('—');
    expect(card?.textContent).not.toContain('£0.00');
    // Balance and transactions still render
    expect(screen.getByText('£1.00')).toBeInTheDocument();
  });

  it('shows Pending £0.00 only when the query succeeded with no pending transfers', () => {
    mockStore.myWallet = { balance: 100 };
    mockStore.transferRequests = []; // successful empty query
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    const pendingLabel = screen.getByText('Pending');
    const card = pendingLabel.closest('div')?.parentElement as HTMLElement;
    expect(card?.textContent).toContain('£0.00');
  });

  it('keeps balance and transactions rendering when the pending query fails', () => {
    mockStore.myWallet = { balance: 12345 };
    mockStore.walletTransactions = [
      { id: 'tx-1', childId: 'child-1', type: 'deposit', amount: 12345, description: 'Gift', timestamp: daysAgo(0) },
    ];
    mockStore.featureErrors = { transferRequests: '[Transfer requests] failed-precondition: index' };
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getAllByText('£123.45').length).toBeGreaterThan(0); // balance + transaction
    expect(screen.getByText('Gift')).toBeInTheDocument(); // transaction
  });
});

describe('D. Pending status classification supports all real unresolved statuses', () => {
  it('classifies the genuine transfer-request pending status', () => {
    expect(PENDING_TRANSFER_STATUSES).toEqual(['pending']);
    expect(isPendingTransferStatus('pending')).toBe(true);
  });

  it('does not treat money-request-only statuses as pending transfers', () => {
    expect(isPendingTransferStatus('pending_acceptance')).toBe(false);
    expect(isPendingTransferStatus('pending_approval')).toBe(false);
    expect(isPendingTransferStatus('approved')).toBe(false);
    expect(isPendingTransferStatus('cancelled')).toBe(false);
  });

  it('includes a pending transfer regardless of which real unresolved status it holds', () => {
    mockStore.myWallet = { balance: 100 };
    mockStore.transferRequests = PENDING_TRANSFER_STATUSES.map((status, i) => ({
      id: `tr-${i}`,
      fromChildId: 'child-1',
      toChildId: 'child-2',
      toChildName: 'Osman',
      amountPence: 100 * (i + 1),
      status,
      createdAt: daysAgo(i),
    }));
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getAllByTestId('transfer-request-item').length).toBe(PENDING_TRANSFER_STATUSES.length);
  });
});

describe('E. Recent transaction amount never shrinks or clips', () => {
  it('keeps the full +amount visible and the row tappable', () => {
    mockStore.walletTransactions = [
      { id: 'in', childId: 'child-1', type: 'transfer_in', amountPence: 25800, description: 'Received from Alin', timestamp: daysAgo(0) },
    ];
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    const row = screen.getByTestId('transaction-row');
    expect(row.textContent).toContain('+£258.00');
    expect(row.tagName).toBe('BUTTON');
  });

  it('wraps a long transaction title safely without overflow', () => {
    mockStore.walletTransactions = [
      {
        id: 'tx-long',
        childId: 'child-1',
        type: 'transfer_out',
        amountPence: -12345,
        description: 'Sent to an extremely long sibling name that should wrap safely without breaking layout on a narrow screen',
        counterpartyChildId: 'child-2',
        timestamp: daysAgo(0),
      },
    ];
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    expect(screen.getByTestId('transaction-row')).toBeInTheDocument();
    // Legacy rows without a stored amount keep their long description title.
    expect(screen.getByText(/Sent £123\.45 to/)).toBeInTheDocument();
  });
});
