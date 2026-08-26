import { describe, expect, it } from 'vitest';

import { mapAuthErrorKey } from './authErrorMessage';

describe('mapAuthErrorKey', () => {
  it('maps an existing email to invite-aware sign-in guidance', () => {
    expect(mapAuthErrorKey(
      { code: 'auth/email-already-in-use', message: 'Firebase: raw internal text' },
      { pendingInvite: true },
    )).toBe('auth:errors.emailAlreadyUsedInvite');
  });

  it.each([
    ['auth/email-already-in-use', false, 'auth:errors.emailAlreadyUsed'],
    ['auth/invalid-credential', true, 'auth:errors.invalidCredential'],
    ['auth/user-not-found', true, 'auth:errors.invalidCredential'],
    ['auth/wrong-password', true, 'auth:errors.invalidCredential'],
    ['auth/popup-closed-by-user', true, 'auth:errors.popupClosed'],
    ['auth/account-exists-with-different-credential', true, 'auth:errors.differentCredential'],
    ['auth/credential-already-in-use', true, 'auth:errors.differentCredential'],
    ['auth/network-request-failed', true, 'auth:errors.network'],
    ['auth/too-many-requests', true, 'auth:errors.tooManyAttempts'],
    ['auth/unknown-code', true, 'auth:errors.generic'],
  ])('maps %s without exposing raw detail', (code, pendingInvite, expected) => {
    expect(mapAuthErrorKey(
      { code, message: `Firebase raw ${code}` },
      { pendingInvite },
    )).toBe(expected);
  });
});
