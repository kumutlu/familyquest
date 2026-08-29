import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({
  familyData: { id: 'f1', inviteCode: '7ZXWRZ' } as any,
  currentUser: { id: 'owner-1', role: 'owner' } as any,
}));
const navigate = vi.hoisted(() => vi.fn());
const legacyApi = vi.hoisted(() => ({ createFamilyInvitation: vi.fn() }));
const adultApi = vi.hoisted(() => ({ createAdultInvitation: vi.fn(), revokeAdultInvitation: vi.fn() }));

vi.mock('../../store/useStore', () => ({ useStore: (selector: any) => (typeof selector === 'function' ? selector(state) : state) }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('../../lib/familyInvitationApi', () => legacyApi);
vi.mock('../../lib/adultInvitationApi', () => adultApi);

import { InviteMemberCard } from './InviteMemberCard';

function renderCard() {
  return render(<MemoryRouter><InviteMemberCard /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.currentUser = { id: 'owner-1', role: 'owner' };
  adultApi.createAdultInvitation.mockResolvedValue({ invitationId: 'a'.repeat(64), token: 'adult-token', intendedRole: 'parent', expiresAt: '2026-09-02T12:00:00.000Z' });
  adultApi.revokeAdultInvitation.mockResolvedValue({ success: true });
  legacyApi.createFamilyInvitation.mockResolvedValue({ code: 'ABC123', intendedRole: 'child', expiresAtMs: Date.now() + 1000 });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, writable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  delete (navigator as any).share;
});

describe('InviteMemberCard', () => {
  it('keeps child and managed-child choices while routing parent to the v2 primitive', () => {
    renderCard();
    expect(screen.getByText('Another Parent')).toBeInTheDocument();
    expect(screen.getByText('Child with their own device')).toBeInTheDocument();
    expect(screen.getByText('Managed Child')).toBeInTheDocument();
    expect(legacyApi.createFamilyInvitation).not.toHaveBeenCalled();
  });

  it('creates a parent invitation immediately after the owner selects that choice', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Another Parent/ }));
    expect(screen.getByTestId('adult-invite-card')).toBeVisible();
    await screen.findByRole('button', { name: 'Copy private link' });
    expect(adultApi.createAdultInvitation).toHaveBeenCalledWith({ intendedRole: 'parent', clientReqId: expect.any(String) });
  });

  it('hides the adult choice for non-owners but preserves child choices', () => {
    state.currentUser = { id: 'parent-1', role: 'parent' };
    renderCard();
    expect(screen.queryByText('Another Parent')).not.toBeInTheDocument();
    expect(screen.getByText('Child with their own device')).toBeInTheDocument();
    expect(screen.getByText('Managed Child')).toBeInTheDocument();
  });

  it('continues creating child invitations through the legacy child contract', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole('button', { name: /Child with their own device/ }));
    expect(legacyApi.createFamilyInvitation).toHaveBeenCalledWith('child');
    expect(adultApi.createAdultInvitation).not.toHaveBeenCalled();
  });
});
