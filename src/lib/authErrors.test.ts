import { describe, expect, it } from 'vitest';
import { mapAuthErrorMessage } from './api';

describe('mapAuthErrorMessage', () => {
  it('maps known auth error codes to friendly, non-technical messages', () => {
    expect(mapAuthErrorMessage({ code: 'auth/invalid-email' })).toMatch(/email/i);
    expect(mapAuthErrorMessage({ code: 'auth/user-not-found' })).toMatch(/account/i);
    expect(mapAuthErrorMessage({ code: 'auth/wrong-password' })).toMatch(/account/i);
    expect(mapAuthErrorMessage({ code: 'auth/invalid-credential' })).toMatch(/account/i);
    expect(mapAuthErrorMessage({ code: 'auth/too-many-requests' })).toMatch(/too many/i);
    expect(mapAuthErrorMessage({ code: 'auth/network-request-failed' })).toMatch(/network/i);
    expect(mapAuthErrorMessage({ code: 'auth/requires-recent-login' })).toMatch(/sign (out|back)/i);
  });

  it('never exposes the raw Firebase error code or server message', () => {
    const raw = { code: 'auth/user-not-found', message: 'Some internal firebase text' };
    const out = mapAuthErrorMessage(raw);
    expect(out).not.toContain('auth/user-not-found');
    expect(out).not.toContain('Some internal firebase text');
  });

  it('falls back to a generic message for unknown or missing errors', () => {
    expect(mapAuthErrorMessage(undefined)).toMatch(/something went wrong/i);
    expect(mapAuthErrorMessage({})).toMatch(/something went wrong/i);
    expect(mapAuthErrorMessage({ code: 'auth/unknown-code' })).toMatch(/something went wrong/i);
  });
});
