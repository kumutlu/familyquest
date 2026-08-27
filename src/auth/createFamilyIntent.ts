export const CREATE_FAMILY_INTENT_KEY = 'queki.createFamilyIntent.v1';

const CREATE_FAMILY_INTENT_TTL_MS = 30 * 60 * 1000;
const listeners = new Set<() => void>();

export type CreateFamilyIntent = {
  version: 1;
  kind: 'create-family';
  authUid: string;
  createdAt: number;
};

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function validUid(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function validIntent(value: unknown): value is CreateFamilyIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (keys.length !== 4 || keys.some(key => !['version', 'kind', 'authUid', 'createdAt'].includes(key))) {
    return false;
  }
  return candidate.version === 1
    && candidate.kind === 'create-family'
    && validUid(candidate.authUid)
    && Number.isSafeInteger(candidate.createdAt)
    && (candidate.createdAt as number) >= 0;
}

function removeStoredIntent(): void {
  const storage = sessionStore();
  if (!storage) return;
  try {
    storage.removeItem(CREATE_FAMILY_INTENT_KEY);
  } catch {
    // Best-effort cleanup: blocked storage must never authorize creation.
  }
}

function notifySubscribers(): void {
  for (const listener of [...listeners]) listener();
}

/** Starts a tab-scoped family-creation journey for exactly one authenticated UID. */
export function startCreateFamilyIntent(uid: string, now = Date.now()): CreateFamilyIntent {
  if (!validUid(uid)) throw new Error('INVALID_CREATE_FAMILY_UID');
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('INVALID_CREATE_FAMILY_TIME');

  const intent: CreateFamilyIntent = {
    version: 1,
    kind: 'create-family',
    authUid: uid,
    createdAt: now,
  };
  const storage = sessionStore();
  if (storage) {
    try {
      storage.setItem(CREATE_FAMILY_INTENT_KEY, JSON.stringify(intent));
    } catch {
      // No in-memory fallback: if persistence is blocked, later reads fail closed.
    }
  }
  notifySubscribers();
  return intent;
}

/** Reads only a fresh exact envelope for the current account and self-heals all invalid state. */
export function readCreateFamilyIntent(uid: string, now = Date.now()): CreateFamilyIntent | null {
  if (!validUid(uid) || !Number.isSafeInteger(now) || now < 0) {
    removeStoredIntent();
    return null;
  }

  const storage = sessionStore();
  if (!storage) return null;

  let raw: string | null;
  try {
    raw = storage.getItem(CREATE_FAMILY_INTENT_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    removeStoredIntent();
    return null;
  }

  if (!validIntent(parsed)) {
    removeStoredIntent();
    return null;
  }

  const age = now - parsed.createdAt;
  if (parsed.authUid !== uid || age < 0 || age >= CREATE_FAMILY_INTENT_TTL_MS) {
    removeStoredIntent();
    return null;
  }
  return parsed;
}

export function clearCreateFamilyIntent(): void {
  removeStoredIntent();
  notifySubscribers();
}

/** Stable boolean snapshot for React's external-store contract. */
export function hasCreateFamilyIntent(uid: string, now = Date.now()): boolean {
  return readCreateFamilyIntent(uid, now) !== null;
}

/** Same-tab notifications only; session storage intentionally has no cross-tab lifecycle. */
export function subscribeCreateFamilyIntent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
