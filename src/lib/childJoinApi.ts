// ---------------------------------------------------------------------------
// FAMILYQUEST — CHILD JOIN REQUEST (frontend API client)
// ---------------------------------------------------------------------------
//
// Thin client wrapper around the trusted callables in
// functions/src/childJoinRequest.ts. The backend is the single source of truth
// for validation, family resolution, username reservation and identity
// creation.
//
// PASSWORD HANDLING: the plaintext password is passed straight to the callable
// and is never stored, cached, logged or included in any error payload by this
// module. Only the opaque requestId + one-time requestSecret are persisted, in
// sessionStorage, so the child can poll status after a refresh.
// ---------------------------------------------------------------------------

import { httpsCallable, type Functions } from 'firebase/functions';
import { functions } from './firebase';

export type ChildJoinRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export interface SubmitChildJoinRequestParams {
  familyCode: string;
  username: string;
  password: string;
}

export interface SubmitChildJoinRequestResult {
  requestId: string;
  requestSecret: string;
  username: string;
  status: 'pending';
  expiresAt: number;
}

export interface ChildJoinStatusResult {
  requestId: string;
  username: string;
  status: ChildJoinRequestStatus;
  expiresAt: number;
}

/** Handle the child keeps locally so they can poll their own request. */
export interface ChildJoinRequestHandle {
  requestId: string;
  requestSecret: string;
  username: string;
}

const STORAGE_KEY = 'queki.childJoinRequest';

// --- Local handle persistence ----------------------------------------------
// Only the opaque identifiers live here. Never the password, never the family
// code, never the familyId.

export function storeJoinRequestHandle(handle: ChildJoinRequestHandle): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(handle));
  } catch {
    /* private mode / storage disabled — polling simply won't survive a reload */
  }
}

export function readJoinRequestHandle(): ChildJoinRequestHandle | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChildJoinRequestHandle>;
    if (typeof parsed?.requestId !== 'string' || typeof parsed?.requestSecret !== 'string') {
      return null;
    }
    return {
      requestId: parsed.requestId,
      requestSecret: parsed.requestSecret,
      username: typeof parsed.username === 'string' ? parsed.username : '',
    };
  } catch {
    return null;
  }
}

export function clearJoinRequestHandle(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// --- Callables ---------------------------------------------------------------

function callable<TIn, TOut>(name: string, instance: Functions = functions) {
  return httpsCallable<TIn, TOut>(instance, name);
}

export async function submitChildJoinRequest(
  params: SubmitChildJoinRequestParams,
): Promise<SubmitChildJoinRequestResult> {
  const result = await callable<SubmitChildJoinRequestParams, SubmitChildJoinRequestResult>(
    'submitChildJoinRequest',
  )({
    familyCode: params.familyCode,
    username: params.username,
    password: params.password,
  });
  return result.data;
}

export async function getChildJoinRequestStatus(
  handle: Pick<ChildJoinRequestHandle, 'requestId' | 'requestSecret'>,
): Promise<ChildJoinStatusResult> {
  const result = await callable<typeof handle, ChildJoinStatusResult>(
    'getChildJoinRequestStatus',
  )(handle);
  return result.data;
}

export async function cancelChildJoinRequest(
  handle: Pick<ChildJoinRequestHandle, 'requestId' | 'requestSecret'>,
): Promise<{ requestId: string; status: ChildJoinRequestStatus }> {
  const result = await callable<typeof handle, { requestId: string; status: ChildJoinRequestStatus }>(
    'cancelChildJoinRequest',
  )(handle);
  return result.data;
}

export async function approveChildJoinRequest(
  familyId: string,
  requestId: string,
): Promise<{ requestId: string; childId: string; status: 'approved' }> {
  const result = await callable<
    { familyId: string; requestId: string },
    { requestId: string; childId: string; status: 'approved' }
  >('approveChildJoinRequest')({ familyId, requestId });
  return result.data;
}

export async function rejectChildJoinRequest(
  familyId: string,
  requestId: string,
): Promise<{ requestId: string; status: 'rejected' }> {
  const result = await callable<
    { familyId: string; requestId: string },
    { requestId: string; status: 'rejected' }
  >('rejectChildJoinRequest')({ familyId, requestId });
  return result.data;
}

// --- Error mapping ------------------------------------------------------------

/** The closed set of child-friendly error keys this module can produce. */
export type ChildJoinErrorKey =
  | 'auth:childJoin.errors.invalidRequest'
  | 'auth:childJoin.errors.usernameTaken'
  | 'auth:childJoin.errors.duplicateRequest'
  | 'auth:childJoin.errors.rateLimited'
  | 'auth:childJoin.errors.network'
  | 'auth:childJoin.errors.notFound'
  | 'auth:childJoin.errors.generic';

/**
 * Maps a backend error to a child-friendly i18n key under `auth:childJoin.errors`.
 * Every family-resolution failure collapses to the same generic key so the UI
 * cannot be used to probe whether a Family Code or username exists.
 */
export function mapChildJoinErrorKey(error: unknown): ChildJoinErrorKey {
  const raw = error as { code?: unknown; message?: unknown } | undefined;
  const code = typeof raw?.code === 'string' ? raw.code : '';
  const message = typeof raw?.message === 'string' ? raw.message : '';
  const reason = message.replace(/^.*?:\s*/, '').trim();

  if (code === 'functions/unavailable' || code === 'functions/deadline-exceeded') {
    return 'auth:childJoin.errors.network';
  }
  if (reason === 'TOO_MANY_JOIN_REQUESTS' || code === 'functions/resource-exhausted') {
    return 'auth:childJoin.errors.rateLimited';
  }
  if (reason === 'USERNAME_TAKEN') return 'auth:childJoin.errors.usernameTaken';
  if (reason === 'REQUEST_ALREADY_PENDING') return 'auth:childJoin.errors.duplicateRequest';
  if (reason === 'JOIN_REQUEST_NOT_FOUND') return 'auth:childJoin.errors.notFound';
  if (
    reason === 'JOIN_REQUEST_FAILED' ||
    reason.startsWith('USERNAME_') ||
    reason.startsWith('PASSWORD_')
  ) {
    return 'auth:childJoin.errors.invalidRequest';
  }
  return 'auth:childJoin.errors.generic';
}
