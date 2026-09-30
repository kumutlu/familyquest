import { describe, expect, it, vi } from 'vitest';

import { refreshFamilyAuthority } from './familyAuthority';

function passwordUser(emailVerified: boolean, claimVerified: boolean) {
  return {
    emailVerified,
    reload: vi.fn(async () => {}),
    getIdTokenResult: vi.fn(async (forceRefresh: boolean) => ({
      claims: {
        email_verified: claimVerified,
        firebase: { sign_in_provider: 'password' },
      },
      forceRefresh,
    })),
  } as any;
}

describe('refreshFamilyAuthority', () => {
  it('reloads then force-refreshes the token and permits password authority only when the claim is true', async () => {
    const user = passwordUser(true, true);

    await expect(refreshFamilyAuthority(user)).resolves.toBe(true);
    expect(user.reload).toHaveBeenCalledTimes(1);
    expect(user.getIdTokenResult).toHaveBeenCalledWith(true);
    expect(user.reload.mock.invocationCallOrder[0]).toBeLessThan(user.getIdTokenResult.mock.invocationCallOrder[0]);
  });

  it('fails closed when Firebase user state is verified but the forced token claim is stale', async () => {
    await expect(refreshFamilyAuthority(passwordUser(true, false))).resolves.toBe(false);
  });

  it('fails closed when the token claim is true but reloaded Firebase user state is not verified', async () => {
    await expect(refreshFamilyAuthority(passwordUser(false, true))).resolves.toBe(false);
  });

  it('does not impose password verification on a federated provider', async () => {
    const user = passwordUser(false, false);
    user.getIdTokenResult.mockResolvedValue({ claims: { firebase: { sign_in_provider: 'google.com' } } });
    await expect(refreshFamilyAuthority(user)).resolves.toBe(true);
  });
});
