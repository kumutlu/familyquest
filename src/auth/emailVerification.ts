export const EMAIL_VERIFICATION_CONTINUE_URL = 'https://queki.app/verify-email';

type ProviderIdentity = {
  emailVerified?: boolean;
  providerData?: Array<{ providerId: string }>;
};

export function requiresPasswordEmailVerification(
  user: ProviderIdentity | null | undefined,
  currentSignInProvider?: string | null,
): boolean {
  if (!user || user.emailVerified) return false;
  if (currentSignInProvider) return currentSignInProvider === 'password';
  return (user.providerData ?? []).some(provider => provider.providerId === 'password');
}

export function normalizeAndValidateEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('INVALID_EMAIL');
  return email;
}
