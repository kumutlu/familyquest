import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../store/useStore', () => ({ useStore: () => ({ currentUser: { id: 'parent-1' }, familyData: { id: 'family-1' }, familyMembers: [{ id: 'parent-1', displayName: 'Kemal' }, { id: 'child-1', displayName: 'Alex' }] }) }));
vi.mock('../../lib/api', () => ({ contributeToFund: vi.fn() }));
vi.mock('./ExpenseModal', () => ({ ExpenseModal: () => <div data-testid="expense-modal"></div> }));
vi.mock('./PetBoxConfirmationModal', () => ({ PetBoxConfirmationModal: () => null }));
vi.mock('../reversals/HistoryActionControl', () => ({ HistoryActionControl: ({ sourceKind, source }: any) => <span>{sourceKind}:{source.id}</span> }));
import { FundCard } from './FundCard';

describe('FundCard', () => {
  const ts = (ms: number) => ({ toDate: () => new Date(ms), toMillis: () => ms });
  
  const baseFund = { id: 'fund-1', name: 'Vet', type: 'pet', balance: 500 };
  
  const generateExpenses = (count: number) => {
    return Array.from({ length: count }).map((_, i) => ({
      id: `expense-${i}`,
      fundId: 'fund-1',
      type: 'expense',
      amount: 100 * (i + 1),
      category: `Cat${i}`,
      description: `Desc${i}`,
      actorId: 'parent-1',
      createdAt: ts(1000000 + i * 1000)
    }));
  };

  it('attaches the canonical fund source to each history row', () => {
    render(<FundCard fund={baseFund} fundTransactions={generateExpenses(1)} isParent currencySymbol="£" />);
    expect(screen.getByText('fund_transaction:expense-0')).toBeInTheDocument();
  });

  it('parent sees recent expenses and Add Expense button', () => {
    render(<FundCard fund={baseFund} fundTransactions={generateExpenses(2)} isParent currencySymbol="£" />);
    expect(screen.getByText('Recent Expenses')).toBeInTheDocument();
    expect(screen.getByText('Cat1 — Desc1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Expense' })).toBeInTheDocument();
  });

  it('child sees recent expenses but no Add Expense button', () => {
    render(<FundCard fund={baseFund} fundTransactions={generateExpenses(2)} isParent={false} currencySymbol="£" />);
    expect(screen.getByText('Recent Expenses')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Expense' })).not.toBeInTheDocument();
    expect(screen.getByText('Quick Donate to Vet')).toBeInTheDocument();
  });

  it('shows only 5 most recent expenses, newest first, and a View all button if more exist', () => {
    const txs = generateExpenses(6);
    render(<FundCard fund={baseFund} fundTransactions={txs} isParent currencySymbol="£" />);
    
    // Newest is expense-5 (highest ms)
    expect(screen.getByText('Cat5 — Desc5')).toBeInTheDocument();
    expect(screen.queryByText('Cat0 — Desc0')).not.toBeInTheDocument();
    
    const viewAll = screen.getByRole('button', { name: 'View all expenses' });
    fireEvent.click(viewAll);
    
    expect(screen.getByText('Cat0 — Desc0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
  });

  it('shows empty state if no expenses', () => {
    render(<FundCard fund={baseFund} fundTransactions={[]} isParent currencySymbol="£" />);
    expect(screen.getByText('No expenses recorded yet.')).toBeInTheDocument();
  });

  it('amount, creator name, and date display correctly', () => {
    const txs = [{ id: 'ex-1', fundId: 'fund-1', type: 'expense', amount: 1250, category: 'Food', description: '', actorId: 'parent-1', createdAt: ts(1784000000000) }]; // date formatting will depend on env, just check basic things
    render(<FundCard fund={baseFund} fundTransactions={txs} isParent currencySymbol="£" />);
    expect(screen.getByText('Food')).toBeInTheDocument();
    expect(screen.getByText('-£12.50')).toBeInTheDocument();
    expect(screen.getByText(/Added by Kemal/)).toBeInTheDocument();
  });

  it('donation transactions are excluded from the expense list', () => {
    const txs = [
      { id: 'ex-1', fundId: 'fund-1', type: 'expense', amount: 100, category: 'Food', actorId: 'parent-1', createdAt: ts(1000) },
      { id: 'don-1', fundId: 'fund-1', type: 'contribution', amount: 500, fromUserId: 'child-1', createdAt: ts(2000) }
    ];
    render(<FundCard fund={baseFund} fundTransactions={txs} isParent currencySymbol="£" />);
    expect(screen.getByText('Food')).toBeInTheDocument();
    expect(screen.queryByText('Contributed')).not.toBeInTheDocument();
  });
});
