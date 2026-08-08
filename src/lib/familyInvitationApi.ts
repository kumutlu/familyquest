import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

/** Roles an invitation may grant. `owner` is never issuable. */
export type IntendedRole = 'parent' | 'child';

export interface CreatedInvitation {
  code: string;
  intendedRole: IntendedRole;
  expiresAtMs: number;
}

export interface InvitationPreview {
  familyName: string;
  intendedRole: IntendedRole;
}

export interface AcceptedInvitation {
  familyId: string;
  status: 'pending';
  intendedRole: IntendedRole;
}

/**
 * Creates an authoritative, role-specific invitation record and returns its
 * code. The role lives only on the server record; it is never encoded in the
 * shareable URL.
 */
export async function createFamilyInvitation(
  intendedRole: IntendedRole,
  clientReqId: string = crypto.randomUUID(),
): Promise<CreatedInvitation> {
  const callable = httpsCallable<
    { intendedRole: IntendedRole; clientReqId: string },
    CreatedInvitation
  >(functions, 'createFamilyInvitation');
  const response = await callable({ intendedRole, clientReqId });
  return response.data;
}

/**
 * Validates an invite code and returns the minimum information needed to
 * render the join confirmation. No family details are available before this
 * call succeeds.
 */
export async function previewInvitation(code: string): Promise<InvitationPreview> {
  const callable = httpsCallable<{ code: string }, InvitationPreview>(functions, 'previewInvitation');
  const response = await callable({ code });
  return response.data;
}

/**
 * Accepts a validated invitation. No role is sent: the server derives it from
 * the stored invitation record.
 */
export async function acceptInvitation(
  code: string,
  clientReqId: string = crypto.randomUUID(),
): Promise<AcceptedInvitation> {
  const callable = httpsCallable<
    { code: string; clientReqId: string },
    AcceptedInvitation
  >(functions, 'acceptInvitation');
  const response = await callable({ code, clientReqId });
  return response.data;
}
