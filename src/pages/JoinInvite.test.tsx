import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '../i18n/config';

const state = vi.hoisted(() => ({
  authStatus: 'authenticated' as 'authenticated' | 'unauthenticated' | 'initializing',
  currentUser: { id: 'u1' } as any,
}));
const navigate = vi.hoisted(() => vi.fn());
const invitationApi = vi.hoisted(() => ({
  previewInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
}));

vi.mock('../store/useStore', () => ({
  useStore: (selector: any) => (typeof selector === 'function' ? selector(state) : state),
}));
vi.mock('../lib/familyInvitationApi', () => invitationApi);
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

import { JoinInvite } from './JoinInvite';
import {
  LEGACY_INVITE_COMPATIBILITY_CUTOFF_MS,
  PENDING_INVITE_KEY,
  mapInvitationErrorKey,
  readPendingInvite,
} from '../lib/inviteLink';

function renderJoin(entry = '/join?code=7ZXWRZ') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/join" element={<JoinInvite />} />
        <Route path="/join-family" element={<div>Manual family code page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  state.authStatus = 'authenticated';
  state.currentUser = { id: 'u1' };
  invitationApi.previewInvitation.mockResolvedValue({ familyName: 'Smith', intendedRole: 'child' });
  invitationApi.acceptInvitation.mockResolvedValue({
    familyId: 'family-1', status: 'pending', intendedRole: 'child',
  });
  await i18n.loadNamespaces(['family', 'common', 'auth']);
  await i18n.changeLanguage('en');
});

