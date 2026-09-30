import { describe, expect, it } from 'vitest';
import { requireFamilyAuthority } from './emailVerificationAuthority';

const request = (provider: string, verified: boolean) => ({
  auth: { uid: 'u1', token: { firebase: { sign_in_provider: provider }, email_verified: verified } },
}) as any;

describe('callable family authority', () => {
  it('rejects an unverified password token', () => {
    expect(() => requireFamilyAuthority(request('password', false))).toThrow('EMAIL_VERIFICATION_REQUIRED');
  });

  it('allows verified password and non-password providers', () => {
    expect(() => requireFamilyAuthority(request('password', true))).not.toThrow();
    expect(() => requireFamilyAuthority(request('google.com', false))).not.toThrow();
    expect(() => requireFamilyAuthority(request('custom', false))).not.toThrow();
  });
});
