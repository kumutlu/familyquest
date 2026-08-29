import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({
  currentUser: { id: 'owner-1', role: 'owner' } as any,
}));
const invitationApi = vi.hoisted(() => ({
  createAdultInvitation: vi.fn(),
  revokeAdultInvitation: vi.fn(),
}));

vi.mock('../../store/useStore', () => ({
  useStore: (selector: any) => (typeof selector === 'function' ? selector(state) : state),
}));
vi.mock('../../lib/adultInvitationApi', () => invitationApi);

import { AdultInviteCard } from './AdultInviteCard';

const token = 'token/with spaces?';

function renderCard(props: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter>
      <AdultInviteCard {...props} />
    </MemoryRouter>,
  );
}

let writeText: ReturnType<typeof vi.fn>;

function setupUser() {
  const user = userEvent.setup();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    writable: true,
    value: { writeText },
  });
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.currentUser = { id: 'owner-1', role: 'owner' };
  invitationApi.createAdultInvitation.mockResolvedValue({
    invitationId: 'a'.repeat(64),
    token,
    intendedRole: 'parent',
    expiresAt: '2026-09-02T12:00:00.000Z',
  });
  invitationApi.revokeAdultInvitation.mockResolvedValue({ success: true });
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    writable: true,
    value: { writeText },
  });
  delete (navigator as any).share;
});

describe('AdultInviteCard', () => {
  it('fails closed for a non-owner even when rendered directly', () => {
    state.currentUser = { id: 'parent-1', role: 'parent' };
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
    expect(invitationApi.createAdultInvitation).not.toHaveBeenCalled();
  });

  it('defaults to parent and sends the exact owner creation payload', async () => {
    const user = setupUser();
    renderCard();
    expect(screen.getByRole('radio', { name: 'Parent' })).toBeChecked();
    expect(invitationApi.createAdultInvitation).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Create private invitation' }));
    await screen.findByRole('button', { name: 'Copy private link' });
    expect(invitationApi.createAdultInvitation).toHaveBeenCalledWith({
      intendedRole: 'parent',
      clientReqId: expect.any(String),
    });
  });

  it('allows selecting adult and encodes the raw token in a live-origin link', async () => {
    const user = setupUser();
    renderCard({ defaultRole: 'adult' });
    expect(screen.getByRole('radio', { name: 'Adult' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Create private invitation' }));
    expect(invitationApi.createAdultInvitation).toHaveBeenCalledWith({
      intendedRole: 'adult',
      clientReqId: expect.any(String),
    });
    const copyButton = await screen.findByRole('button', { name: 'Copy private link' });
    expect(copyButton).toBeEnabled();
    expect(screen.getByTestId('adult-invite-link')).toHaveAttribute(
      'href',
      `${window.location.origin}/invite/${encodeURIComponent(token)}`,
    );
    expect(screen.queryByText(token)).not.toBeInTheDocument();
  });

  it('does not issue duplicate create requests while creation is pending', async () => {
    const user = setupUser();
    let resolve: ((value: unknown) => void) | undefined;
    invitationApi.createAdultInvitation.mockReturnValue(new Promise(value => { resolve = value; }));
    renderCard();
    const create = screen.getByRole('button', { name: 'Create private invitation' });
    await user.click(create);
    await user.click(create);
    expect(invitationApi.createAdultInvitation).toHaveBeenCalledTimes(1);
    resolve?.({ invitationId: 'a'.repeat(64), token, intendedRole: 'parent', expiresAt: '2026-09-02T12:00:00.000Z' });
    await screen.findByRole('button', { name: 'Copy private link' });
  });

  it('copies the private link and falls back from share to clipboard', async () => {
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Create private invitation' }));
    await user.click(await screen.findByRole('button', { name: 'Copy private link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invite/${encodeURIComponent(token)}`);
    expect(await screen.findByText('Copied!')).toBeInTheDocument();

    (navigator as any).share = vi.fn().mockRejectedValue(new Error('dismissed'));
    await user.click(screen.getByRole('button', { name: 'Share private invitation' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining(
      `${window.location.origin}/invite/${encodeURIComponent(token)}`,
    )));
  });

  it('revokes using only the safe invitation id and request id, then clears the token', async () => {
    const user = setupUser();
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Create private invitation' }));
    await screen.findByRole('button', { name: 'Revoke invitation' });
    await user.click(screen.getByRole('button', { name: 'Revoke invitation' }));
    expect(invitationApi.revokeAdultInvitation).toHaveBeenCalledWith({
      invitationId: 'a'.repeat(64),
      clientReqId: expect.any(String),
    });
    await waitFor(() => expect(screen.queryByTestId('adult-invite-link')).not.toBeInTheDocument());
    expect(screen.getByText('Invitation revoked.')).toBeInTheDocument();
  });

  it('maps unavailable creation failures to a stable message without logging raw errors', async () => {
    const user = setupUser();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    invitationApi.createAdultInvitation.mockRejectedValue(new Error('INTERNAL_TOKEN_SECRET'));
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Create private invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invitation unavailable. Please try again.');
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('never persists the bearer token in browser storage', async () => {
    const user = setupUser();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Create private invitation' }));
    await screen.findByRole('button', { name: 'Copy private link' });
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.getItem('queki.pendingAdultInvite.v2')).toBeNull();
    expect(sessionStorage.getItem('queki.pendingAdultInvite.v2')).toBeNull();
    setItem.mockRestore();
  });
});
