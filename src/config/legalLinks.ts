/**
 * Public legal / privacy surfaces.
 *
 * App Store review requires a reachable Privacy Policy, Terms of Service and a
 * documented account-deletion path. The URLs are deployment-specific, so they
 * are supplied as build-time environment variables rather than hard-coded:
 *
 *   VITE_PRIVACY_POLICY_URL
 *   VITE_TERMS_URL
 *   VITE_ACCOUNT_DELETION_URL
 *
 * Any variable that is absent, blank or not an absolute http(s) URL is treated
 * as "not configured" and the corresponding link is simply not rendered — a
 * broken or `javascript:` link is worse than no link at all.
 */

export type LegalLinkKey = 'privacyPolicy' | 'terms' | 'accountDeletion';

export interface LegalLinks {
  privacyPolicy: string | null;
  terms: string | null;
  accountDeletion: string | null;
}

const ENV_KEYS: Record<LegalLinkKey, string> = {
  privacyPolicy: 'VITE_PRIVACY_POLICY_URL',
  terms: 'VITE_TERMS_URL',
  accountDeletion: 'VITE_ACCOUNT_DELETION_URL',
};

/** Accepts only absolute http(s) URLs; everything else is rejected. */
export function normaliseLegalUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function getLegalLinks(
  env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
): LegalLinks {
  return {
    privacyPolicy: normaliseLegalUrl(env[ENV_KEYS.privacyPolicy]),
    terms: normaliseLegalUrl(env[ENV_KEYS.terms]),
    accountDeletion: normaliseLegalUrl(env[ENV_KEYS.accountDeletion]),
  };
}
