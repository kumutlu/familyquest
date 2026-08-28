import { describe, expect, it, vi } from 'vitest';

import { recordInviteEvent } from './inviteAnalytics';

describe('invite analytics sanitization', () => {
  it('emits only allowlisted categorical client fields', () => {
    const logger = { info: vi.fn() };
    recordInviteEvent('invitation_accepted', {
      authProvider: 'google', role: 'parent', outcome: 'success', buildSha: 'abcdef1',
      source: 'adult_invite', token: 'rawToken-secret', tokenHash: 'tokenHash-secret',
      invitationId: 'invitation-id-secret', uid: 'uid-1', familyId: 'family-1',
      email: 'smith@example.com', name: 'Smith', nested: { email: 'nested@example.com', uid: 'uid-2' },
    }, logger);
    expect(logger.info).toHaveBeenCalledWith('invite_event', {
      eventName: 'invitation_accepted', authProvider: 'google', role: 'parent', outcome: 'success',
      buildSha: 'abcdef1', source: 'adult_invite',
    });
    expect(JSON.stringify(logger.info.mock.calls)).not.toMatch(
      /rawToken|tokenHash|invitation-id-secret|smith@example|family-1|uid-1|Smith|nested@example/,
    );
  });

  it('records explicit creation only for the known source category', () => {
    const logger = { info: vi.fn() };
    recordInviteEvent('family_creation_explicitly_started', { source: 'no_family_choice' }, logger);
    expect(logger.info).toHaveBeenCalledWith('invite_event', {
      eventName: 'family_creation_explicitly_started', source: 'no_family_choice', buildSha: expect.any(String),
    });
    recordInviteEvent('family_creation_explicitly_started', {
      source: 'uid-1', nested: { familyId: 'family-1' },
    }, logger);
    expect(logger.info).toHaveBeenLastCalledWith('invite_event', {
      eventName: 'family_creation_explicitly_started', buildSha: expect.any(String),
    });
  });
});
