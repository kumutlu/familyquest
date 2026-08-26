import { beforeEach, describe, expect, it } from 'vitest';

import {
  bindPendingInviteToUid,
  capturePendingInvite,
  clearPendingInvite,
  isPendingInviteFresh,
  PENDING_ADULT_INVITE_KEY,
  readPendingInvite,
} from './pendingInviteIntent';

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN = 'CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws';

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

  it('clears stale intent from both stores after seven days', () => {
    capturePendingInvite(TOKEN, 1_000);

    expect(readPendingInvite(1_000 + 7 * DAY_MS + 1)).toBeNull();
    expect(sessionStorage.getItem(PENDING_ADULT_INVITE_KEY)).toBeNull();
    expect(localStorage.getItem(PENDING_ADULT_INVITE_KEY)).toBeNull();
  });

  it('does not silently rebind an invite to a different authenticated account', () => {
    capturePendingInvite(TOKEN, 1_000);
    bindPendingInviteToUid('uid-a');

    expect(() => bindPendingInviteToUid('uid-b')).toThrow('INVITE_ACCOUNT_MISMATCH');
    expect(readPendingInvite(2_000)?.authUid).toBe('uid-a');
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
    const localToken = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc';
    sessionStorage.setItem(PENDING_ADULT_INVITE_KEY, JSON.stringify({
      version: 2, token: TOKEN, capturedAt: 1_000,
    }));
    localStorage.setItem(PENDING_ADULT_INVITE_KEY, JSON.stringify({
      version: 2, token: localToken, capturedAt: 1_001,
    }));

    expect(readPendingInvite(2_000)).toEqual({ version: 2, token: TOKEN, capturedAt: 1_000 });
  });

  it('binds the authenticated UID and mirrors the updated envelope', () => {
    capturePendingInvite(TOKEN, 1_000);

    expect(bindPendingInviteToUid('uid-a')).toEqual({
      version: 2, token: TOKEN, capturedAt: 1_000, authUid: 'uid-a',
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

  it('does not treat a future capture timestamp as fresh', () => {
    expect(isPendingInviteFresh({ version: 2, token: TOKEN, capturedAt: 2_001 }, 2_000)).toBe(false);
  });
});
