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

  it('does not gate an unverified password identity after server-confirmed child resolution', () => {
    expect(requiresPasswordEmailVerification(
      { emailVerified: false, providerData: [{ providerId: 'password' }] },
      'password',
      { role: 'child', id: 'child-1', familyId: 'family-1' },
      'child-1',
    )).toBe(false);
  });

  it('fails closed when a child profile belongs to another Auth identity', () => {
    expect(requiresPasswordEmailVerification(
      { emailVerified: false, providerData: [{ providerId: 'password' }] },
      'password',
      { role: 'child', id: 'child-1', authUid: 'auth-old', familyId: 'family-1' },
      'auth-new',
    )).toBe(true);
  });

  it('grants the exemption to a device-bound child profile whose document id differs from the Auth UID but whose linked authUid field matches', () => {
    // QR/device onboarding binds an existing child profile server-side by writing
    // authUid onto users/{childId}; the document id and the auth uid are distinct.
    expect(requiresPasswordEmailVerification(
      { emailVerified: false, providerData: [{ providerId: 'password' }] },
      'password',
      { role: 'child', id: 'child-doc-1', authUid: 'auth-1', familyId: 'family-1' },
      'auth-1',
    )).toBe(false);
  });

  it('grants the exemption when the profile document id matches the Auth UID even if no authUid field is linked', () => {
    expect(requiresPasswordEmailVerification(
      { emailVerified: false, providerData: [{ providerId: 'password' }] },
      'password',
      { role: 'child', id: 'auth-1', familyId: 'family-1' },
      'auth-1',
    )).toBe(false);
  });

  it('denies the exemption when neither the document id nor the linked authUid matches the Auth UID', () => {
    // Tripwire: if the second operand ever degenerated into a tautology
    // (e.g. authUid === authUid), a profile bound to another identity would
    // wrongly clear the verification gate.
    expect(requiresPasswordEmailVerification(
      { emailVerified: false, providerData: [{ providerId: 'password' }] },
      'password',
      { role: 'child', id: 'child-doc-1', authUid: 'auth-other', familyId: 'family-1' },
      'auth-9',
    )).toBe(true);
  });

  it('does not let a stale child profile bypass verification after an account switch', () => {
    const staleChild = { role: 'child', id: 'child-old', authUid: 'auth-old', familyId: 'family-1' };
    expect(requiresPasswordEmailVerification(
      { emailVerified: false, providerData: [{ providerId: 'password' }] },
      'password', staleChild, 'adult-new',
    )).toBe(true);
    expect(requiresPasswordEmailVerification(
      { emailVerified: false, providerData: [{ providerId: 'password' }] },
      'password', staleChild, 'child-new',
    )).toBe(true);
  });

  it('only bypasses after the newly signed-in child profile matches the current Auth UID', () => {
    expect(requiresPasswordEmailVerification(
      { emailVerified: false, providerData: [{ providerId: 'password' }] },
      'password', null, 'auth-new',
    )).toBe(true);
    expect(requiresPasswordEmailVerification(
      { emailVerified: false, providerData: [{ providerId: 'password' }] },
      'password', { role: 'child', id: 'child-new', authUid: 'auth-new', familyId: 'family-1' }, 'auth-new',
    )).toBe(false);
  });

  it('does not treat a synthetic-looking email as managed-child authority', () => {
    expect(requiresPasswordEmailVerification(
      {
        emailVerified: false,
        providerData: [{ providerId: 'password' }],
        email: 'child-1@managed.queki.invalid',
      } as Parameters<typeof requiresPasswordEmailVerification>[0],
      'password', null, 'child-1',
    )).toBe(true);
  });

  it('fails closed when the matching child profile has no family association', () => {
    expect(requiresPasswordEmailVerification(
      { emailVerified: false, providerData: [{ providerId: 'password' }] },
      'password', { role: 'child', id: 'child-1', authUid: 'auth-1' }, 'auth-1',
    )).toBe(true);
  });

  it('continues requiring verification for an unverified adult profile', () => {
    expect(requiresPasswordEmailVerification(
      { emailVerified: false, providerData: [{ providerId: 'password' }] },
      'password', { role: 'parent', id: 'adult-1', authUid: 'adult-1', familyId: 'family-1' }, 'adult-1',
    )).toBe(true);
  });

  it('normalizes valid email and rejects invalid syntax before Firebase', () => {
    expect(normalizeAndValidateEmail('  Parent@Example.COM ')).toBe('parent@example.com');
    expect(() => normalizeAndValidateEmail('not-an-email')).toThrow('INVALID_EMAIL');
  });
});
