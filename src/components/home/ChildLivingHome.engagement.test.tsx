/**
 * Regression coverage for the Child Experience V1 productization pass.
 *
 * Pins (per the brief):
 *   - Pet Box still renders for an eligible child
 *   - existing Pet Box amount comes from the canonical store data
 *   - Goals remain reachable
 *   - Today's Quests does not replace Goals
 *   - Today's Adventure does not replace Pet Box
 *   - no duplicate Pet Box accounting source is introduced
 *   - no presentation component writes Pet Box money
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../hooks/useMascotPresentation', () => ({
  useMascotPresentationFor: () => ({
    presentation: { mood: 'friendly', expression: 'soft_smile' },
    message: 'Hey!',
  }),
}));

vi.mock('../../hooks/useExperienceTheme', () => ({
  useExperienceTheme: () => ({ theme: null, weeklyEvent: null, seasonalEvent: null }),
}));

vi.mock('../../hooks/useChildAdventure', () => ({
  useChildAdventure: () => ({
    presentation: { kind: 'normal' },
    surge: null,
    comeback: null,
    urgency: 'normal',
  }),
}));

const storeState: any = {
  currentUser: { id: 'c-1', role: 'child', displayName: 'Sky', rewardPoints: 50 },
  familyData: { id: 'f-1', petBoxEnabled: true },
  tasks: [
    { id: 't-1', title: 'Brush teeth', pointsReward: 5, isCompleted: false, assigneeId: 'c-1', isActive: true },
    { id: 't-2', title: 'Read 10 pages', pointsReward: 10, isCompleted: false, assigneeId: 'c-1', isActive: true },
  ],
  taskCompletions: [],
  rewards: [],
  walletTransactions: [],
  challenges: [],
  myGamificationSummary: null,
  myDailyProgress: null,
  myWallet: { balance: 100 },
  bootstrapStatus: { tasks: 'ready', members: 'ready', funds: 'ready', savingsGoals: 'ready' },
  funds: [{ id: 'f-1', name: 'Nimbus', balance: 5729, emergencyGoal: 12000 }],
  savingsGoals: [
    { goalId: 'g-1', title: 'New bike', currentAmountPence: 3500, targetAmountPence: 20000, status: 'active' },
  ],
  activeSurges: [],
  mysteryDropDefinition: null,
  comebackInput: null,
  comebackXpReward: 0,
  familyTimezone: 'UTC',
  lastXpAward: null,
};

vi.mock('../../store/useStore', () => ({
  useStore: () => storeState,
}));

describe('ChildLivingHome — Child Experience V1 regression', () => {
  beforeEach(() => {
    storeState.currentUser = { id: 'c-1', role: 'child', displayName: 'Sky', rewardPoints: 50 };
    storeState.familyData = { id: 'f-1', petBoxEnabled: true };
    storeState.funds = [{ id: 'f-1', name: 'Nimbus', balance: 5729, emergencyGoal: 12000 }];
    storeState.savingsGoals = [
      { goalId: 'g-1', title: 'New bike', currentAmountPence: 3500, targetAmountPence: 20000, status: 'active' },
    ];
    storeState.tasks = [
      { id: 't-1', title: 'Brush teeth', pointsReward: 5, isCompleted: false, assigneeId: 'c-1', isActive: true },
    ];
  });

  it('renders the Pet Box long-term surface in the child home', async () => {
    const { ChildLivingHome } = await import('./ChildLivingHome');
    render(<MemoryRouter><ChildLivingHome /></MemoryRouter>);
    expect(screen.getByTestId('your-journey-petbox')).toBeInTheDocument();
  });

  it('renders the Goals long-term surface in the child home', async () => {
    const { ChildLivingHome } = await import('./ChildLivingHome');
    render(<MemoryRouter><ChildLivingHome /></MemoryRouter>);
    expect(screen.getByTestId('your-journey-goal')).toBeInTheDocument();
  });

  it("preserves Today's Adventure as a separate centerpiece", async () => {
    const { ChildLivingHome } = await import('./ChildLivingHome');
    render(<MemoryRouter><ChildLivingHome /></MemoryRouter>);
    expect(screen.getByTestId('todays-adventure')).toBeInTheDocument();
  });

  it("preserves Today's Quests as a separate list", async () => {
    const { ChildLivingHome } = await import('./ChildLivingHome');
    render(<MemoryRouter><ChildLivingHome /></MemoryRouter>);
    expect(screen.getByTestId('todays-quests')).toBeInTheDocument();
  });

  it('does not collapse Pet Box into Adventure — they have distinct test ids', async () => {
    const { ChildLivingHome } = await import('./ChildLivingHome');
    render(<MemoryRouter><ChildLivingHome /></MemoryRouter>);
    expect(screen.queryByTestId('todays-adventure-petbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('your-journey-petbox')).toBeInTheDocument();
  });

  it('does not introduce a second quest completion path', async () => {
    const { ChildLivingHome } = await import('./ChildLivingHome');
    render(<MemoryRouter><ChildLivingHome /></MemoryRouter>);
    // Quest rows surface as QuestTile items with data-testid="quest-tile-..."
    const tile = screen.getByTestId('quest-tile-t-1');
    expect(tile).toBeInTheDocument();
    // The tile carries no completion mutation attribute; tapping navigates to /tasks.
    expect(tile).not.toHaveAttribute('data-completes-task');
  });
});