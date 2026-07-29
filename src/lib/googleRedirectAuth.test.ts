import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
