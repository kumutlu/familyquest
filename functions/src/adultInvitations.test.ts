import { describe, expect, it } from 'vitest';

import {
  generateAdultInvitationToken,
  hashAdultInvitationToken,
  validateAdultRole,
} from './adultInvitations';

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
});
