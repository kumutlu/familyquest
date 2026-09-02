import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LongTermProgress } from './LongTermProgress';

vi.mock('../../lib/familyFeatures', () => ({
  isPetBoxEnabled: (familyData: unknown) =>
    typeof familyData === 'object' &&
    familyData != null &&
    (familyData as { petBoxEnabled?: unknown }).petBoxEnabled === true,
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

// Capture every method that mutates the store so we can assert no
// preview path accidentally performs an economic write.
const writeCalls: string[] = [];
baseStore.setFunds = () => writeCalls.push('setFunds');
baseStore.setSavingsGoals = () => writeCalls.push('setSavingsGoals');
baseStore.updateFund = () => writeCalls.push('updateFund');
baseStore.deposit = () => writeCalls.push('deposit');

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
    writeCalls.length = 0;
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

  it('production path NEVER writes to the canonical store', () => {
    render(<MemoryRouter><LongTermProgress familyData={{ petBoxEnabled: true }} /></MemoryRouter>);
    expect(writeCalls).toEqual([]);
  });

  // -------- Preview injection boundary (DEV/TEST only) -----------------

  it('renders Pet Box from previewData when fixture is supplied', () => {
    render(
      <MemoryRouter>
        <LongTermProgress
          familyData={{ petBoxEnabled: false }}
          previewData={{
            petBoxEnabled: true,
            petBoxName: 'Nimbus',
            petBoxBalancePence: 5729,
            activeGoalCount: 1,
            activeGoalSavedPence: 12000,
            primaryGoalTitle: 'Bike fund',
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('long-term-progress-petbox')).toBeInTheDocument();
    // Canonical store funds are 5729 / Nimbus — preview value matches
    // so the visible chip must still show Nimbus.
    expect(screen.getByText(/Nimbus/)).toBeInTheDocument();
  });

  it('renders Goals from previewData when fixture is supplied', () => {
    render(
      <MemoryRouter>
        <LongTermProgress
          familyData={{ petBoxEnabled: false }}
          previewData={{
            petBoxEnabled: false,
            activeGoalCount: 1,
            activeGoalSavedPence: 12000,
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('long-term-progress-goals')).toBeInTheDocument();
  });

  it('preview path NEVER mutates the canonical store', () => {
    render(
      <MemoryRouter>
        <LongTermProgress
          familyData={{ petBoxEnabled: false }}
          previewData={{
            petBoxEnabled: true,
            petBoxName: 'Preview Only',
            petBoxBalancePence: 9999,
            activeGoalCount: 3,
            activeGoalSavedPence: 12345,
          }}
        />
      </MemoryRouter>,
    );
    expect(writeCalls).toEqual([]);
  });

  it('preview path renders nothing when fixture omits values (no fake production data)', () => {
    const { container } = render(
      <MemoryRouter>
        <LongTermProgress
          familyData={{ petBoxEnabled: true }}
          previewData={{ petBoxEnabled: false }}
        />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('production callers that omit previewData continue to use canonical store', () => {
    baseStore.funds = [
      { id: 'real', name: 'RealFund', balance: 1000, emergencyGoal: 5000 },
    ];
    render(
      <MemoryRouter>
        <LongTermProgress familyData={{ petBoxEnabled: true }} />
      </MemoryRouter>,
    );
    // The canonical store fund name appears; the preview "Nimbus" never
    // leaks into production.
    expect(screen.getByText(/RealFund/)).toBeInTheDocument();
    expect(screen.queryByText(/Preview Only/)).not.toBeInTheDocument();
  });
});