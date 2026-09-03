// ---------------------------------------------------------------------------
// FAMILYQUEST — CHILD QR ONBOARDING (frontend API client)
// ---------------------------------------------------------------------------
// Thin client wrapper around the trusted callables in
// functions/src/childQrOnboarding.ts.
// ---------------------------------------------------------------------------

import { httpsCallable, type Functions } from 'firebase/functions';
import { functions } from './firebase';

export type ChildQrRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'revoked';

export interface ChildQrRequestHandle {
  requestId: string;
  requestSecret: string;
}

const STORAGE_KEY = 'queki.childQrJoinRequest';

// --- Local handle persistence ----------------------------------------------

export function storeQrJoinRequestHandle(handle: ChildQrRequestHandle): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(handle));
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(handle));
  } catch {
    /* private mode / storage disabled */
  }
}

export function readQrJoinRequestHandle(): ChildQrRequestHandle | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChildQrRequestHandle>;
    if (typeof parsed?.requestId !== 'string' || typeof parsed?.requestSecret !== 'string') {
      return null;
    }
    return {
      requestId: parsed.requestId,
      requestSecret: parsed.requestSecret,
    };
  } catch {
    return null;
  }
}

export function clearQrJoinRequestHandle(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// --- Callables ---------------------------------------------------------------

function callable<TIn, TOut>(name: string, instance: Functions = functions) {
  return httpsCallable<TIn, TOut>(instance, name);
}

export async function generateChildQrToken(): Promise<{ rawToken: string; expiresAtMs: number }> {
  const result = await callable<void, { rawToken: string; expiresAtMs: number }>('generateChildQrToken')();
  return result.data;
}

export async function scanChildQrToken(token: string): Promise<{ valid: true; expiresAtMs: number }> {
  const result = await callable<{ token: string }, { valid: true; expiresAtMs: number }>('scanChildQrToken')({ token });
  return result.data;
}

export async function submitChildQrJoinRequest(
  token: string,
  requesterDisplayName: string,
  requesterDeviceLabel?: string,
  clientReqId?: string,
): Promise<{ requestId: string; requestSecret: string; status: 'pending'; expiresAtMs: number }> {
  const result = await callable<
    { token: string; requesterDisplayName: string; requesterDeviceLabel?: string; clientReqId?: string },
    { requestId: string; requestSecret: string; status: 'pending'; expiresAtMs: number }
  >('submitChildQrJoinRequest')({ token, requesterDisplayName, requesterDeviceLabel, clientReqId });
  return result.data;
}

export async function getChildQrJoinStatus(
  handle: ChildQrRequestHandle,
): Promise<{ requestId: string; status: ChildQrRequestStatus; expiresAtMs: number }> {
  const result = await callable<
    ChildQrRequestHandle,
    { requestId: string; status: ChildQrRequestStatus; expiresAtMs: number }
  >('getChildQrJoinStatus')(handle);
  return result.data;
}

export async function approveChildQrJoinRequest(
  familyId: string,
  requestId: string,
  selectedManagedChildId: string,
  clientReqId?: string,
): Promise<{ requestId: string; selectedManagedChildId: string; status: 'approved' }> {
  const result = await callable<
    { familyId: string; requestId: string; selectedManagedChildId: string; clientReqId?: string },
    { requestId: string; selectedManagedChildId: string; status: 'approved' }
  >('approveChildQrJoinRequest')({ familyId, requestId, selectedManagedChildId, clientReqId });
  return result.data;
}

export async function rejectChildQrJoinRequest(
  familyId: string,
  requestId: string,
  rejectionReason?: string,
  clientReqId?: string,
): Promise<{ requestId: string; status: 'rejected' }> {
  const result = await callable<
    { familyId: string; requestId: string; rejectionReason?: string; clientReqId?: string },
    { requestId: string; status: 'rejected' }
  >('rejectChildQrJoinRequest')({ familyId, requestId, rejectionReason, clientReqId });
  return result.data;
}

export async function exchangeApprovedChildQrRequest(
  handle: ChildQrRequestHandle,
): Promise<{ customToken: string; childId: string }> {
  const result = await callable<
    ChildQrRequestHandle,
    { customToken: string; childId: string }
  >('exchangeApprovedChildQrRequest')(handle);
  return result.data;
}

// --- Error mapping ------------------------------------------------------------

export type ChildQrErrorKey =
  | 'auth:childQr.errors.expired'
  | 'auth:childQr.errors.revoked'
  | 'auth:childQr.errors.alreadyUsed'
  | 'auth:childQr.errors.invalidToken'
  | 'auth:childQr.errors.notFound'
  | 'auth:childQr.errors.nameRequired'
  | 'auth:childQr.errors.nameTooLong'
  | 'auth:childQr.errors.network'
  | 'auth:childQr.errors.generic';

export function mapChildQrErrorKey(error: unknown): ChildQrErrorKey {
  const raw = error as { code?: unknown; message?: unknown } | undefined;
  const code = typeof raw?.code === 'string' ? raw.code : '';
  const message = typeof raw?.message === 'string' ? raw.message : '';
  const reason = message.replace(/^.*?:\s*/, '').trim();

  if (code === 'functions/unavailable' || code === 'functions/deadline-exceeded') {
    return 'auth:childQr.errors.network';
  }
  if (reason === 'QR_EXPIRED') return 'auth:childQr.errors.expired';
  if (reason === 'QR_REVOKED') return 'auth:childQr.errors.revoked';
  if (reason === 'QR_ALREADY_USED') return 'auth:childQr.errors.alreadyUsed';
  if (reason === 'INVALID_QR_TOKEN') return 'auth:childQr.errors.invalidToken';
  if (reason === 'JOIN_REQUEST_NOT_FOUND') return 'auth:childQr.errors.notFound';
  if (reason === 'REQUESTER_NAME_REQUIRED') return 'auth:childQr.errors.nameRequired';
  if (reason === 'REQUESTER_NAME_TOO_LONG') return 'auth:childQr.errors.nameTooLong';

  return 'auth:childQr.errors.generic';
}
