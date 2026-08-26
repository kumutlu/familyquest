import { beforeEach, describe, expect, it } from 'vitest';

import {
  bindPendingInviteToUid,
  capturePendingInvite,
  clearPendingInvite,
  clearPendingInviteIfMatches,
  isPendingInviteFresh,
  PENDING_ADULT_INVITE_KEY,
  readPendingInvite,
} from './pendingInviteIntent';

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN = 'CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws';
const TOKEN_B = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('pending adult invitation intent', () => {
  it('mirrors only token intent and survives session loss', () => {
    capturePendingInvite(TOKEN, 1_000);
    sessionStorage.clear();

    expect(readPendingInvite(2_000)).toEqual({ version: 2, token: TOKEN, capturedAt: 1_000 });
    expect(localStorage.getItem(PENDING_ADULT_INVITE_KEY)).not.toMatch(/familyId|familyName|role|email/);
  });

  it('clears intent at exactly seven days and treats the TTL as strict', () => {
    capturePendingInvite(TOKEN, 1_000);

    const atExpiry = 1_000 + 7 * DAY_MS;
    const intent = { version: 2 as const, token: TOKEN, capturedAt: 1_000 };
    expect(isPendingInviteFresh(intent, atExpiry)).toBe(false);
    expect(readPendingInvite(atExpiry)).toBeNull();
    expect(sessionStorage.getItem(PENDING_ADULT_INVITE_KEY)).toBeNull();
    expect(localStorage.getItem(PENDING_ADULT_INVITE_KEY)).toBeNull();
  });

  it('does not silently rebind an invite to a different authenticated account', () => {
    const now = Date.now();
    capturePendingInvite(TOKEN, now);
    bindPendingInviteToUid('uid-a');

    expect(() => bindPendingInviteToUid('uid-b')).toThrow('INVITE_ACCOUNT_MISMATCH');
    expect(readPendingInvite(now + 1_000)?.authUid).toBe('uid-a');
  });

  it('rejects a bind when local storage has a same-token binding hidden by an unbound session copy', () => {
    const now = Date.now();
    sessionStorage.setItem(PENDING_ADULT_INVITE_KEY, JSON.stringify({
      version: 2, token: TOKEN, capturedAt: now,
    }));
    localStorage.setItem(PENDING_ADULT_INVITE_KEY, JSON.stringify({
      version: 2, token: TOKEN, capturedAt: now, authUid: 'uid-b',
    }));

    expect(() => bindPendingInviteToUid('uid-a')).toThrow('INVITE_ACCOUNT_MISMATCH');
    expect(JSON.parse(sessionStorage.getItem(PENDING_ADULT_INVITE_KEY)!)).not.toHaveProperty('authUid');
    expect(JSON.parse(localStorage.getItem(PENDING_ADULT_INVITE_KEY)!)).toMatchObject({ authUid: 'uid-b' });
  });

  it('rejects differing valid bindings across session and local storage without overwriting either', () => {
    const now = Date.now();
    sessionStorage.setItem(PENDING_ADULT_INVITE_KEY, JSON.stringify({
      version: 2, token: TOKEN, capturedAt: now, authUid: 'uid-a',
    }));
    localStorage.setItem(PENDING_ADULT_INVITE_KEY, JSON.stringify({
      version: 2, token: TOKEN, capturedAt: now, authUid: 'uid-b',
    }));

    expect(() => bindPendingInviteToUid('uid-a')).toThrow('INVITE_ACCOUNT_MISMATCH');
    expect(JSON.parse(sessionStorage.getItem(PENDING_ADULT_INVITE_KEY)!)).toMatchObject({ authUid: 'uid-a' });
    expect(JSON.parse(localStorage.getItem(PENDING_ADULT_INVITE_KEY)!)).toMatchObject({ authUid: 'uid-b' });
  });

  it('rejects a bind when fresh session and local copies are different tokens bound to different accounts', () => {
    const now = Date.now();
    const sessionIntent = { version: 2, token: TOKEN, capturedAt: now, authUid: 'uid-a' };
    const localIntent = { version: 2, token: TOKEN_B, capturedAt: now, authUid: 'uid-b' };
    sessionStorage.setItem(PENDING_ADULT_INVITE_KEY, JSON.stringify(sessionIntent));
    localStorage.setItem(PENDING_ADULT_INVITE_KEY, JSON.stringify(localIntent));

    expect(() => bindPendingInviteToUid('uid-a')).toThrow('INVITE_ACCOUNT_MISMATCH');
    expect(JSON.parse(sessionStorage.getItem(PENDING_ADULT_INVITE_KEY)!)).toEqual(sessionIntent);
    expect(JSON.parse(localStorage.getItem(PENDING_ADULT_INVITE_KEY)!)).toEqual(localIntent);
  });

  it('preserves a bound local different-token invite when session is unbound', () => {
    const now = Date.now();
    const sessionIntent = { version: 2, token: TOKEN, capturedAt: now };
    const localIntent = { version: 2, token: TOKEN_B, capturedAt: now, authUid: 'uid-b' };
    sessionStorage.setItem(PENDING_ADULT_INVITE_KEY, JSON.stringify(sessionIntent));
    localStorage.setItem(PENDING_ADULT_INVITE_KEY, JSON.stringify(localIntent));

    expect(() => bindPendingInviteToUid('uid-a')).toThrow('INVITE_ACCOUNT_MISMATCH');
    expect(JSON.parse(sessionStorage.getItem(PENDING_ADULT_INVITE_KEY)!)).toEqual(sessionIntent);
    expect(JSON.parse(localStorage.getItem(PENDING_ADULT_INVITE_KEY)!)).toEqual(localIntent);
  });

  it('falls back to the local binding after session storage is lost', () => {
    const now = Date.now();
    capturePendingInvite(TOKEN, now);
    bindPendingInviteToUid('uid-a');
    sessionStorage.clear();

    expect(bindPendingInviteToUid('uid-a')).toEqual({
      version: 2, token: TOKEN, capturedAt: now, authUid: 'uid-a',
    });
    expect(() => bindPendingInviteToUid('uid-b')).toThrow('INVITE_ACCOUNT_MISMATCH');
  });

  it('rejects padded, incorrectly-sized, and non-canonical base64url tokens', () => {
    const nonCanonical = `${TOKEN.slice(0, -1)}d`;

    for (const token of [`${TOKEN}=`, 'AQ', nonCanonical]) {
      expect(() => capturePendingInvite(token, 1_000)).toThrow('INVALID_INVITATION_TOKEN');
    }
    expect(sessionStorage.getItem(PENDING_ADULT_INVITE_KEY)).toBeNull();
    expect(localStorage.getItem(PENDING_ADULT_INVITE_KEY)).toBeNull();
  });

  it('treats corrupt storage as untrusted and clears both stores', () => {
    sessionStorage.setItem(PENDING_ADULT_INVITE_KEY, '{not-json');
    localStorage.setItem(PENDING_ADULT_INVITE_KEY, JSON.stringify({
      version: 2, token: TOKEN, capturedAt: 1_000,
    }));

    expect(readPendingInvite(2_000)).toBeNull();
    expect(sessionStorage.getItem(PENDING_ADULT_INVITE_KEY)).toBeNull();
    expect(localStorage.getItem(PENDING_ADULT_INVITE_KEY)).toBeNull();
  });

  it('prefers a valid session intent over a valid local fallback', () => {
    sessionStorage.setItem(PENDING_ADULT_INVITE_KEY, JSON.stringify({
      version: 2, token: TOKEN, capturedAt: 1_000,
    }));
    localStorage.setItem(PENDING_ADULT_INVITE_KEY, JSON.stringify({
      version: 2, token: TOKEN_B, capturedAt: 1_001,
    }));

    expect(readPendingInvite(2_000)).toEqual({ version: 2, token: TOKEN, capturedAt: 1_000 });
  });

  it('binds the authenticated UID and mirrors the updated envelope', () => {
    const now = Date.now();
    capturePendingInvite(TOKEN, now);

    expect(bindPendingInviteToUid('uid-a')).toEqual({
      version: 2, token: TOKEN, capturedAt: now, authUid: 'uid-a',
    });
    expect(JSON.parse(sessionStorage.getItem(PENDING_ADULT_INVITE_KEY)!)).toEqual(
      JSON.parse(localStorage.getItem(PENDING_ADULT_INVITE_KEY)!),
    );
  });

  it('clears both stores for terminal outcomes without persisting the clear reason', () => {
    capturePendingInvite(TOKEN, 1_000);
    clearPendingInvite('declined');

    expect(sessionStorage.getItem(PENDING_ADULT_INVITE_KEY)).toBeNull();
    expect(localStorage.getItem(PENDING_ADULT_INVITE_KEY)).toBeNull();
  });

  it('clears only storage copies matching the completed token and account', () => {
    const now = Date.now();
    sessionStorage.setItem(PENDING_ADULT_INVITE_KEY, JSON.stringify({
      version: 2, token: TOKEN, capturedAt: now, authUid: 'uid-a',
    }));
    localStorage.setItem(PENDING_ADULT_INVITE_KEY, JSON.stringify({
      version: 2, token: TOKEN_B, capturedAt: now, authUid: 'uid-b',
    }));

    expect(clearPendingInviteIfMatches(
      { token: TOKEN, authUid: 'uid-a' },
      'joined',
    )).toBe(true);
    expect(sessionStorage.getItem(PENDING_ADULT_INVITE_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(PENDING_ADULT_INVITE_KEY)!)).toMatchObject({
      token: TOKEN_B,
      authUid: 'uid-b',
    });
    expect(clearPendingInviteIfMatches(
      { token: TOKEN, authUid: 'uid-a' },
      'joined',
    )).toBe(false);
  });

  it('treats a malformed matching-clear candidate as a safe no-op', () => {
    const now = Date.now();
    capturePendingInvite(TOKEN_B, now);

    expect(clearPendingInviteIfMatches({ token: 'not-a-token' }, 'invalid')).toBe(false);
    expect(readPendingInvite(now + 1)).toMatchObject({ token: TOKEN_B });
  });

  it('does not treat a future capture timestamp as fresh', () => {
    expect(isPendingInviteFresh({ version: 2, token: TOKEN, capturedAt: 2_001 }, 2_000)).toBe(false);
  });
});
