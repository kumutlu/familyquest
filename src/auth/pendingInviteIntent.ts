/** The versioned key for the untrusted, client-side adult invite resume intent. */
export const PENDING_ADULT_INVITE_KEY = 'queki.pendingAdultInvite.v2';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type PendingInviteIntent = {
  version: 2;
  token: string;
  capturedAt: number;
  authUid?: string;
};

/** Terminal, non-sensitive reasons an invite journey can discard its local intent. */
export type PendingInviteClearReason =
  | 'joined'
  | 'already-member'
  | 'declined'
  | 'left'
  | 'invalid'
  | 'expired'
  | 'revoked'
  | 'used'
  | 'stale'
  | 'account-mismatch';

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function localStore(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function stores(): Storage[] {
  const session = sessionStore();
  const local = localStore();
  return [session, local].filter((store): store is Storage => store !== null && store !== undefined)
    .filter((store, index, values) => values.indexOf(store) === index);
}

function readStorage(storage: Storage | null): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(PENDING_ADULT_INVITE_KEY);
  } catch {
    return null;
  }
}

function isCanonicalInvitationToken(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;

  try {
    const decoded = atob(`${value.replace(/-/g, '+').replace(/_/g, '/')}=`);
    return decoded.length === 32
      && btoa(decoded).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === value;
  } catch {
    return false;
  }
}

function isValidAuthUid(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function isPendingInviteIntent(value: unknown): value is PendingInviteIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const intent = value as Record<string, unknown>;
  const allowedKeys = ['version', 'token', 'capturedAt', 'authUid'];
  if (Object.keys(intent).some(key => !allowedKeys.includes(key))) return false;

  return intent.version === 2
    && isCanonicalInvitationToken(intent.token)
    && Number.isSafeInteger(intent.capturedAt)
    && (intent.capturedAt as number) >= 0
    && (intent.authUid === undefined || isValidAuthUid(intent.authUid));
}

function parseIntent(raw: string | null): PendingInviteIntent | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPendingInviteIntent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeIntent(intent: PendingInviteIntent): void {
  const serialised = JSON.stringify(intent);
  for (const storage of stores()) {
    try {
      storage.setItem(PENDING_ADULT_INVITE_KEY, serialised);
    } catch {
      // Storage can be blocked or unavailable in privacy modes; the route remains authoritative.
    }
  }
}

export function isPendingInviteFresh(intent: PendingInviteIntent, now = Date.now()): boolean {
  return isPendingInviteIntent(intent)
    && Number.isSafeInteger(now)
    && now >= intent.capturedAt
    && now - intent.capturedAt < INVITATION_TTL_MS;
}

/** Captures the route token as minimal, untrusted resume state for auth redirects/reloads. */
export function capturePendingInvite(token: string, now = Date.now()): PendingInviteIntent {
  if (!isCanonicalInvitationToken(token)) throw new Error('INVALID_INVITATION_TOKEN');
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('INVALID_INVITATION_CAPTURE_TIME');

  const intent: PendingInviteIntent = { version: 2, token, capturedAt: now };
  writeIntent(intent);
  return intent;
}

type StoredIntentCopies = {
  session: PendingInviteIntent | null;
  local: PendingInviteIntent | null;
};

function readValidatedStoredIntents(now: number): StoredIntentCopies {
  const sessionRaw = readStorage(sessionStore());
  const localRaw = readStorage(localStore());
  const sessionIntent = parseIntent(sessionRaw);
  const localIntent = parseIntent(localRaw);

  if ((sessionRaw !== null && !sessionIntent) || (localRaw !== null && !localIntent)) {
    clearPendingInvite('stale');
    return { session: null, local: null };
  }

  if ((sessionIntent && !isPendingInviteFresh(sessionIntent, now))
    || (localIntent && !isPendingInviteFresh(localIntent, now))) {
    clearPendingInvite('stale');
    return { session: null, local: null };
  }

  return { session: sessionIntent, local: localIntent };
}

/**
 * Reconciles the tab-scoped and reload-scoped copies without allowing a
 * hidden same-token UID binding to be discarded by session precedence.
 */
function reconcileStoredIntents(copies: StoredIntentCopies): PendingInviteIntent | null {
  const selected = copies.session ?? copies.local;
  if (!selected) return null;

  const sameToken = [copies.session, copies.local]
    .filter((intent): intent is PendingInviteIntent => intent !== null && intent.token === selected.token);
  const boundUids = [...new Set(
    sameToken
      .map(intent => intent.authUid)
      .filter((authUid): authUid is string => authUid !== undefined),
  )];

  if (boundUids.length === 1 && selected.authUid === undefined) {
    return { ...selected, authUid: boundUids[0] };
  }

  return selected;
}

/** Reads the freshest valid intent, preferring the tab-scoped session copy. */
export function readPendingInvite(now = Date.now()): PendingInviteIntent | null {
  return reconcileStoredIntents(readValidatedStoredIntents(now));
}

/** Binds a captured intent to its authenticated account without allowing a silent account switch. */
export function bindPendingInviteToUid(uid: string): PendingInviteIntent | null {
  if (!isValidAuthUid(uid)) throw new Error('INVALID_AUTH_UID');

  const copies = readValidatedStoredIntents(Date.now());
  const intent = reconcileStoredIntents(copies);
  if (!intent) return null;

  const storedBindings = [copies.session, copies.local]
    .filter((copy): copy is PendingInviteIntent => copy !== null)
    .map(copy => copy.authUid)
    .filter((authUid): authUid is string => authUid !== undefined);
  if (storedBindings.some(authUid => authUid !== uid)) {
    throw new Error('INVITE_ACCOUNT_MISMATCH');
  }

  const boundIntent: PendingInviteIntent = { ...intent, authUid: uid };
  writeIntent(boundIntent);
  return boundIntent;
}

/** Removes resume intent after a terminal journey outcome; reasons are intentionally not persisted. */
export function clearPendingInvite(reason: PendingInviteClearReason): void {
  void reason;
  for (const storage of stores()) {
    try {
      storage.removeItem(PENDING_ADULT_INVITE_KEY);
    } catch {
      // Best-effort cleanup is safe when browser storage is blocked.
    }
  }
}
