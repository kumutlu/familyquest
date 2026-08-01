import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../i18n/config';

const state = vi.hoisted(() => ({
  familyData: { id: 'f1', inviteCode: 'ABC123' } as any,
}));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('../../store/useStore', () => ({
  useStore: (selector: any) => (typeof selector === 'function' ? selector(state) : state),
}));
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

import { InviteMemberCard } from './InviteMemberCard';

beforeEach(async () => {
  vi.clearAllMocks();
  state.familyData = { id: 'f1', inviteCode: 'ABC123' };
  // Ensure a working clipboard so the success path renders the "Copied" status.
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async () => {} },
      configurable: true,
      writable: true,
    });
  }
  await i18n.loadNamespaces(['family', 'common', 'settings']);
  await i18n.changeLanguage('en');
});

describe('InviteMemberCard', () => {
  it('shows the invite code and a copy action', () => {
    render(
      <MemoryRouter>
        <InviteMemberCard />
      </MemoryRouter>,
    );
    expect(screen.getByText('ABC123')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy invite code' })).toBeInTheDocument();
  });

  it('copies the invite code to the clipboard', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <InviteMemberCard />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Copy invite code' }));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('navigates to settings from the edit action', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <InviteMemberCard />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Edit invite settings' }));
    expect(navigate).toHaveBeenCalledWith('/settings');
  });

  it('falls back to copying the join link when Web Share is unavailable', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <InviteMemberCard />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });
});
