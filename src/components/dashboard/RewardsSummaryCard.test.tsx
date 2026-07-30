import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ navigate: vi.fn() }));

const store = vi.hoisted(() => ({
  state: {
    currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner' },
    rewards: [] as any[],
  },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => h.navigate };
});

vi.mock('../../store/useStore', () => ({
  useStore: () => store.state,
}));

import { RewardsSummaryCard } from './RewardsSummaryCard';

describe('RewardsSummaryCard', () => {
  beforeEach(() => {
    h.navigate.mockClear();
    store.state = {
      currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner' },
      rewards: [],
    };
  });

  it('renders the rewards summary card', () => {
    render(
      <MemoryRouter>
        <RewardsSummaryCard />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('rewards-summary')).toBeInTheDocument();
    expect(screen.getByText('Rewards')).toBeInTheDocument();
  });

  it('shows the total rewards count', () => {
    store.state = {
      ...store.state,
      rewards: [
        { id: 'r-1', title: 'Gold Star' },
        { id: 'r-2', title: 'Badge' },
      ],
    };
    render(
      <MemoryRouter>
        <RewardsSummaryCard />
      </MemoryRouter>,
    );
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows zero when there are no rewards', () => {
    render(
      <MemoryRouter>
        <RewardsSummaryCard />
      </MemoryRouter>,
    );
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('navigates to /rewards when clicked', () => {
    render(
      <MemoryRouter>
        <RewardsSummaryCard />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('rewards-summary'));
    expect(h.navigate).toHaveBeenCalledWith('/rewards');
  });
});
