import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bindPendingInviteToUid,
  capturePendingInvite,
  readPendingInvite,
} from '../auth/pendingInviteIntent';

const TOKEN = 'CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws';

const authMocks = vi.hoisted(() => ({
  getRedirectResult: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
}));

vi.mock('firebase/auth', () => authMocks);
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => true })),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
}));
vi.mock('./firebase', () => ({
  auth: { name: 'auth' },
  db: { name: 'db' },
  googleProvider: { name: 'google' },
}));

describe('Google redirect authentication', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('initiates redirect authentication on mobile browsers', async () => {
    const { startGoogleAuthentication } = await import('./googleRedirectAuth');
    await startGoogleAuthentication({ mobile: true });
    expect(authMocks.signInWithRedirect).toHaveBeenCalledOnce();
    expect(authMocks.signInWithPopup).not.toHaveBeenCalled();
  });

  it('consumes the redirect result only once during bootstrap', async () => {
    authMocks.getRedirectResult.mockResolvedValue({ user: { uid: 'u1' } });
    const { consumeGoogleRedirectResult } = await import('./googleRedirectAuth');
    const first = consumeGoogleRedirectResult();
    const second = consumeGoogleRedirectResult();
    expect(first).toBe(second);
    await first;
    expect(authMocks.getRedirectResult).toHaveBeenCalledOnce();
  });

  it('returns friendly feedback for missing redirect state', async () => {
    authMocks.getRedirectResult.mockRejectedValue({ code: 'auth/missing-initial-state' });
    const { consumeGoogleRedirectResult } = await import('./googleRedirectAuth');
    await expect(consumeGoogleRedirectResult()).resolves.toEqual({
      credential: null,
      error: 'redirect-state-missing',
    });
  });

  it('accepts only a single-slash internal absolute return path', async () => {
    const { safeInternalReturnPath } = await import('./googleRedirectAuth');

    expect(safeInternalReturnPath(`/invite/${TOKEN}?source=email#join`)).toBe(
      `/invite/${TOKEN}?source=email#join`,
    );
    expect(safeInternalReturnPath('/onboarding')).toBe('/onboarding');
  });

  it.each([
    null,
    '',
    'invite/path',
    '//evil.example/invite',
    'https://evil.example/invite',
    'javascript:alert(1)',
    '/\\evil.example/invite',
    '/invite\\..\\evil',
    '/%2f%2fevil.example/invite',
    '/%5cevil.example/invite',
    '/%252f%252fevil.example/invite',
    '/invite/%00hidden',
    '/invite/line\nbreak',
    '/invite/trailing ',
    '/invite/non\u00a0breaking',
    '/invite/em\u2003space',
    '/invite/line\u2028separator',
    '/invite/paragraph\u2029separator',
    '/invite/%20space',
    '/invite/%c2%85control',
    '/invite/%c2%a0space',
    '/invite/%e2%80%a8separator',
    '/invite/%e2%80%a9separator',
    '/invite/%25c2%2585control',
    '/invite/%25e2%2580%25a8separator',
  ])('rejects unsafe return path %j', async value => {
    const { safeInternalReturnPath } = await import('./googleRedirectAuth');
    expect(safeInternalReturnPath(value)).toBeNull();
  });

  it('binds a fresh pending invite to the redirect-authenticated UID', async () => {
    capturePendingInvite(TOKEN);
    authMocks.getRedirectResult.mockResolvedValue({ user: { uid: 'uid-1' } });

    const { consumeGoogleRedirectResult } = await import('./googleRedirectAuth');
    await consumeGoogleRedirectResult();

    expect(readPendingInvite()).toMatchObject({ token: TOKEN, authUid: 'uid-1' });
  });

  it('returns a stable mismatch without clearing or rebinding the pending invite', async () => {
    capturePendingInvite(TOKEN);
    bindPendingInviteToUid('uid-1');
    const credential = { user: { uid: 'uid-2' } };
    authMocks.getRedirectResult.mockResolvedValue(credential);

    const { consumeGoogleRedirectResult } = await import('./googleRedirectAuth');
    await expect(consumeGoogleRedirectResult()).resolves.toEqual({
      credential,
      error: 'invite-account-mismatch',
    });
    expect(readPendingInvite()).toMatchObject({ token: TOKEN, authUid: 'uid-1' });
  });
});
