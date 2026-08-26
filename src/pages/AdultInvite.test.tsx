import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/config';

const TOKEN = 'CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws';
const ISO = '2026-09-02T12:00:00.000Z';

const navigate = vi.hoisted(() => vi.fn());
const order = vi.hoisted(() => [] as string[]);
const invitationApi = vi.hoisted(() => ({
  previewAdultInvitation: vi.fn(),
  acceptAdultInvitation: vi.fn(),
}));
const authApi = vi.hoisted(() => ({ signInWithGoogle: vi.fn() }));
const profileApi = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, collection: string, uid: string) => ({ path: `${collection}/${uid}` })),
  setDoc: vi.fn(),
}));
const state = vi.hoisted(() => ({
  authStatus: 'authenticated' as 'initializing' | 'authenticated' | 'unauthenticated',
  authUser: {
    uid: 'uid-1',
    getIdToken: vi.fn(async () => { order.push('token'); return 'fresh-token'; }),
  } as any,
  currentUser: { id: 'uid-1', displayName: 'Alex' } as any,
  refreshCurrentUser: vi.fn(() => { order.push('profile'); }),
}));

vi.mock('../lib/adultInvitationApi', () => invitationApi);
vi.mock('../lib/api', () => authApi);
vi.mock('../lib/firebase', () => ({ db: { kind: 'firestore' } }));
vi.mock('firebase/firestore', () => ({
  doc: (database: unknown, collection: string, uid: string) =>
    profileApi.doc(database, collection, uid),
  setDoc: (reference: unknown, data: unknown, options: unknown) =>
    profileApi.setDoc(reference, data, options),
}));
vi.mock('../store/useStore', () => ({
  useStore: (selector: any) => selector(state),
}));
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => (path: string, options?: unknown) => {
      order.push('navigate');
      return navigate(path, options);
    },
  };
});

import { readPendingInvite } from '../auth/pendingInviteIntent';
import { AdultInvite } from './AdultInvite';

