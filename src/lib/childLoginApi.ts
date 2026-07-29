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
// The callable accepts `requirePasswordChange` and remains authoritative for
// validation, authorization, Auth provisioning, and Firestore linkage.
// ---------------------------------------------------------------------------

import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import i18n from '../i18n/config';

// --- Types (mirror of functions/src/childLogin.ts public contract) ---------

export interface CreateChildLoginInput {
  childId: string;
  username: string;
  password: string;
  clientReqId: string;
  /** Require the child to replace the initial password after first sign-in. */
  requirePasswordChange?: boolean;
}

export interface CreateChildLoginResult {
  childId: string;
  username: string;
  loginEnabled: boolean;
}

export interface ChildLoginLifecycleResult {
  childId: string;
  username?: string;
  loginEnabled: boolean;
  requiresPasswordChange?: boolean;
}

export interface DeleteChildInput {
  childId: string;
  displayNameConfirmation: string;
  clientReqId: string;
}

export interface DeleteChildResult {
  childId: string;
  deleted: boolean;
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

async function invokeLifecycle<TInput extends object, TResult>(
  name: string,
  input: TInput,
): Promise<TResult> {
  const callable = httpsCallable<TInput & { clientReqId: string }, TResult>(functions, name);
  const result = await callable({ ...input, clientReqId: generateClientReqId() });
  return result.data;
}

export const resetChildPassword = (childId: string, newPassword: string) =>
  invokeLifecycle<{ childId: string; newPassword: string }, ChildLoginLifecycleResult>(
    'resetChildPassword',
    { childId, newPassword },
  );

export const disableChildLogin = (childId: string) =>
  invokeLifecycle<{ childId: string }, ChildLoginLifecycleResult>('disableChildLogin', { childId });

export const enableChildLogin = (childId: string) =>
  invokeLifecycle<{ childId: string }, ChildLoginLifecycleResult>('enableChildLogin', { childId });

export const completeChildPasswordChange = (newPassword: string) =>
  invokeLifecycle<{ newPassword: string }, { success: boolean }>(
    'completeChildPasswordChange',
    { newPassword },
  );

export const deleteChild = (childId: string, displayNameConfirmation: string) =>
  invokeLifecycle<DeleteChildInput, DeleteChildResult>('deleteChild', {
    childId,
    displayNameConfirmation,
    clientReqId: generateClientReqId(),
  });

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
 * Map a backend HttpsError to a friendly, non-leaking message. We never reveal
 * whether a username exists *outside* the family; within-family collisions are
 * safe to surface. Backend error codes are carried in `error.message`.
 */
export function mapChildLoginError(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  const firebaseCode = (e?.code ?? '').replace(/^functions\//, '');
  const reason =
    typeof e?.message === 'string' && /^[A-Z][A-Z0-9_]+$/.test(e.message)
      ? e.message
      : '';
  const code = reason || firebaseCode;
  const range = { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH };
  const pw = { min: PASSWORD_MIN_LENGTH };
  const translated = (
    key: string,
    fallback: string,
    values?: Record<string, string | number>,
  ) => i18n.t(`errors:childLogin.${key}`, { ...values, defaultValue: fallback });
  switch (code) {
    case 'USERNAME_REQUIRED':
      return translated('usernameRequired', 'Please enter a username.');
    case 'USERNAME_LENGTH':
      return translated(
        'usernameLength',
        `Username must be ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters.`,
        range,
      );
    case 'USERNAME_CHARS':
      return translated(
        'usernameChars',
        'Username can only use letters, numbers, spaces, and underscores.',
      );
    case 'PASSWORD_REQUIRED':
      return translated('passwordRequired', 'Please enter a password.');
    case 'PASSWORD_TOO_SHORT':
      return translated(
        'passwordTooShort',
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
        pw,
      );
    case 'PASSWORD_TOO_LONG':
      return translated('passwordTooLong', 'Password is too long.');
    case 'PASSWORD_NEEDS_LETTER':
      return translated('passwordNeedsLetter', 'Password must include at least one letter.');
    case 'PASSWORD_NEEDS_DIGIT':
      return translated('passwordNeedsDigit', 'Password must include at least one number.');
    case 'PASSWORD_SAME_AS_USERNAME':
      return translated('passwordSameAsUsername', 'Password cannot match the username.');
    case 'USERNAME_TAKEN':
      return translated('usernameTaken', 'That username is already taken in this family.');
    case 'LOGIN_ALREADY_EXISTS':
      return translated('loginAlreadyExists', 'This child already has a login.');
    case 'CHILD_NOT_FOUND':
      return translated('childNotFound', 'Child not found.');
    case 'CHILD_NOT_MANAGED':
      return translated('childNotManaged', 'This child is not managed by the family.');
    case 'CHILD_NOT_IN_FAMILY':
      return translated('childNotInFamily', 'This child is not in your family.');
    case 'NOT_AUTHORIZED':
    case 'permission-denied':
      return translated('notAuthorized', 'You do not have permission to do this.');
    case 'UNEXPECTED_FIELD':
      return translated('unexpectedField', 'Unexpected field sent to the server.');
    case 'CLIENT_REQ_ID_REPLAY_MISMATCH':
      return translated(
        'requestReplay',
        'This request was already used with different details.',
      );
    case 'AUTH_CREATE_FAILED':
    case 'CLAIMS_FAILED':
    case 'internal':
    case 'not-found':
      return translated('createFailed', 'We could not create the login. Please try again.');
    case 'unauthenticated':
      return translated('unauthenticated', 'You must be signed in to do this.');
    case 'failed-precondition':
      return translated('failedPrecondition', 'This child is not managed by the family.');
    case 'already-exists':
      return translated('alreadyExists', 'A login already exists for this child.');
    default:
      return translated('default', 'Could not create the login. Please try again.');
  }
}

/** Safe diagnostics only: never includes request input or password material. */
export function childLoginErrorDiagnostic(err: unknown): {
  code: string;
  message: string;
} {
  const e = err as { code?: unknown; message?: unknown } | null;
  return {
    code: typeof e?.code === 'string' ? e.code : 'unknown',
    message: typeof e?.message === 'string' ? e.message : 'Unknown callable error',
  };
}
