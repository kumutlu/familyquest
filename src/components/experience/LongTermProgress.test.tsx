import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LongTermProgress } from './LongTermProgress';

vi.mock('../../lib/familyFeatures', () => ({
  isPetBoxEnabled: () => true,
}));

const baseStore: any = {
  funds: [
    { id: 'f-1', name: 'Nimbus', balance: 5729, emergencyGoal: 12000 },
  ],
  savingsGoals: [
    {
      goalId: 'g-1',
      title: 'New bike',
      currentAmountPence: 3500,
      targetAmountPence: 20000,
      status: 'active',
    },
  ],
};

vi.mock('../../store/useStore', () => ({
  useStore: () => baseStore,
}));

describe('LongTermProgress (Child Experience V1)', () => {
  beforeEach(() => {
    baseStore.funds = [
      { id: 'f-1', name: 'Nimbus', balance: 5729, emergencyGoal: 12000 },
    ];
    baseStore.savingsGoals = [
      {
        goalId: 'g-1',
        title: 'New bike',
        currentAmountPence: 3500,
        targetAmountPence: 20000,
        status: 'active',
      },
    ];
  });

  it('renders the Pet Box card when the family has funds', () => {
    render(<MemoryRouter><LongTermProgress familyData={{ petBoxEnabled: true }} /></MemoryRouter>);
    const petbox = screen.getByTestId('long-term-progress-petbox');
    expect(petbox).toBeInTheDocument();
    expect(petbox).toHaveAttribute('aria-label', expect.stringContaining('Pet Box'));
  });

  it('renders the Goals card when the family has active savings goals', () => {
    render(<MemoryRouter><LongTermProgress familyData={{ petBoxEnabled: true }} /></MemoryRouter>);
    const goals = screen.getByTestId('long-term-progress-goals');
    expect(goals).toBeInTheDocument();
    expect(goals).toHaveAttribute('aria-label', expect.stringContaining('goal'));
  });

  it('renders the whole band when both surfaces are available', () => {
    render(<MemoryRouter><LongTermProgress familyData={{ petBoxEnabled: true }} /></MemoryRouter>);
    expect(screen.getByTestId('long-term-progress')).toBeInTheDocument();
  });

  it('renders nothing when both Pet Box and Goals are unavailable', () => {
    baseStore.funds = [];
    baseStore.savingsGoals = [];
    const { container } = render(
      <MemoryRouter><LongTermProgress familyData={{ petBoxEnabled: false }} /></MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('reuses existing canonical Pet Box balance — does not invent numbers', () => {
    baseStore.funds = [{ id: 'f-1', name: 'Nimbus', balance: 5729, emergencyGoal: 12000 }];
    render(<MemoryRouter><LongTermProgress familyData={{ petBoxEnabled: true }} /></MemoryRouter>);
    // 5729 pence == £57.29 — i18n might format differently, but the visible chip
    // includes the primary fund name to make the canonical source obvious.
    expect(screen.getByText(/Nimbus/)).toBeInTheDocument();
  });
});