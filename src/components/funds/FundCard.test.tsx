import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../store/useStore', () => ({ useStore: () => ({ currentUser: { id: 'parent-1' }, familyData: { id: 'family-1' }, familyMembers: [] }) }));
vi.mock('../../lib/api', () => ({ contributeToFund: vi.fn() }));
vi.mock('./ExpenseModal', () => ({ ExpenseModal: () => null }));
vi.mock('./PetBoxConfirmationModal', () => ({ PetBoxConfirmationModal: () => null }));
vi.mock('../reversals/HistoryActionControl', () => ({ HistoryActionControl: ({ sourceKind, source }: any) => <span>{sourceKind}:{source.id}</span> }));
import { FundCard } from './FundCard';

describe('FundCard reversal integration', () => {
  it('attaches the canonical fund source to each history row', () => {
    render(<FundCard fund={{ id: 'fund-1', name: 'Vet', type: 'pet', balance: 500 }} fundTransactions={[{ id: 'expense-1', fundId: 'fund-1', type: 'expense', amount: 100, category: 'Food', description: 'Supplies', createdAt: { toDate: () => new Date() } }]} isParent currencySymbol="£" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show History' }));
    expect(screen.getByText('fund_transaction:expense-1')).toBeInTheDocument();
  });
});
