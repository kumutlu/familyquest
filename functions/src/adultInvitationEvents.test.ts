import { describe, expect, it, vi } from 'vitest';

import { recordAdultInvitationEvent } from './adultInvitationEvents';

describe('adult invitation event sanitization', () => {
  it('keeps only explicit safe server fields, including against nested sensitive input', () => {
    const logger = { info: vi.fn() };

    recordAdultInvitationEvent('invitation_created', {
      version: 2,
      intendedRole: 'parent',
      outcome: 'success',
      rawToken: 'rawToken-secret',
      tokenHash: 'tokenHash-secret',
      invitationId: 'invitation-id-secret',
      uid: 'uid-1',
      familyId: 'family-1',
      email: 'smith@example.com',
      displayName: 'Smith',
      nested: {
        rawToken: 'nested-token',
        email: 'nested@example.com',
      },
    }, logger);

    expect(logger.info).toHaveBeenCalledWith('adult_invitation_event', {
      eventName: 'invitation_created',
      version: 2,
      intendedRole: 'parent',
      outcome: 'success',
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(
      /rawToken|tokenHash|invitation-id-secret|smith@example|family-1|uid-1|Smith|nested-token/,
    );
  });

  it('drops invalid categories and untrusted identifiers instead of forwarding them', () => {
    const logger = { info: vi.fn() };

    recordAdultInvitationEvent('invitation_preview_failed', {
      version: 3,
      intendedRole: 'owner',
      outcome: 'uid-1',
      latencyBucket: 'tokenHash-secret',
      buildSha: 'uid-1',
      correlationId: 'uid-1',
    }, logger);

    expect(logger.info).toHaveBeenCalledWith('adult_invitation_event', {
      eventName: 'invitation_preview_failed',
    });
  });
});
