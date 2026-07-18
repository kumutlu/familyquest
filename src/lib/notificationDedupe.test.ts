import { describe, it, expect } from 'vitest';
import {
  taskSubmittedKey, taskApprovedKey, taskRejectedKey, behaviourKey,
  transferRequestedKey, transferApprovedSenderKey, transferApprovedRecipientKey, transferRejectedKey,
  profileUpdateRequestedKey, profileUpdateApprovedKey, profileUpdateRejectedKey,
} from './notificationDedupe';

describe('dedupe keys', () => {
  it('are deterministic for the same business id', () => {
    expect(taskSubmittedKey('c1')).toBe(taskSubmittedKey('c1'));
    expect(transferApprovedSenderKey('r1')).toBe(transferApprovedSenderKey('r1'));
    expect(transferApprovedRecipientKey('r1')).toBe(transferApprovedRecipientKey('r1'));
  });

  it('do not contain timestamps or random values', () => {
    const key = transferApprovedSenderKey('r1');
    expect(key).toBe('transfer_approve_sender_r1');
    // A large numeric run would indicate a timestamp/random component.
    expect(/\d{10,}/.test(key)).toBe(false);
  });

  it('sender and recipient transfer keys cannot collide', () => {
    expect(transferApprovedSenderKey('r1')).not.toBe(transferApprovedRecipientKey('r1'));
  });

  it('approval and rejection keys cannot collide', () => {
    expect(taskApprovedKey('c1')).not.toBe(taskRejectedKey('c1'));
    expect(transferApprovedSenderKey('r1')).not.toBe(transferRejectedKey('r1'));
    expect(transferApprovedRecipientKey('r1')).not.toBe(transferRejectedKey('r1'));
  });

  it('distinct business events produce distinct keys', () => {
    expect(taskSubmittedKey('c1')).not.toBe(taskSubmittedKey('c2'));
    expect(transferRequestedKey('r1')).not.toBe(transferRequestedKey('r2'));
  });

  it('all keys for one request id are unique', () => {
    const keys = new Set([
      transferRequestedKey('r1'),
      transferApprovedSenderKey('r1'),
      transferApprovedRecipientKey('r1'),
      transferRejectedKey('r1'),
      profileUpdateRequestedKey('r1'),
      profileUpdateApprovedKey('r1'),
      profileUpdateRejectedKey('r1'),
    ]);
    expect(keys.size).toBe(7);
  });

  it('profile update requested/approved/rejected keys are distinct', () => {
    expect(profileUpdateRequestedKey('r1')).not.toBe(profileUpdateApprovedKey('r1'));
    expect(profileUpdateRequestedKey('r1')).not.toBe(profileUpdateRejectedKey('r1'));
    expect(profileUpdateApprovedKey('r1')).not.toBe(profileUpdateRejectedKey('r1'));
    expect(profileUpdateRequestedKey('r1')).toBe('profile_update_request_r1');
  });

  it('behaviour keys are unique per event', () => {
    expect(behaviourKey('e1')).not.toBe(behaviourKey('e2'));
  });
});
