import type { User } from 'firebase/auth';

type RefreshableUser = Pick<User, 'emailVerified' | 'reload' | 'getIdTokenResult'>;

/**
 * Refreshes both Firebase's user record and the ID token used by Rules and
 * callable Functions. Password identities receive authority only when both
 * authoritative views agree that the address is verified.
 */
export async function refreshFamilyAuthority(user: RefreshableUser): Promise<boolean> {
  await user.reload();
  const tokenResult = await user.getIdTokenResult(true);
  const claims = tokenResult.claims as Record<string, unknown>;
  const firebaseClaim = claims.firebase as { sign_in_provider?: unknown } | undefined;
  const provider = firebaseClaim?.sign_in_provider;

  if (provider !== 'password') return true;
  return user.emailVerified === true && claims.email_verified === true;
}
