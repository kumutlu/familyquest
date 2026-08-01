import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../i18n/config';

const state = vi.hoisted(() => ({
  familyMembers: [] as any[],
  rewards: [] as any[],
  tasks: [] as any[],
  familyData: { id: 'f1', inviteCode: 'ABC123' } as any,
}));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../store/useStore', () => ({
  useStore: (selector: any) => (typeof selector === 'function' ? selector(state) : state),
}));
vi.mock('react-router-dom', () => ({
  MemoryRouter: ({ children }: any) => children,
  useNavigate: () => navigate,
}));

import { ContinueSetup } from './ContinueSetup';

beforeEach(async () => {
  vi.clearAllMocks();
  state.familyMembers = [];
  state.rewards = [];
  state.tasks = [];
  state.familyData = { id: 'f1', inviteCode: 'ABC123' };
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async () => {} },
      configurable: true,
      writable: true,
    });
  }
  await i18n.loadNamespaces(['dashboard', 'family', 'common', 'settings']);
  await i18n.changeLanguage('en');
});

describe('ContinueSetup', () => {
  it('renders the checklist, invite card and every incomplete-step CTA when nothing is done', () => {
    state.familyMembers = [{ id: 'owner', role: 'owner' }];
    render(
      <MemoryRouter>
        <ContinueSetup />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Continue Setup' })).toBeInTheDocument();
    expect(
      screen.getByText('Complete these steps to finish setting up your family.'),
    ).toBeInTheDocument();
    // Invite card is shown because the family has no other members yet.
    expect(screen.getByText('ABC123')).toBeInTheDocument();
    // CTAs for the still-incomplete steps are offered.
    expect(screen.getByRole('button', { name: 'Create a reward' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a task' })).toBeInTheDocument();
  });

  it('hides the invite card and earlier CTAs once those steps are complete', () => {
    state.familyMembers = [{ id: 'owner', role: 'owner' }, { id: 'c1', role: 'child' }];
    state.rewards = [{ id: 'r1' }];
    render(
      <MemoryRouter>
        <ContinueSetup />
      </MemoryRouter>,
    );
    // Family invited + a reward exists, so only the task CTA remains.
    expect(screen.queryByText('ABC123')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create a reward' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a task' })).toBeInTheDocument();
  });

  it('navigates to the tasks page from the create-task CTA', async () => {
    state.familyMembers = [{ id: 'owner', role: 'owner' }, { id: 'c1', role: 'child' }];
    state.rewards = [{ id: 'r1' }];
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ContinueSetup />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Create a task' }));
    expect(navigate).toHaveBeenCalledWith('/tasks');
  });

  it('shows the all-done message and hides the invite card when fully configured', () => {
    state.familyMembers = [{ id: 'owner', role: 'owner' }, { id: 'c1', role: 'child' }];
    state.rewards = [{ id: 'r1' }];
    state.tasks = [{ id: 't1' }];
    render(
      <MemoryRouter>
        <ContinueSetup />
      </MemoryRouter>,
    );
    expect(
      screen.getByText("You're all set! Your family is ready to go."),
    ).toBeInTheDocument();
    expect(screen.queryByText('ABC123')).not.toBeInTheDocument();
  });
});
