import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../store/useStore', () => ({
  useStore: () => ({
    currentUser: { id: 'child-1', familyId: 'family-1', role: 'child', walletBalance: 500 },
    myWallet: { balance: 500 },
    familyData: { id: 'family-1', currency: '£' },
    walletTransactions: [{
      id: 'tx-1', childId: 'child-1', type: 'deposit', amount: 100,
      description: 'Pocket money', note: 'Pocket money', timestamp: { toDate: () => new Date() },
    }],
    savingsGoals: [],
    transferRequests: [],
    moneyRequests: [],
    petboxRequests: [],
    familyMembers: [],
    loading: false,
  }),
}));
vi.mock('../components/wallet/TransactionDetailsModal', () => ({
  TransactionDetailsModal: ({ isOpen, transaction }: any) => isOpen ? <span>details:{transaction.id}</span> : null,
}));
vi.mock('../components/wallet/SendMoneyModal', () => ({ SendMoneyModal: () => null }));
vi.mock('../components/wallet/RequestMoneyModal', () => ({ RequestMoneyModal: () => null }));
vi.mock('../lib/api', () => ({
  acceptMoneyRequest: vi.fn(), declineMoneyRequest: vi.fn(), createSavingsGoal: vi.fn(), deleteSavingsGoal: vi.fn(),
}));

import { Wallet } from './Wallet';

describe('Wallet transaction details integration', () => {
  it('opens the shared transaction details modal from a history row', () => {
    render(<MemoryRouter><Wallet /></MemoryRouter>);
    fireEvent.click(screen.getByText('Pocket money'));
    expect(screen.getByText('details:tx-1')).toBeInTheDocument();
  });
});
