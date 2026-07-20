import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => h.navigate };
});

const baseStore = {
  funds: [] as any[],
};

vi.mock('../../store/useStore', () => ({
  useStore: () => baseStore,
}));

import { PetBoxSummaryCard } from './PetBoxSummaryCard';

describe('PetBoxSummaryCard', () => {
  beforeEach(() => {
    h.navigate.mockClear();
    baseStore.funds = [];
  });

  it('loads and shows active funds and combined balance', () => {
    baseStore.funds = [
      { id: 'f-1', name: 'Rex', species: 'dog', balance: 1500, emergencyGoal: 5000 },
      { id: 'f-2', name: 'Milo', species: 'cat', balance: 800, emergencyGoal: 2000 },
    ];
    render(<MemoryRouter><PetBoxSummaryCard /></MemoryRouter>);
    expect(screen.getByTestId('petbox-summary')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('£23.00')).toBeInTheDocument();
  });

  it('whole card links to /pet-box (no redundant ghost arrow)', () => {
    baseStore.funds = [{ id: 'f-1', name: 'Rex', species: 'dog', balance: 0, emergencyGoal: 0 }];
    render(<MemoryRouter><PetBoxSummaryCard /></MemoryRouter>);
    expect(screen.queryByTestId('petbox-summary-link')).not.toBeInTheDocument();
    const card = screen.getByTestId('petbox-summary');
    expect(card).toHaveAttribute('role', 'button');
    fireEvent.click(card);
    expect(h.navigate).toHaveBeenCalledWith('/pet-box');
  });

  it('card is keyboard accessible', () => {
    baseStore.funds = [{ id: 'f-1', name: 'Rex', species: 'dog', balance: 0, emergencyGoal: 0 }];
    render(<MemoryRouter><PetBoxSummaryCard /></MemoryRouter>);
    const card = screen.getByTestId('petbox-summary');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(h.navigate).toHaveBeenCalledWith('/pet-box');
  });

  it('shows empty state when no funds', () => {
    render(<MemoryRouter><PetBoxSummaryCard /></MemoryRouter>);
    expect(screen.getByText('No pets added yet.')).toBeInTheDocument();
  });
});
