import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../i18n/config';

const state = vi.hoisted(() => ({
  familyMembers: [] as any[],
  savingsGoals: [] as any[],
  tasks: [] as any[],
  rewards: [] as any[],
  joinRequests: [] as any[],
  currentUser: null as any,
}));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../../store/useStore', () => ({
  useStore: (selector: any) => (typeof selector === 'function' ? selector(state) : state),
}));
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

import { NextActionCard } from './NextActionCard';

beforeEach(async () => {
  vi.clearAllMocks();
  state.familyMembers = [];
  state.savingsGoals = [];
  state.tasks = [];
  state.rewards = [];
  state.joinRequests = [];
  state.currentUser = null;
  await i18n.loadNamespaces('dashboard');
  await i18n.changeLanguage('en');
});

describe('NextActionCard', () => {
  it('prompts to invite family when only the owner exists', () => {
    state.familyMembers = [{ id: 'owner', role: 'owner' }];
    render(
      <MemoryRouter>
        <NextActionCard />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Invite family members' })).toBeInTheDocument();
  });

  it('navigates to the setup hub from the invite-family action', async () => {
    state.familyMembers = [{ id: 'owner', role: 'owner' }];
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <NextActionCard />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Invite family members' }));
    expect(navigate).toHaveBeenCalledWith('/continue-setup');
  });

  it('prompts to create a goal once the family is populated', () => {
    state.familyMembers = [{ id: 'owner', role: 'owner' }, { id: 'c1', role: 'child' }];
    render(
      <MemoryRouter>
        <NextActionCard />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Create a goal' })).toBeInTheDocument();
  });

  it('prompts to create a task once a goal exists', () => {
    state.familyMembers = [{ id: 'owner', role: 'owner' }, { id: 'c1', role: 'child' }];
    state.savingsGoals = [{ id: 'g1' }];
    render(
      <MemoryRouter>
        <NextActionCard />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Create a task' })).toBeInTheDocument();
  });

  it('shows Continue Setup once everything is configured', () => {
    state.familyMembers = [{ id: 'owner', role: 'owner' }, { id: 'c1', role: 'child' }];
    state.savingsGoals = [{ id: 'g1' }];
    state.tasks = [{ id: 't1' }];
    render(
      <MemoryRouter>
        <NextActionCard />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Continue Setup' })).toBeInTheDocument();
  });

  it('navigates to the goals page from the create-goal action', async () => {
    state.familyMembers = [{ id: 'owner', role: 'owner' }, { id: 'c1', role: 'child' }];
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <NextActionCard />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Create a goal' }));
    expect(navigate).toHaveBeenCalledWith('/goals');
  });

  it('surfaces pending join requests as the top priority for an owner', () => {
    state.currentUser = { role: 'owner' };
    state.familyMembers = [{ id: 'owner', role: 'owner' }, { id: 'c1', role: 'child' }];
    state.joinRequests = [{ id: 'j1', status: 'pending' }];
    render(
      <MemoryRouter>
        <NextActionCard />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Review join requests' })).toBeInTheDocument();
  });

  it('navigates to the dashboard to review join requests', async () => {
    state.currentUser = { role: 'owner' };
    state.familyMembers = [{ id: 'owner', role: 'owner' }, { id: 'c1', role: 'child' }];
    state.joinRequests = [{ id: 'j1', status: 'pending' }];
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <NextActionCard />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Review join requests' }));
    expect(navigate).toHaveBeenCalledWith('/');
  });
});
