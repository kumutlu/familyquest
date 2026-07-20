// ---------------------------------------------------------------------------
// FAMILYQUEST — PARENT-CREATED CHILD LOGIN (Phase 2, frontend API client)
// ---------------------------------------------------------------------------
//
// Thin client wrapper around the Phase 1 backend callable `createChildLogin`.
// The backend remains the single source of truth for all validation; the
// helpers here only provide immediate, friendly client-side feedback and a
// stable, friendly error mapping. No passwords are ever persisted, logged, or
// cached by this module.
//
// NOTE: The Phase 1 callable does not yet accept `requirePasswordChange`. The
// field is forwarded when present so the UI matches the product spec and stays
// forward-compatible; the backend currently ignores it. We do NOT invent a new
// callable or change the backend contract.
// ---------------------------------------------------------------------------

import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

// --- Types (mirror of functions/src/childLogin.ts public contract) ---------

export interface CreateChildLoginInput {
  childId: string;
  username: string;
  password: string;
  clientReqId: string;
  /** Forwarded for forward-compatibility; ignored by the Phase 1 backend. */
  requirePasswordChange?: boolean;
}

export interface CreateChildLoginResult {
  childId: string;
  username: string;
  loginEnabled: boolean;
}

// --- Policy constants (kept in sync with the backend; backend is authoritative)
// ---

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const PASSWORD_MIN_LENGTH = 8;

// --- Pure client-side helpers (mirror backend normalization for live preview)
// ---

/**
 * Client-side mirror of the backend username normalization used purely for the
 * live "will be saved as" preview. The backend remains the source of truth.
 */
export function normalizeUsernamePreview(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Returns a friendly error string, or null when valid. */
export function validateUsernameClient(raw: string): string | null {
  const normalized = normalizeUsernamePreview(raw);
  if (!raw.trim()) return 'Please enter a username.';
  if (normalized.length < USERNAME_MIN_LENGTH || normalized.length > USERNAME_MAX_LENGTH) {
    return `Username must be ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters.`;
  }
  if (!/^[a-z0-9_ ]+$/.test(normalized)) {
    return 'Username can only use letters, numbers, spaces, and underscores.';
  }
  return null;
}

/** Returns a friendly error string, or null when valid. */
export function validatePasswordClient(password: string): string | null {
  if (!password) return 'Please enter a password.';
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/[a-zA-Z]/.test(password)) return 'Password must include at least one letter.';
  if (!/\d/.test(password)) return 'Password must include at least one number.';
  return null;
}

// --- Callable wrapper -------------------------------------------------------

function generateClientReqId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Invoke the existing `createChildLogin` callable. Passwords are passed only
 * for the duration of this network call and are never stored.
 */
export async function createChildLogin(params: {
  childId: string;
  username: string;
  password: string;
  requirePasswordChange?: boolean;
}): Promise<CreateChildLoginResult> {
  const callable = httpsCallable<CreateChildLoginInput, CreateChildLoginResult>(
    functions,
    'createChildLogin',
  );
  const result = await callable({
    childId: params.childId,
    username: params.username,
    password: params.password,
    clientReqId: generateClientReqId(),
    ...(params.requirePasswordChange ? { requirePasswordChange: true } : {}),
  });
  return result.data;
}

// --- Sign-in (Phase 3) ------------------------------------------------------

export interface SignInChildInput {
  familyCode: string;
  username: string;
  password: string;
}

export interface SignInChildResult {
  customToken: string;
}

/**
 * Invoke the existing `signInChild` callable. The backend resolves the private
 * synthetic email server-side and returns ONLY a Firebase custom token. The
 * frontend never sees, constructs, or infers any email address.
 *
 * Inputs are trimmed/normalized to match the backend's normalization so the
 * child does not have to type the username in an exact case/spacing. The
 * password is passed verbatim: the backend does NOT trim passwords, so trimming
 * here would risk a silent mismatch and could alter a secret.
 */
export async function signInChild(params: SignInChildInput): Promise<SignInChildResult> {
  const callable = httpsCallable<SignInChildInput, SignInChildResult>(
    functions,
    'signInChild',
  );
  const result = await callable({
    familyCode: params.familyCode.trim(),
    username: normalizeUsernamePreview(params.username),
    password: params.password,
  });
  return result.data;
}

/**
 * Map ANY signInChild failure to a single, generic, friendly message. The
 * backend already returns a generic failure for every error class; this guard
 * ensures the client never leaks whether the family, username, or password was
 * the problem. No raw error codes or server messages are ever surfaced.
 */
export function mapSignInChildError(_err: unknown): string {
  return 'We could not sign you in. Please check your Family Code, username, and password, then try again.';
}

// --- Friendly error mapping -------------------------------------------------

/**
 * Map a backend HttpsError to a friendly, non-leaky message. We never reveal
 * whether a username exists *outside* the family; within-family collisions are
 * safe to surface. Backend error codes are carried in `error.message`.
 */
export function mapChildLoginError(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  const code = e?.message ?? e?.code ?? '';
  switch (code) {
    case 'USERNAME_REQUIRED':
      return 'Please enter a username.';
    case 'USERNAME_LENGTH':
      return `Username must be ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters.`;
    case 'USERNAME_CHARS':
      return 'Username can only use letters, numbers, spaces, and underscores.';
    case 'PASSWORD_REQUIRED':
      return 'Please enter a password.';
    case 'PASSWORD_TOO_SHORT':
      return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    case 'PASSWORD_TOO_LONG':
      return 'Password is too long.';
    case 'PASSWORD_NEEDS_LETTER':
      return 'Password must include at least one letter.';
    case 'PASSWORD_NEEDS_DIGIT':
      return 'Password must include at least one number.';
    case 'PASSWORD_SAME_AS_USERNAME':
      return 'Password cannot match the username.';
    case 'USERNAME_TAKEN':
      return 'That username is already taken in this family.';
    case 'LOGIN_ALREADY_EXISTS':
      return 'This child already has a login.';
    case 'CHILD_NOT_FOUND':
      return 'Child not found.';
    case 'CHILD_NOT_MANAGED':
      return 'This child is not managed by the family.';
    case 'CHILD_NOT_IN_FAMILY':
      return 'This child is not in your family.';
    case 'NOT_AUTHORIZED':
    case 'permission-denied':
      return 'You do not have permission to do this.';
    case 'UNEXPECTED_FIELD':
      return 'Unexpected field sent to the server.';
    case 'CLIENT_REQ_ID_REPLAY_MISMATCH':
      return 'This request was already used with different details.';
    case 'AUTH_CREATE_FAILED':
    case 'CLAIMS_FAILED':
    case 'internal':
      return 'We could not create the login. Please try again.';
    case 'unauthenticated':
      return 'You must be signed in to do this.';
    case 'not-found':
      return 'Child not found.';
    case 'failed-precondition':
      return 'This child is not managed by the family.';
    case 'already-exists':
      return 'A login already exists for this child.';
    default:
      return 'Could not create the login. Please try again.';
  }
}
