import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildInviteMessage,
  buildJoinUrl,
  clearPendingInvite,
  PENDING_INVITE_KEY,
  postAuthDestination,
  readCodeFromSearch,
  readPendingInvite,
  rememberPendingInvite,
} from './inviteLink';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('buildJoinUrl', () => {
  it('generates a code-specific join URL from the current origin', () => {
    expect(buildJoinUrl('7ZXWRZ', 'https://queki.app')).toBe('https://queki.app/join?code=7ZXWRZ');
  });

  it('uses the live origin rather than a hard-coded host', () => {
    // jsdom serves the app from localhost, production serves it from queki.app;
    // the helper must simply mirror whatever origin it is given.
    expect(buildJoinUrl('7ZXWRZ')).toBe(`${window.location.origin}/join?code=7ZXWRZ`);
    expect(buildJoinUrl('7ZXWRZ', 'https://preview--queki.web.app')).toBe(
      'https://preview--queki.web.app/join?code=7ZXWRZ',
    );
  });

  it('encodes codes containing URL-significant characters', () => {
    expect(buildJoinUrl('A B&C', 'https://queki.app')).toBe('https://queki.app/join?code=A%20B%26C');
  });

  it('returns an empty string when there is no code', () => {
    expect(buildJoinUrl('', 'https://queki.app')).toBe('');
    expect(buildJoinUrl('   ', 'https://queki.app')).toBe('');
  });
});

describe('readCodeFromSearch', () => {
  it('reads and upper-cases the code query parameter', () => {
    expect(readCodeFromSearch('?code=7zxwrz')).toBe('7ZXWRZ');
  });

  it('decodes percent-encoded codes', () => {
    expect(readCodeFromSearch('?code=7ZXWRZ&type=parent')).toBe('7ZXWRZ');
  });

  it('returns an empty string when absent', () => {
    expect(readCodeFromSearch('')).toBe('');
    expect(readCodeFromSearch('?other=1')).toBe('');
  });
});

describe('pending invite persistence', () => {
  it('preserves the code across an authentication round trip', () => {
    rememberPendingInvite('7zxwrz');
    expect(readPendingInvite()).toBe('7ZXWRZ');
  });

  it('survives a refresh that clears only session storage', () => {
    rememberPendingInvite('7ZXWRZ');
    sessionStorage.clear();
    expect(localStorage.getItem(PENDING_INVITE_KEY)).toBe('7ZXWRZ');
    expect(readPendingInvite()).toBe('7ZXWRZ');
  });

  it('clears the code once the flow is resumed', () => {
    rememberPendingInvite('7ZXWRZ');
    clearPendingInvite();
    expect(readPendingInvite()).toBe('');
  });

  it('ignores an empty code', () => {
    rememberPendingInvite('  ');
    expect(readPendingInvite()).toBe('');
  });
});

describe('postAuthDestination', () => {
  it('resumes the join flow after authentication', () => {
    rememberPendingInvite('7ZXWRZ');
    expect(postAuthDestination('/')).toBe('/join?code=7ZXWRZ');
  });

  it('falls back to the dashboard when no invite is pending', () => {
    expect(postAuthDestination('/')).toBe('/');
  });
});

describe('buildInviteMessage', () => {
  it('combines the invitation message with the URL for the clipboard fallback', () => {
    expect(buildInviteMessage('Join our family on Queki', 'https://queki.app/join?code=7ZXWRZ')).toBe(
      'Join our family on Queki\nhttps://queki.app/join?code=7ZXWRZ',
    );
  });
});