function renderInvite(path = `/invite/${TOKEN}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/invite/:token" element={<AdultInvite />} />
        <Route path="/login" element={<div>Email login</div>} />
        <Route path="/signup" element={<div>Email signup</div>} />
        <Route path="/join-family" element={<div>Manual family code</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  order.length = 0;
  sessionStorage.clear();
  localStorage.clear();
  state.authStatus = 'authenticated';
  state.authUser = {
    uid: 'uid-1',
    getIdToken: vi.fn(async () => { order.push('token'); return 'fresh-token'; }),
  };
  state.currentUser = { id: 'uid-1', displayName: 'Alex' };
  state.refreshCurrentUser.mockImplementation(() => { order.push('profile'); });
  invitationApi.previewAdultInvitation.mockResolvedValue({
    familyDisplayName: 'The Smiths',
    intendedRole: 'parent',
    expiresAt: ISO,
    status: 'active',
  });
  invitationApi.acceptAdultInvitation.mockResolvedValue({
    result: 'joined',
    familyId: 'family-1',
    role: 'parent',
    destination: '/',
  });
  authApi.signInWithGoogle.mockResolvedValue({ uid: 'uid-1' });
  profileApi.setDoc.mockResolvedValue(undefined);
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('AdultInvite', () => {
  it('captures and previews the URL token before rendering family data', () => {
    invitationApi.previewAdultInvitation.mockReturnValue(new Promise(() => {}));
    renderInvite();

    expect(screen.getByRole('status')).toHaveTextContent('Checking your invitation…');
    expect(screen.queryByText(/The Smiths/)).not.toBeInTheDocument();
    expect(readPendingInvite()?.token).toBe(TOKEN);
    expect(invitationApi.previewAdultInvitation).toHaveBeenCalledWith({ token: TOKEN });
  });

  it('offers Google and both existing email auth paths without accepting', async () => {
    state.authStatus = 'unauthenticated';
    state.authUser = null;
    state.currentUser = null;
    renderInvite();

    expect(await screen.findByText("You've been invited to join The Smiths")).toBeInTheDocument();
    expect(screen.getByText('Role: Parent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue with email' })).toHaveAttribute(
      'href',
      `/signup?next=%2Finvite%2F${TOKEN}`,
    );
    expect(screen.getByRole('link', { name: 'Sign in with email' })).toHaveAttribute(
      'href',
      `/login?next=%2Finvite%2F${TOKEN}`,
    );
    expect(invitationApi.acceptAdultInvitation).not.toHaveBeenCalled();
  });

  it('keeps intent and never accepts when Google authentication is only started', async () => {
    state.authStatus = 'unauthenticated';
    state.authUser = null;
    state.currentUser = null;
    const user = userEvent.setup();
    renderInvite();

    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }));

    expect(authApi.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(readPendingInvite()?.token).toBe(TOKEN);
    expect(invitationApi.acceptAdultInvitation).not.toHaveBeenCalled();
  });

  it('requires explicit Join family and refreshes token/profile before navigation', async () => {
    const user = userEvent.setup();
    renderInvite(`/invite/${TOKEN}?familyId=attacker-family&role=owner`);

    expect(await screen.findByText('Join The Smiths as a parent?')).toBeInTheDocument();
    expect(readPendingInvite()?.authUid).toBe('uid-1');
    expect(invitationApi.acceptAdultInvitation).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Join family' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
    const payload = invitationApi.acceptAdultInvitation.mock.calls[0][0];
    expect(payload).toEqual({ token: TOKEN, clientReqId: expect.any(String) });
    expect(payload).not.toHaveProperty('familyId');
    expect(payload).not.toHaveProperty('role');
    expect(state.authUser.getIdToken).toHaveBeenCalledWith(true);
    expect(state.refreshCurrentUser).toHaveBeenCalledWith('uid-1', {
      familyId: 'family-1',
      role: 'parent',
    });
    expect(order).toEqual(['token', 'profile', 'navigate']);
    expect(readPendingInvite()).toBeNull();
  });

  it('renders the server-derived adult role with correct confirmation copy', async () => {
    invitationApi.previewAdultInvitation.mockResolvedValue({
      familyDisplayName: 'The Smiths',
      intendedRole: 'adult',
      expiresAt: ISO,
      status: 'active',
    });
    renderInvite();

    expect(await screen.findByText('Join The Smiths as an adult?')).toBeInTheDocument();
    expect(screen.getByText('Role: Adult')).toBeInTheDocument();
  });

  it('completes a minimal profile inside the invite journey before retrying acceptance', async () => {
    state.currentUser = { id: 'uid-1' };
    invitationApi.acceptAdultInvitation
      .mockRejectedValueOnce(new Error('PROFILE_REQUIRED'))
      .mockResolvedValueOnce({
        result: 'joined',
        familyId: 'family-1',
        role: 'parent',
        destination: '/',
      });
    const user = userEvent.setup();
    renderInvite();

    await user.click(await screen.findByRole('button', { name: 'Join family' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Finish setting up your account, then try joining again.',
    );

    await user.type(screen.getByRole('textbox', { name: 'Your name' }), 'Alex Smith');
    await user.click(screen.getByRole('button', { name: 'Save name and join' }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
    expect(profileApi.setDoc).toHaveBeenCalledWith(
      { path: 'users/uid-1' },
      { displayName: 'Alex Smith' },
      { merge: true },
    );
    expect(invitationApi.acceptAdultInvitation).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['INVITATION_EXPIRED', 'This invitation has expired. Ask for a new invitation.'],
    ['INVITATION_REVOKED', 'This invitation is no longer active. Ask for a new invitation.'],
    ['INVITATION_ALREADY_USED', 'This invitation has already been used. Ask for a new invitation.'],
    ['FAMILY_UNAVAILABLE', 'This family invitation is no longer available.'],
  ])('renders acknowledged terminal UX for %s without clearing early', async (code, copy) => {
    invitationApi.previewAdultInvitation.mockRejectedValue(new Error(code));
    const user = userEvent.setup();
    renderInvite();

    expect(await screen.findByRole('alert')).toHaveTextContent(copy);
    expect(screen.queryByText(/The Smiths/)).not.toBeInTheDocument();
    expect(readPendingInvite()?.token).toBe(TOKEN);

    await user.click(screen.getByRole('button', { name: 'Leave invitation' }));
    expect(readPendingInvite()).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('treats same-family already_member as success', async () => {
    invitationApi.acceptAdultInvitation.mockResolvedValue({
      result: 'already_member',
      familyId: 'family-1',
      role: 'parent',
      destination: '/',
    });
    const user = userEvent.setup();
    renderInvite();

    await user.click(await screen.findByRole('button', { name: 'Join family' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      "You're already part of this family. Opening your dashboard…",
    );
    expect(readPendingInvite()).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('renders a different-family conflict without changing or clearing intent', async () => {
    invitationApi.acceptAdultInvitation.mockRejectedValue(
      new Error('ALREADY_IN_ANOTHER_FAMILY'),
    );
    const user = userEvent.setup();
    renderInvite();

    await user.click(await screen.findByRole('button', { name: 'Join family' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You already belong to another family. Your current family has not been changed.',
    );
    expect(readPendingInvite()?.token).toBe(TOKEN);
    expect(state.authUser.getIdToken).not.toHaveBeenCalled();
    expect(state.refreshCurrentUser).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renders stable Turkish invitation copy', async () => {
    state.authStatus = 'unauthenticated';
    state.authUser = null;
    state.currentUser = null;
    await act(async () => { await i18n.changeLanguage('tr'); });
    renderInvite();

    expect(await screen.findByText("The Smiths ailesine katılmaya davet edildin")).toBeInTheDocument();
    expect(screen.getByText('Rol: Ebeveyn')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Google ile devam et' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'E-posta ile devam et' })).toBeInTheDocument();
  });
});
