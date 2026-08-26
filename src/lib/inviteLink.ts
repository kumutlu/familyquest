// ---------------------------------------------------------------------------
// INVITE LINK HELPERS
// ---------------------------------------------------------------------------
//
// Pure helpers shared by the Invite Member share action and the /join route.
// Deliberately free of React and Firebase so they are trivially testable.
// ---------------------------------------------------------------------------

/** Storage key holding the invite code across an authentication round trip. */
export const PENDING_INVITE_KEY = 'queki.pendingInviteCode';

/** Path of the code-specific join route. */
export const JOIN_PATH = '/join';

const RESUMABLE_LEGACY_INVITE_CODE = /^[A-Z0-9]{6}$/;

function normaliseResumableLegacyCode(value: string): string {
  const code = value.trim().toUpperCase();
  return RESUMABLE_LEGACY_INVITE_CODE.test(code) ? code : '';
}

/**
 * Builds the shareable, code-specific join URL.
 *
 * The current origin is always used so development, preview and production
 * builds each produce a link that works where it was generated.
 */
export function buildJoinUrl(
  inviteCode: string,
  origin: string = typeof window !== 'undefined' ? window.location.origin : '',
): string {
  const code = inviteCode.trim();
  if (!code) return '';
  return `${origin}${JOIN_PATH}?code=${encodeURIComponent(code)}`;
}

/** Reads and normalises the `code` query parameter of a join URL. */
export function readCodeFromSearch(search: string): string {
  const value = new URLSearchParams(search).get('code');
  return value ? value.trim().toUpperCase() : '';
}

function storages(): Storage[] {
  const found: Storage[] = [];
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage) found.push(sessionStorage);
  } catch { /* storage blocked */ }
  try {
    if (typeof localStorage !== 'undefined' && localStorage) found.push(localStorage);
  } catch { /* storage blocked */ }
  return found;
}

/**
 * Persists the invite code so it survives sign-up, sign-in, provider
 * redirects, refreshes and browser-back navigation. Written to both session
 * and local storage: session storage keeps it tab-scoped, local storage
 * survives the full-page reloads some auth providers perform.
 */
export function rememberPendingInvite(code: string): void {
  const value = normaliseResumableLegacyCode(code);
  if (!value) {
    if (code.trim()) clearPendingInvite();
    return;
  }
  for (const storage of storages()) {
    try { storage.setItem(PENDING_INVITE_KEY, value); } catch { /* quota / privacy mode */ }
  }
}

/** Returns the invite code preserved across authentication, if any. */
export function readPendingInvite(): string {
  let selected = '';
  for (const storage of storages()) {
    try {
      const raw = storage.getItem(PENDING_INVITE_KEY);
      if (raw === null) continue;
      const value = normaliseResumableLegacyCode(raw);
      if (!value) {
        clearPendingInvite();
        return '';
      }
      if (!selected) selected = value;
    } catch { /* storage blocked */ }
  }
  return selected;
}

/** Clears the preserved invite code once the flow has been resumed. */
export function clearPendingInvite(): void {
  for (const storage of storages()) {
    try { storage.removeItem(PENDING_INVITE_KEY); } catch { /* storage blocked */ }
  }
}

/** Translation keys the join route can surface. */
export type InvitationErrorKey =
  | 'family:join.expired'
  | 'family:join.used'
  | 'family:join.revoked'
  | 'family:join.alreadyInThisFamily'
  | 'family:join.alreadyInFamily'
  | 'family:join.invalid'
  | 'family:join.missingCode'
  | 'family:join.genericError';

/** Maps a callable error onto a translation key without leaking server text. */
export function mapInvitationErrorKey(error: unknown): InvitationErrorKey {
  const message = (error as { message?: string })?.message ?? '';
  if (message.includes('INVITATION_EXPIRED')) return 'family:join.expired';
  if (message.includes('INVITATION_ALREADY_USED')) return 'family:join.used';
  if (message.includes('INVITATION_REVOKED')) return 'family:join.revoked';
  if (message.includes('ALREADY_IN_THIS_FAMILY')) return 'family:join.alreadyInThisFamily';
  if (message.includes('ALREADY_IN_FAMILY')) return 'family:join.alreadyInFamily';
  if (message.includes('INVALID_INVITATION')) return 'family:join.invalid';
  return 'family:join.genericError';
}

/**
 * Destination to navigate to once authentication completes. When an invite was
 * preserved before sign-in or sign-up, the join flow resumes automatically.
 */
export function postAuthDestination(fallback = '/'): string {
  const code = readPendingInvite();
  return code ? `${JOIN_PATH}?code=${encodeURIComponent(code)}` : fallback;
}

/** Builds the invitation message used for the clipboard fallback. */
export function buildInviteMessage(intro: string, url: string): string {
  return `${intro}\n${url}`;
}
