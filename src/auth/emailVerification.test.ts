import { describe, expect, it } from 'vitest';
import { requiresPasswordEmailVerification, normalizeAndValidateEmail } from './emailVerification';

describe('password email verification authority', () => {
  it('requires verification for an unverified password identity', () => {
    expect(requiresPasswordEmailVerification({
      emailVerified: false,
      providerData: [{ providerId: 'password' }],
    })).toBe(true);
  });

  it('allows verified password and trusted federated identities', () => {
    expect(requiresPasswordEmailVerification({ emailVerified: true, providerData: [{ providerId: 'password' }] })).toBe(false);
    expect(requiresPasswordEmailVerification({ emailVerified: false, providerData: [{ providerId: 'google.com' }] })).toBe(false);
    expect(requiresPasswordEmailVerification(
      { emailVerified: false, providerData: [{ providerId: 'password' }, { providerId: 'google.com' }] },
      'google.com',
    )).toBe(false);
  });

  it('does not gate managed custom-token identities', () => {
    expect(requiresPasswordEmailVerification({ emailVerified: false, providerData: [] })).toBe(false);
  });

  it('normalizes valid email and rejects invalid syntax before Firebase', () => {
    expect(normalizeAndValidateEmail('  Parent@Example.COM ')).toBe('parent@example.com');
    expect(() => normalizeAndValidateEmail('not-an-email')).toThrow('INVALID_EMAIL');
  });
});
