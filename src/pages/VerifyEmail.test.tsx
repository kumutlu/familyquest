import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/config';

const navigate = vi.hoisted(() => vi.fn());
const api = vi.hoisted(() => ({
  refreshEmailVerification: vi.fn(), resendVerificationEmail: vi.fn(), signOut: vi.fn(),
}));
vi.mock('react-router-dom', async importOriginal => ({
  ...await importOriginal<typeof import('react-router-dom')>(), useNavigate: () => navigate,
}));
vi.mock('../lib/api', () => api);
vi.mock('../store/useStore', () => ({ useStore: (selector: any) => selector({ authUser: { uid: 'u1', email: 'parent@example.com' } }) }));

import { VerifyEmail } from './VerifyEmail';
import { capturePreAuthCreateFamilySelection, readCreateFamilyIntent } from '../auth/createFamilyIntent';
import { capturePendingInvite } from '../auth/pendingInviteIntent';
import { rememberPendingInvite } from '../lib/inviteLink';

const INVITE_TOKEN = 'CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws';

beforeEach(async () => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  await i18n.loadNamespaces(['auth']);
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('VerifyEmail', () => {
  it('reloads authoritative auth state and resumes only when verified', async () => {
    api.refreshEmailVerification.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const user = userEvent.setup();
    render(<MemoryRouter><VerifyEmail /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /i've verified/i }));
    expect(await screen.findByRole('status')).toHaveTextContent('not verified yet');
    expect(navigate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /i've verified/i }));
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('resends only on an explicit action and starts a cooldown', async () => {
    api.resendVerificationEmail.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<MemoryRouter><VerifyEmail /></MemoryRouter>);
    const resend = screen.getByRole('button', { name: /resend email/i });
    expect(api.resendVerificationEmail).not.toHaveBeenCalled();
    await user.click(resend);
    expect(api.resendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(resend).toBeDisabled();
  });

  it('resumes the UID-bound create intent after verification', async () => {
    capturePreAuthCreateFamilySelection();
    readCreateFamilyIntent('u1');
    api.refreshEmailVerification.mockResolvedValue(true);
    const user = userEvent.setup();
    render(<MemoryRouter><VerifyEmail /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /i've verified/i }));
    expect(navigate).toHaveBeenCalledWith('/onboarding?mode=create', { replace: true });
  });

  it('resumes an adult invitation ahead of create and legacy join intents', async () => {
    capturePreAuthCreateFamilySelection();
    readCreateFamilyIntent('u1');
    rememberPendingInvite('ABC123');
    capturePendingInvite(INVITE_TOKEN);
    api.refreshEmailVerification.mockResolvedValue(true);

    render(<MemoryRouter><VerifyEmail /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /i've verified/i }));

    expect(navigate).toHaveBeenCalledWith(`/invite/${INVITE_TOKEN}`, { replace: true });
  });

  it('resumes a legacy join intent when no adult invitation is pending', async () => {
    rememberPendingInvite('ABC123');
    api.refreshEmailVerification.mockResolvedValue(true);

    render(<MemoryRouter><VerifyEmail /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /i've verified/i }));

    expect(navigate).toHaveBeenCalledWith('/join?code=ABC123', { replace: true });
  });

  it('signs out explicitly without exposing a Firebase error', async () => {
    api.signOut.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<MemoryRouter><VerifyEmail /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /use a different email/i }));
    expect(api.signOut).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/login', { replace: true });
  });
});
