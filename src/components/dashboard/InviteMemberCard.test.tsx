import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../i18n/config';

const state = vi.hoisted(() => ({
  familyData: { id: 'f1', inviteCode: 'ABC123' } as any,
}));
const navigate = vi.hoisted(() => vi.fn());
const invitationApi = vi.hoisted(() => ({ createFamilyInvitation: vi.fn() }));

vi.mock('../../store/useStore', () => ({
  useStore: (selector: any) => (typeof selector === 'function' ? selector(state) : state),
}));
vi.mock('../../lib/familyInvitationApi', () => invitationApi);
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

import { InviteMemberCard } from './InviteMemberCard';

beforeEach(async () => {
  vi.clearAllMocks();
  state.familyData = { id: 'f1', inviteCode: 'ABC123' };
  invitationApi.createFamilyInvitation.mockResolvedValue({
    code: '7ZXWRZ',
    intendedRole: 'child',
    expiresAtMs: Date.now() + 1000,
  });
  // The Web Share API does not exist in jsdom by default.
  delete (navigator as any).share;
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

  it('presents exactly the three supported invite choices', () => {
    render(
      <MemoryRouter>
        <InviteMemberCard />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /Another parent/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /A child with their own device/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create a managed child account/ })).toBeInTheDocument();
  });

  it('cannot share before an invite type has been chosen', () => {
    render(
      <MemoryRouter>
        <InviteMemberCard />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled();
    expect(invitationApi.createFamilyInvitation).not.toHaveBeenCalled();
  });

  it('creates a parent-intended invitation and shares its code-specific URL', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
    invitationApi.createFamilyInvitation.mockResolvedValue({
      code: '7ZXWRZ', intendedRole: 'parent', expiresAtMs: 1,
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <InviteMemberCard />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /Another parent/ }));
    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(invitationApi.createFamilyInvitation).toHaveBeenCalledWith('parent');
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Queki',
        url: `${window.location.origin}/join?code=7ZXWRZ`,
      }),
    );
    // The role is never exposed in the URL.
    expect(share.mock.calls[0][0].url).not.toMatch(/type=|role=/);
  });

  it('creates a child-intended invitation when the child option is chosen', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <InviteMemberCard />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /A child with their own device/ }));
    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(invitationApi.createFamilyInvitation).toHaveBeenCalledWith('child');
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${window.location.origin}/join?code=7ZXWRZ` }),
    );
  });

  it('falls back to copying the full invitation message and URL', async () => {
    // userEvent.setup() installs its own clipboard stub, so ours must be
    // installed afterwards to observe what the component actually copies.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText }, configurable: true, writable: true,
    });
    render(
      <MemoryRouter>
        <InviteMemberCard />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /A child with their own device/ }));
    await user.click(screen.getByRole('button', { name: 'Share' }));

    expect(await screen.findByText('Copied')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(
      `You've been invited to join our family on Queki.\n${window.location.origin}/join?code=7ZXWRZ`,
    );
  });

  it('opens the managed-child flow without generating a link', async () => {
    const onAddChild = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <InviteMemberCard onAddChild={onAddChild} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /Create a managed child account/ }));

    expect(onAddChild).toHaveBeenCalledTimes(1);
    expect(invitationApi.createFamilyInvitation).not.toHaveBeenCalled();
    expect(screen.queryByText(/\/join\?code=/)).not.toBeInTheDocument();
  });

  it('still shows the visible invite code and Copy Code action alongside the link flow', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <InviteMemberCard />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /Another parent/ }));
    // The legacy reusable family code stays visible and copyable.
    expect(screen.getByText('ABC123')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy invite code' })).toBeEnabled();
  });

  it('reports a failure to create the invite link', async () => {
    invitationApi.createFamilyInvitation.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <InviteMemberCard />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: /Another parent/ }));
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not create the invite link');
  });

  it('offers an add-child-directly action that opens the managed-child flow', async () => {
    const onAddChild = vi.fn();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <InviteMemberCard onAddChild={onAddChild} />
      </MemoryRouter>,
    );
    const addChildButton = screen.getByRole('button', { name: 'Add child directly' });
    await user.click(addChildButton);
    expect(onAddChild).toHaveBeenCalledTimes(1);
  });
});
