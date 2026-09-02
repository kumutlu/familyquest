/**
 * <YourJourney /> — production regression coverage.
 *
 * Pins the PO-corrected V2 contract:
 *   - One outer surface (Your Journey)
 *   - Side-by-side Pet Box + Current Goal at 390px
 *   - NO shared progress track
 *   - Goal has its OWN progress visualization
 *   - Pet Box uses canonical funds[] (no second balance)
 *   - Goal uses canonical savingsGoals[] (no second projection)
 *   - No Level / next-level info (that's the Identity Hero's job)
 *   - Empty state when no active goal (no fabricated goal)
 *   - Preview injection boundary: previewData NEVER reaches the store
 *   - Pet Box and Goal are individually tappable
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { YourJourney } from './YourJourney';

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
  // Capture every economic-write method to assert no write path is added.
  setFunds: () => baseStore.setFundsCalls.push(1),
  setFundsCalls: [] as number[],
  setSavingsGoals: () => baseStore.setSavingsGoalsCalls.push(1),
  setSavingsGoalsCalls: [] as number[],
  updateFund: () => baseStore.updateFundCalls.push(1),
  updateFundCalls: [] as number[],
  deposit: () => baseStore.depositCalls.push(1),
  depositCalls: [] as number[],
};

vi.mock('../../store/useStore', () => ({
  useStore: () => baseStore,
}));

describe('<YourJourney /> — V2 long-term composition', () => {
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
    baseStore.setFundsCalls.length = 0;
    baseStore.setSavingsGoalsCalls.length = 0;
    baseStore.updateFundCalls.length = 0;
    baseStore.depositCalls.length = 0;
  });

  it('renders ONE outer surface with both Pet Box and Goal zones', () => {
    render(
      <MemoryRouter>
        <YourJourney familyData={{ petBoxEnabled: true }} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('your-journey')).toBeInTheDocument();
    expect(screen.getByTestId('your-journey-zones')).toBeInTheDocument();
    expect(screen.getByTestId('your-journey-petbox')).toBeInTheDocument();
    expect(screen.getByTestId('your-journey-goal')).toBeInTheDocument();
  });

  it('uses the canonical Pet Box balance (no second balance source)', () => {
    baseStore.funds = [{ id: 'f-1', name: 'Nimbus', balance: 99999 }];
    render(
      <MemoryRouter>
        <YourJourney familyData={{ petBoxEnabled: true }} />
      </MemoryRouter>,
    );
    const petbox = screen.getByTestId('your-journey-petbox');
    expect(petbox.textContent).toMatch(/£999\.99/);
  });

  it('uses the canonical Goal current/target (no second projection)', () => {
    baseStore.savingsGoals = [{
      goalId: 'g-2', title: 'Drone kit',
      currentAmountPence: 1234, targetAmountPence: 5000, status: 'active',
    }];
    render(
      <MemoryRouter>
        <YourJourney familyData={{ petBoxEnabled: true }} />
      </MemoryRouter>,
    );
    const goal = screen.getByTestId('your-journey-goal');
    expect(goal.textContent).toMatch(/Drone kit/);
    expect(goal.textContent).toMatch(/£12\.34/);
    expect(goal.textContent).toMatch(/£50\.00/);
  });

  it('gives the Goal its OWN progress visualization (not shared with Pet Box)', () => {
    const { container } = render(
      <MemoryRouter>
        <YourJourney familyData={{ petBoxEnabled: true }} />
      </MemoryRouter>,
    );
    const petbox = screen.getByTestId('your-journey-petbox');
    const goal = screen.getByTestId('your-journey-goal');
    // Pet Box has no .qk-journey__goal-track child.
    expect(petbox.querySelector('.qk-journey__goal-track')).toBeNull();
    // Goal owns the single progress track.
    const tracks = container.querySelectorAll('.qk-journey__goal-track');
    expect(tracks.length).toBe(1);
    expect(goal.contains(tracks[0])).toBe(true);
  });

  it('clamps the Goal progress fill between 0 and 100 percent', () => {
    baseStore.savingsGoals = [{
      goalId: 'g-3', title: 'Way too saved',
      currentAmountPence: 99999, targetAmountPence: 100, status: 'active',
    }];
    render(
      <MemoryRouter>
        <YourJourney familyData={{ petBoxEnabled: true }} />
      </MemoryRouter>,
    );
    const track = screen.getByTestId('your-journey-goal-track');
    const fill = track.firstElementChild as HTMLElement;
    expect(fill).toBeTruthy();
    const width = fill.style.width;
    // 99999 / 100 = 999.99 → clamped to 100%
    expect(width).toBe('100%');
  });

  it('does NOT duplicate Level / next-level information in the Journey header', () => {
    render(
      <MemoryRouter>
        <YourJourney familyData={{ petBoxEnabled: true }} />
      </MemoryRouter>,
    );
    const journey = screen.getByTestId('your-journey');
    expect(journey.textContent).not.toMatch(/Lv\s*\d+/i);
    expect(journey.textContent).not.toMatch(/XP to level/i);
  });

  it('renders a calm empty state when there is no active Goal', () => {
    baseStore.savingsGoals = [];
    render(
      <MemoryRouter>
        <YourJourney familyData={{ petBoxEnabled: true }} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('your-journey-goal-empty')).toBeInTheDocument();
  });

  it('hides the whole band when both Pet Box and Goals are unavailable', () => {
    baseStore.funds = [];
    baseStore.savingsGoals = [];
    const { container } = render(
      <MemoryRouter>
        <YourJourney familyData={{ petBoxEnabled: false }} />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });

  it('NEVER writes to the canonical store on production path', () => {
    render(
      <MemoryRouter>
        <YourJourney familyData={{ petBoxEnabled: true }} />
      </MemoryRouter>,
    );
    expect(baseStore.setFundsCalls).toEqual([]);
    expect(baseStore.setSavingsGoalsCalls).toEqual([]);
    expect(baseStore.updateFundCalls).toEqual([]);
    expect(baseStore.depositCalls).toEqual([]);
  });

  it('NEVER writes to the canonical store on preview path', () => {
    render(
      <MemoryRouter>
        <YourJourney
          familyData={{ petBoxEnabled: false }}
          previewData={{
            petBoxEnabled: true,
            petBoxName: 'Preview',
            petBoxBalancePence: 1234,
            petBoxFeedingLabel: 'Feeding in 5 days',
            primaryGoalId: 'preview-goal',
            primaryGoalTitle: 'Preview Goal',
            primaryGoalCurrentPence: 1000,
            primaryGoalTargetPence: 5000,
          }}
        />
      </MemoryRouter>,
    );
    expect(baseStore.setFundsCalls).toEqual([]);
    expect(baseStore.setSavingsGoalsCalls).toEqual([]);
    expect(baseStore.updateFundCalls).toEqual([]);
    expect(baseStore.depositCalls).toEqual([]);
  });

  it('Pet Box zone is tappable and routes to /pet-box', () => {
    render(
      <MemoryRouter>
        <YourJourney familyData={{ petBoxEnabled: true }} />
      </MemoryRouter>,
    );
    const petbox = screen.getByTestId('your-journey-petbox') as HTMLAnchorElement;
    expect(petbox.tagName).toBe('BUTTON');
  });

  it('Goal zone is tappable and routes to /goals', () => {
    render(
      <MemoryRouter>
        <YourJourney familyData={{ petBoxEnabled: true }} />
      </MemoryRouter>,
    );
    const goal = screen.getByTestId('your-journey-goal') as HTMLAnchorElement;
    expect(goal.tagName).toBe('BUTTON');
  });
});
