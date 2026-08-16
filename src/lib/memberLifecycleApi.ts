// ---------------------------------------------------------------------------
// MEMBER LIFECYCLE — client API
// ---------------------------------------------------------------------------
// Thin wrappers around the server-authoritative lifecycle callables. The
// client only invokes these; all authorization is enforced server-side.
// ---------------------------------------------------------------------------

import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export interface LifecycleTargetInput {
  targetUid: string;
  clientReqId: string;
}

export interface ChangeRoleInput {
  targetUid: string;
  newRole: 'adult' | 'parent';
  clientReqId: string;
}

export interface TransferOwnershipInput {
  targetUid: string;
  clientReqId: string;
}

export async function archiveMember(targetUid: string, clientReqId: string): Promise<{ targetUid: string; lifecycle: string }> {
  const callable = httpsCallable<LifecycleTargetInput, { targetUid: string; lifecycle: string }>(
    functions,
    'archiveMember',
  );
  const result = await callable({ targetUid, clientReqId });
  return result.data;
}

export async function restoreMember(targetUid: string, clientReqId: string): Promise<{ targetUid: string; lifecycle: string }> {
  const callable = httpsCallable<LifecycleTargetInput, { targetUid: string; lifecycle: string }>(
    functions,
    'restoreMember',
  );
  const result = await callable({ targetUid, clientReqId });
  return result.data;
}

export async function removeMemberFromFamily(targetUid: string, clientReqId: string): Promise<{ targetUid: string; lifecycle: string }> {
  const callable = httpsCallable<LifecycleTargetInput, { targetUid: string; lifecycle: string }>(
    functions,
    'removeMemberFromFamily',
  );
  const result = await callable({ targetUid, clientReqId });
  return result.data;
}

export async function changeMemberRole(targetUid: string, newRole: 'adult' | 'parent', clientReqId: string): Promise<{ targetUid: string; role: string }> {
  const callable = httpsCallable<ChangeRoleInput, { targetUid: string; role: string }>(
    functions,
    'changeMemberRole',
  );
  const result = await callable({ targetUid, newRole, clientReqId });
  return result.data;
}

export async function transferOwnership(targetUid: string, clientReqId: string): Promise<{ targetUid: string; previousOwnerUid: string }> {
  const callable = httpsCallable<TransferOwnershipInput, { targetUid: string; previousOwnerUid: string }>(
    functions,
    'transferOwnership',
  );
  const result = await callable({ targetUid, clientReqId });
  return result.data;
}
