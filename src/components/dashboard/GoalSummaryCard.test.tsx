import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => h.navigate };
});

const baseStore = {
  savingsGoals: [] as any[],
  bootstrapStatus: { savingsGoals: 'ready' } as any,
};

vi.mock('../../store/useStore', () => ({
  useStore: () => baseStore,
}));

import { GoalSummaryCard } from './GoalSummaryCard';

describe('GoalSummaryCard', () => {
  beforeEach(() => {
    h.navigate.mockClear();
    baseStore.savingsGoals = [];
    baseStore.bootstrapStatus = { savingsGoals: 'ready' };
  });

  it('loads and shows active goals count and saved total', () => {
    baseStore.savingsGoals = [
      { goalId: 'g-1', title: 'Bike', status: 'active', currentAmountPence: 500, targetAmountPence: 1000 },
      { goalId: 'g-2', title: 'Tablet', status: 'active', currentAmountPence: 200, targetAmountPence: 800 },
      { goalId: 'g-3', title: 'Done', status: 'reached', currentAmountPence: 100, targetAmountPence: 100 },
    ];
    render(<MemoryRouter><GoalSummaryCard /></MemoryRouter>);
    expect(screen.getByTestId('goal-summary')).toBeInTheDocument();
    // Only active goals counted (g-1, g-2)
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('£7.00')).toBeInTheDocument();
  });

  it('whole card links to /goals (no redundant ghost arrow)', () => {
    baseStore.savingsGoals = [{ goalId: 'g-1', title: 'Bike', status: 'active', currentAmountPence: 0, targetAmountPence: 1000 }];
    render(<MemoryRouter><GoalSummaryCard /></MemoryRouter>);
    expect(screen.queryByTestId('goal-summary-link')).not.toBeInTheDocument();
    const card = screen.getByTestId('goal-summary');
    expect(card).toHaveAttribute('role', 'button');
    fireEvent.click(card);
    expect(h.navigate).toHaveBeenCalledWith('/goals');
  });

  it('card is keyboard accessible', () => {
    baseStore.savingsGoals = [{ goalId: 'g-1', title: 'Bike', status: 'active', currentAmountPence: 0, targetAmountPence: 1000 }];
    render(<MemoryRouter><GoalSummaryCard /></MemoryRouter>);
    const card = screen.getByTestId('goal-summary');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(h.navigate).toHaveBeenCalledWith('/goals');
  });

  it('clicking a goal navigates to its detail (nested row)', () => {
    baseStore.savingsGoals = [{ goalId: 'g-1', title: 'Bike', status: 'active', currentAmountPence: 0, targetAmountPence: 1000 }];
    render(<MemoryRouter><GoalSummaryCard /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('goal-summary-item'));
    expect(h.navigate).toHaveBeenCalledWith('/goals/g-1');
  });

  it('shows empty state when no active goals', () => {
    render(<MemoryRouter><GoalSummaryCard /></MemoryRouter>);
    expect(screen.getByText('No active goals yet.')).toBeInTheDocument();
  });

  it('keeps pending and failed goal data local to the card', () => {
    baseStore.bootstrapStatus = { savingsGoals: 'loading' };
    const loading = render(<MemoryRouter><GoalSummaryCard /></MemoryRouter>);
    expect(screen.getByTestId('goal-summary-loading')).toBeInTheDocument();
    expect(screen.queryByText('No active goals yet.')).not.toBeInTheDocument();
    loading.unmount();

    baseStore.bootstrapStatus = { savingsGoals: 'error' };
    render(<MemoryRouter><GoalSummaryCard /></MemoryRouter>);
    expect(screen.getByTestId('goal-summary-error')).toBeInTheDocument();
  });
});