describe('JoinInvite', () => {
  it('validates the code from the URL before showing anything about the family', async () => {
    invitationApi.previewInvitation.mockReturnValue(new Promise(() => {}));
    renderJoin();

    expect(screen.getByRole('status')).toHaveTextContent('Checking your invitation…');
    expect(screen.queryByText(/Smith/)).not.toBeInTheDocument();
    expect(invitationApi.previewInvitation).toHaveBeenCalledWith('7ZXWRZ');
  });

  it('shows parent-specific confirmation copy', async () => {
    invitationApi.previewInvitation.mockResolvedValue({ familyName: 'Smith', intendedRole: 'parent' });
    renderJoin();

    expect(
      await screen.findByText("You've been invited to help manage the Smith family."),
    ).toBeInTheDocument();
  });

  it('shows child-specific confirmation copy', async () => {
    renderJoin();
    expect(
      await screen.findByText("You've been invited to join the Smith family."),
    ).toBeInTheDocument();
  });

  it('does not join the family without explicit confirmation', async () => {
    renderJoin();
    await screen.findByRole('button', { name: 'Accept invitation' });
    expect(invitationApi.acceptInvitation).not.toHaveBeenCalled();
  });

  it('sends the join request on confirmation, without a role', async () => {
    const user = userEvent.setup();
    renderJoin();

    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));

    expect(invitationApi.acceptInvitation).toHaveBeenCalledWith('7ZXWRZ');
    expect(await screen.findByText('Request sent')).toBeInTheDocument();
  });

  it('ignores a tampered role query parameter', async () => {
    const user = userEvent.setup();
    renderJoin('/join?code=7ZXWRZ&type=parent&role=owner');

    // The child copy comes from the validated record, not the URL.
    expect(
      await screen.findByText("You've been invited to join the Smith family."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(invitationApi.acceptInvitation).toHaveBeenCalledWith('7ZXWRZ');
    expect(invitationApi.acceptInvitation.mock.calls[0]).toHaveLength(1);
  });

  it('preserves the invite code for an unauthenticated visitor and offers auth', async () => {
    state.authStatus = 'unauthenticated';
    state.currentUser = null;
    renderJoin();

    expect(await screen.findByText('Sign in')).toBeInTheDocument();
    expect(screen.getByText('Create account')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).not.toBeInTheDocument();
    expect(readPendingInvite()).toBe('7ZXWRZ');
    expect(screen.getByText('Sign in').closest('a')).toHaveAttribute(
      'href',
      '/login?redirect=%2Fjoin%3Fcode%3D7ZXWRZ',
    );
  });

  it('resumes the flow from the preserved code when the URL has none', async () => {
    localStorage.setItem(PENDING_INVITE_KEY, '7ZXWRZ');
    renderJoin('/join');

    expect(await screen.findByText("You've been invited to join the Smith family.")).toBeInTheDocument();
    expect(invitationApi.previewInvitation).toHaveBeenCalledWith('7ZXWRZ');
  });

  it('survives a refresh by revalidating the same code', async () => {
    const first = renderJoin();
    await screen.findByText("You've been invited to join the Smith family.");
    first.unmount();

    // Simulate a reload: the URL is gone but the stored code is not.
    renderJoin('/join');
    expect(await screen.findByText("You've been invited to join the Smith family.")).toBeInTheDocument();
  });

  it('reports an invalid code', async () => {
    localStorage.setItem(PENDING_INVITE_KEY, '7ZXWRZ');
    invitationApi.previewInvitation.mockRejectedValue(new Error('INVALID_INVITATION'));
    renderJoin();
    expect(await screen.findByRole('alert')).toHaveTextContent('This invitation link is not valid.');
    expect(readPendingInvite()).toBe('');
  });

  it('reports an expired or regenerated code', async () => {
    localStorage.setItem(PENDING_INVITE_KEY, '7ZXWRZ');
    invitationApi.previewInvitation.mockRejectedValue(new Error('INVITATION_EXPIRED'));
    renderJoin();
    expect(await screen.findByRole('alert')).toHaveTextContent('This invitation has expired.');
    expect(readPendingInvite()).toBe('');
  });

  it('reports that the user already belongs to that family', async () => {
    invitationApi.previewInvitation.mockResolvedValue({ familyName: 'Smith', intendedRole: 'child' });
    invitationApi.acceptInvitation.mockRejectedValue(new Error('ALREADY_IN_THIS_FAMILY'));
    const user = userEvent.setup();
    renderJoin();

    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already a member of this family');
  });

  it('reports that the user already belongs to another family', async () => {
    invitationApi.acceptInvitation.mockRejectedValue(new Error('ALREADY_IN_FAMILY'));
    const user = userEvent.setup();
    renderJoin();

    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already belong to another family');
  });

  it('reports a link with no code and keeps the manual flow reachable', async () => {
    renderJoin('/join');
    expect(await screen.findByRole('alert')).toHaveTextContent('missing an invitation code');
    expect(screen.getByRole('link', { name: 'Have a family code instead?' })).toHaveAttribute(
      'href',
      '/join-family',
    );
    expect(invitationApi.previewInvitation).not.toHaveBeenCalled();
  });

  it('does not send an opaque v2 token to the legacy invitation callable', async () => {
    renderJoin('/join?code=CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws');
    expect(await screen.findByRole('alert')).toHaveTextContent('This invitation link is not valid.');
    expect(invitationApi.previewInvitation).not.toHaveBeenCalled();
  });

  it('keeps URL validation server-authoritative at the local compatibility cutoff', async () => {
    vi.setSystemTime(LEGACY_INVITE_COMPATIBILITY_CUTOFF_MS);
    renderJoin('/join?code=7ZXWRZ');
    expect(await screen.findByText("You've been invited to join the Smith family.")).toBeInTheDocument();
    expect(invitationApi.previewInvitation).toHaveBeenCalledWith('7ZXWRZ');
    vi.useRealTimers();
  });
});

describe('mapInvitationErrorKey', () => {
  it.each([
    ['INVITATION_EXPIRED', 'family:join.expired'],
    ['INVITATION_ALREADY_USED', 'family:join.used'],
    ['INVITATION_REVOKED', 'family:join.revoked'],
    ['ALREADY_IN_THIS_FAMILY', 'family:join.alreadyInThisFamily'],
    ['ALREADY_IN_FAMILY', 'family:join.alreadyInFamily'],
    ['INVALID_INVITATION', 'family:join.invalid'],
    ['something else', 'family:join.genericError'],
  ])('maps %s', (message, key) => {
    expect(mapInvitationErrorKey(new Error(message))).toBe(key);
  });
});
