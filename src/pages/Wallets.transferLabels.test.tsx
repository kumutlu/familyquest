import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const mockStore: any = {
  currentUser: { id: 'parent-1', familyId: 'family-1', role: 'owner' },
  familyMembers: [],
  childWallets: [],
  walletTransactions: [],
  familyData: { id: 'family-1', currency: '£' },
  loading: false,
};

vi.mock('../store/useStore', () => ({
  useStore: () => mockStore,
}));
vi.mock('../components/wallet/AddMoneyModal', () => ({
  AddMoneyModal: () => <div data-testid="add-money-modal-mock" />,
}));

import { Wallets } from './Wallets';

const ts = (y: number, m: number, d: number, h = 12) => {
  const date = new Date(y, m, d, h, 0);
  return { toDate: () => date, toMillis: () => date.getTime() };
};

beforeEach(() => {
  mockStore.currentUser = { id: 'parent-1', familyId: 'family-1', role: 'owner' };
  mockStore.familyMembers = [
    { id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Ali' },
    { id: 'child-2', familyId: 'family-1', role: 'child', displayName: 'Mnalium' },
  ];
  mockStore.childWallets = [{ id: 'child-1', balance: 1000 }];
  mockStore.walletTransactions = [];
  mockStore.familyData = { id: 'family-1', currency: '£' };
  mockStore.loading = false;
});

describe('Parent Wallets recent activity uses the shared transfer labels', () => {
  it('1/5. renders "Sent £10.00 to Mnalium" for transfer_out', () => {
    mockStore.walletTransactions = [{
      id: 't1',
      childId: 'child-1',
      type: 'transfer_out',
      amountPence: -1000,
      counterpartyChildId: 'child-2',
      status: 'completed',
      description: 'Sent to Mnalium',
      createdAt: ts(2026, 6, 14),
    }];

    render(<MemoryRouter><Wallets /></MemoryRouter>);

    expect(screen.getByText('Sent £10.00 to Mnalium')).toBeInTheDocument();
  });

  it('2/5. renders "Received £10.00 from Mnalium" for transfer_in', () => {
    mockStore.walletTransactions = [{
      id: 't2',
      childId: 'child-1',
      type: 'transfer_in',
      amountPence: 1000,
      counterpartyChildId: 'child-2',
      status: 'completed',
      description: 'Received from Mnalium',
      createdAt: ts(2026, 6, 14),
    }];

    render(<MemoryRouter><Wallets /></MemoryRouter>);

    expect(screen.getByText('Received £10.00 from Mnalium')).toBeInTheDocument();
  });

  it('3. never repeats the raw "Sent to Mnalium" description', () => {
    mockStore.walletTransactions = [{
      id: 't3',
      childId: 'child-1',
      type: 'transfer_out',
      amountPence: -1000,
      counterpartyChildId: 'child-2',
      status: 'completed',
      description: 'Sent to Mnalium',
      createdAt: ts(2026, 6, 14),
    }];

    render(<MemoryRouter><Wallets /></MemoryRouter>);

    expect(screen.queryByText('Sent to Mnalium')).not.toBeInTheDocument();
  });

  it('4. preserves a genuine note and the date', () => {
    mockStore.walletTransactions = [{
      id: 't4',
      childId: 'child-1',
      type: 'transfer_out',
      amountPence: -1000,
      counterpartyChildId: 'child-2',
      status: 'completed',
      note: 'Birthday money',
      createdAt: ts(2026, 6, 14),
    }];

    render(<MemoryRouter><Wallets /></MemoryRouter>);

    expect(screen.getByText('Sent £10.00 to Mnalium')).toBeInTheDocument();
    expect(screen.getByText('Birthday money')).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it('6. falls back safely when a legacy transfer has no amount', () => {
    mockStore.walletTransactions = [{
      id: 't5',
      childId: 'child-1',
      type: 'transfer_out',
      counterpartyChildId: 'child-2',
      status: 'completed',
      description: 'Sent to Mnalium',
      createdAt: ts(2026, 6, 14),
    }];

    render(<MemoryRouter><Wallets /></MemoryRouter>);

    expect(screen.getByText('Sent to Mnalium')).toBeInTheDocument();
  });

  it('7. leaves withdrawal rendering unchanged', () => {
    mockStore.walletTransactions = [{
      id: 't6',
      childId: 'child-1',
      type: 'withdrawal',
      amount: 250,
      parentRef: 'parent-1',
      description: 'Cash out',
      createdAt: ts(2026, 6, 14),
    }];

    render(<MemoryRouter><Wallets /></MemoryRouter>);

    expect(screen.getByText('Cash out')).toBeInTheDocument();
  });
});
