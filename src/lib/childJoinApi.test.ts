import { describe, it, expect, beforeEach, vi } from 'vitest';

const callable = vi.hoisted(() => vi.fn());
vi.mock('./firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: callable }));

import {
  mapChildJoinErrorKey,
  submitChildJoinRequest,
  storeJoinRequestHandle,
  readJoinRequestHandle,
  clearJoinRequestHandle,
} from './childJoinApi';

beforeEach(() => {
  sessionStorage.clear();
  callable.mockReset();
});

describe('submitChildJoinRequest callable contract', () => {
  it('sends only the existing child join fields, never adult invitation fields', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: {
        requestId: 'joinreq-1',
        requestSecret: 'request-secret-1',
        username: 'alex',
        status: 'pending',
        expiresAt: 123,
      },
    });
    callable.mockReturnValue(invoke);

    await submitChildJoinRequest({ familyCode: 'ABC123', username: 'alex', password: 'Password1!' });

    expect(callable).toHaveBeenCalledWith(expect.anything(), 'submitChildJoinRequest');
    expect(invoke).toHaveBeenCalledWith({
      familyCode: 'ABC123',
      username: 'alex',
      password: 'Password1!',
    });
    expect(invoke.mock.calls[0][0]).not.toHaveProperty('token');
    expect(invoke.mock.calls[0][0]).not.toHaveProperty('invitationToken');
  });
});

describe('mapChildJoinErrorKey', () => {
  it('maps every family-resolution failure to the same generic key', () => {
    expect(mapChildJoinErrorKey(new Error('JOIN_REQUEST_FAILED'))).toBe(
      'auth:childJoin.errors.invalidRequest',
    );
    expect(mapChildJoinErrorKey({ code: 'functions/invalid-argument', message: 'JOIN_REQUEST_FAILED' })).toBe(
      'auth:childJoin.errors.invalidRequest',
    );
  });

  it('maps username and password policy failures to the generic invalid-request key', () => {
    expect(mapChildJoinErrorKey(new Error('USERNAME_LENGTH'))).toBe(
      'auth:childJoin.errors.invalidRequest',
    );
    expect(mapChildJoinErrorKey(new Error('PASSWORD_TOO_SHORT'))).toBe(
      'auth:childJoin.errors.invalidRequest',
    );
  });

  it('maps duplicate username, rate limits, network and not-found', () => {
    expect(mapChildJoinErrorKey(new Error('USERNAME_TAKEN'))).toBe(
      'auth:childJoin.errors.usernameTaken',
    );
    expect(mapChildJoinErrorKey(new Error('TOO_MANY_JOIN_REQUESTS'))).toBe(
      'auth:childJoin.errors.rateLimited',
    );
    expect(mapChildJoinErrorKey({ code: 'functions/unavailable', message: 'x' })).toBe(
      'auth:childJoin.errors.network',
    );
    expect(mapChildJoinErrorKey(new Error('JOIN_REQUEST_NOT_FOUND'))).toBe(
      'auth:childJoin.errors.notFound',
    );
  });

  it('falls back to a generic key for unknown errors', () => {
    expect(mapChildJoinErrorKey(new Error('WHO_KNOWS'))).toBe('auth:childJoin.errors.generic');
    expect(mapChildJoinErrorKey(undefined)).toBe('auth:childJoin.errors.generic');
  });
});

describe('join request handle storage', () => {
  it('round-trips the opaque handle and nothing else', () => {
    storeJoinRequestHandle({
      requestId: 'joinreq-1',
      requestSecret: 'request-secret-1',
      username: 'alex',
    });
    expect(readJoinRequestHandle()).toEqual({
      requestId: 'joinreq-1',
      requestSecret: 'request-secret-1',
      username: 'alex',
    });
    // No credential or family material may ever be persisted.
    const raw = sessionStorage.getItem('queki.childJoinRequest') ?? '';
    expect(raw).not.toContain('password');
    expect(raw).not.toContain('familyId');
    expect(raw).not.toContain('familyCode');
  });

  it('clears the handle', () => {
    storeJoinRequestHandle({ requestId: 'a1b2c3', requestSecret: 's', username: 'u' });
    clearJoinRequestHandle();
    expect(readJoinRequestHandle()).toBeNull();
  });

  it('ignores malformed stored data', () => {
    sessionStorage.setItem('queki.childJoinRequest', '{ not json');
    expect(readJoinRequestHandle()).toBeNull();
    sessionStorage.setItem('queki.childJoinRequest', JSON.stringify({ requestId: 1 }));
    expect(readJoinRequestHandle()).toBeNull();
  });
});
