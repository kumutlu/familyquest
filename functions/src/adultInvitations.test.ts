import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  generateAdultInvitationToken,
  hashAdultInvitationToken,
  INVITATION_TTL_MS,
  type AdultInvitationRecord,
  validateAdultRole,
} from './adultInvitations';

type ExpectedAdultInvitationRecord = {
  version: 2;
  familyId: string;
  intendedRole: 'parent' | 'adult';
  status: 'active' | 'accepted' | 'revoked';
  createdBy: string;
  createdAt: import('firebase-admin/firestore').Timestamp;
  expiresAt: import('firebase-admin/firestore').Timestamp;
  acceptedBy?: string;
  acceptedAt?: import('firebase-admin/firestore').Timestamp;
  revokedBy?: string;
  revokedAt?: import('firebase-admin/firestore').Timestamp;
  clientReqId: string;
};

describe('adult invitation token domain', () => {
  it('generates a token with 32 decoded random bytes and stores only its SHA-256 hash', () => {
    const token = generateAdultInvitationToken(() => Buffer.alloc(32, 7));

    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(token).toBe('BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc');
    expect(hashAdultInvitationToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashAdultInvitationToken(token)).not.toContain(token);
  });

  it.each(['owner', 'child', '', undefined])(
    'rejects non-adult invitation role %s',
    value => {
      expect(() => validateAdultRole(value)).toThrow('INVALID_INTENDED_ROLE');
    },
  );

  it('rejects padded, malformed, or incorrectly sized tokens before hashing', () => {
    expect(() => hashAdultInvitationToken(`${'A'.repeat(43)}=`)).toThrow('INVALID_INVITATION_TOKEN');
    expect(() => hashAdultInvitationToken('not a token')).toThrow('INVALID_INVITATION_TOKEN');
    expect(() => hashAdultInvitationToken('AQ')).toThrow('INVALID_INVITATION_TOKEN');
  });

  it('rejects a non-canonical 43-character token with altered unused final bits', () => {
    const canonical = generateAdultInvitationToken(() => Buffer.alloc(32, 7));
    const nonCanonical = `${canonical.slice(0, -1)}d`;

    expect(nonCanonical).not.toBe(canonical);
    expect(Buffer.from(nonCanonical, 'base64url')).toEqual(Buffer.alloc(32, 7));
    expect(() => hashAdultInvitationToken(nonCanonical)).toThrow('INVALID_INVITATION_TOKEN');
  });

  it('proves the seven-day authoritative record contract has no raw token field', () => {
    expect(INVITATION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expectTypeOf<AdultInvitationRecord>().toEqualTypeOf<ExpectedAdultInvitationRecord>();
    expectTypeOf<AdultInvitationRecord>().not.toHaveProperty('rawToken');
    expectTypeOf<AdultInvitationRecord>().not.toHaveProperty('token');
  });
});
