// ---------------------------------------------------------------------------
// FAMILY DELETION / DEPARTURE — client API
// ---------------------------------------------------------------------------
// Thin wrappers around the server-authoritative callables. The client never
// deletes family data directly: it only requests deletion (with the exact
// case-sensitive family-name confirmation), polls sanitized status, or asks
// to leave. All authorization is enforced server-side.
// ---------------------------------------------------------------------------

import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export type FamilyDeletionState = 'queued' | 'running' | 'retry_wait' | 'failed' | 'completed' | 'none';

export interface DeleteFamilyResult {
  familyId: string;
  state: FamilyDeletionState;
  phase: string;
}

export interface FamilyDeletionStatus {
  familyId: string;
  state: FamilyDeletionState;
  phase?: string;
  lastErrorCode?: string | null;
}

export function generateClientReqId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `req${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export async function requestFamilyDeletion(params: {
  familyId: string;
  familyNameConfirmation: string;
  clientReqId: string;
}): Promise<DeleteFamilyResult> {
  const callable = httpsCallable<typeof params, DeleteFamilyResult>(functions, 'deleteFamily');
  const result = await callable(params);
  return result.data;
}

export async function fetchFamilyDeletionStatus(familyId: string): Promise<FamilyDeletionStatus> {
  const callable = httpsCallable<{ familyId: string }, FamilyDeletionStatus>(
    functions,
    'getFamilyDeletionStatus',
  );
  const result = await callable({ familyId });
  return result.data;
}

export async function leaveFamily(familyId: string): Promise<{ left: boolean }> {
  const callable = httpsCallable<{ familyId: string }, { left: boolean }>(functions, 'leaveFamily');
  const result = await callable({ familyId });
  return result.data;
}
