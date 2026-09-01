import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/config';

const authState = vi.hoisted(() => ({ currentUser: null as null | { emailVerified: boolean; reload: () => Promise<void> } }));
const authApi = vi.hoisted(() => ({ applyActionCode: vi.fn() }));

vi.mock('../lib/firebase', () => ({ auth: authState }));
vi.mock('firebase/auth', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/auth')>(),
  applyActionCode: authApi.applyActionCode,
}));

import { EmailActionVerify } from './EmailActionVerify';

function Destination() {
  const location = useLocation();
  return <p data-testid="destination">{location.pathname}{location.search}</p>;
}

function renderAction(search = '?mode=verifyEmail&oobCode=valid-code') {
  return render(
    <MemoryRouter initialEntries={[`/auth/verify${search}`]}>
      <Routes>
        <Route path="/auth/verify" element={<EmailActionVerify />} />
        <Route path="*" element={<Destination />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  authState.currentUser = null;
  await i18n.loadNamespaces(['auth', 'common']);
  await act(async () => { await i18n.changeLanguage('en'); });
});

describe('EmailActionVerify', () => {
  it('redeems the code and continues only to the canonical authority-resume route', async () => {
    authApi.applyActionCode.mockResolvedValue(undefined);
    renderAction('?mode=verifyEmail&oobCode=valid-code&continueUrl=https%3A%2F%2Fevil.example%2Fsteal');

    expect(await screen.findByRole('heading', { name: /email verified/i })).toBeVisible();
    expect(authApi.applyActionCode).toHaveBeenCalledWith(authState, 'valid-code');

    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(screen.getByTestId('destination')).toHaveTextContent('/verify-email');
    expect(screen.getByTestId('destination')).not.toHaveTextContent('evil.example');
  });

  it('rejects malformed or unsupported actions without redeeming a code', async () => {
    renderAction('?mode=resetPassword&oobCode=code');

    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer valid/i);
    expect(authApi.applyActionCode).not.toHaveBeenCalled();
  });

  it('shows a specific expired-link error', async () => {
    authApi.applyActionCode.mockRejectedValue({ code: 'auth/expired-action-code' });
    renderAction();

    expect(await screen.findByRole('alert')).toHaveTextContent(/expired/i);
  });

  it('reports already verified only after reloading an authenticated verified user', async () => {
    const reload = vi.fn(async () => undefined);
    authState.currentUser = { emailVerified: true, reload };
    authApi.applyActionCode.mockRejectedValue({ code: 'auth/invalid-action-code' });
    renderAction();

    expect(await screen.findByText(/your email is already verified/i)).toBeVisible();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('offers Retry for a network failure and succeeds with the same code', async () => {
    authApi.applyActionCode
      .mockRejectedValueOnce({ code: 'auth/network-request-failed' })
      .mockResolvedValueOnce(undefined);
    renderAction();

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not verify/i);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));

    expect(await screen.findByRole('heading', { name: /email verified/i })).toBeVisible();
    expect(authApi.applyActionCode).toHaveBeenCalledTimes(2);
    expect(authApi.applyActionCode).toHaveBeenNthCalledWith(2, authState, 'valid-code');
  });
});
