export const EMAIL_VERIFICATION_CONTINUE_URL = 'https://queki.app/verify-email';

type ProviderIdentity = {
  emailVerified?: boolean;
  providerData?: Array<{ providerId: string }>;
};

type AuthoritativeProfile = {
  role?: unknown;
  id?: unknown;
  familyId?: unknown;
  authUid?: unknown;
};

export function requiresPasswordEmailVerification(
  user: ProviderIdentity | null | undefined,
  currentSignInProvider?: string | null,
  authoritativeProfile?: AuthoritativeProfile | null,
  authUid?: string | null,
): boolean {
  if (!user || user.emailVerified) return false;
  // Managed children use synthetic password identities. Once the server has
  // resolved a coherent child profile, email verification is not an authority
  // requirement for that identity.
  if (
    authoritativeProfile?.role === 'child'
    && typeof authoritativeProfile.id === 'string'
    && typeof authoritativeProfile.familyId === 'string'
    && typeof authUid === 'string'
    && (authoritativeProfile.id === authUid || authoritativeProfile.authUid === authUid)
  ) return false;
  if (currentSignInProvider) return currentSignInProvider === 'password';
  return (user.providerData ?? []).some(provider => provider.providerId === 'password');
}

export function normalizeAndValidateEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('INVALID_EMAIL');
  return email;
}
