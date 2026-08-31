import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import contractJson from '../../scripts/parent-invite-v2-contract.json';
import { requireCurrentFamilyAuthority } from '../auth/clientFamilyAuthority';

export const ADULT_INVITATION_CONTRACT = contractJson.frontend;

function assertAdultInvitationContract(): void {
  if (
    ADULT_INVITATION_CONTRACT.adultMembershipAuthority !== 'v2-callable-only'
    || ADULT_INVITATION_CONTRACT.familyCodeAdultAuthorityFallback !== false
  ) {
    throw new Error('adult invitation authority contract is not safe');
  }
}

export type AdultRole = 'parent' | 'adult';
export type FamilyMembershipRole = 'owner' | 'parent' | 'adult' | 'child';

export interface CreateAdultInvitationInput {
  intendedRole: AdultRole;
  clientReqId: string;
}

export interface PreviewAdultInvitationInput {
  token: string;
}

export interface AcceptAdultInvitationInput {
  token: string;
  clientReqId: string;
}

export interface CompleteAdultInvitationProfileInput {
  token: string;
  displayName: string;
  clientReqId: string;
}

export interface RevokeAdultInvitationInput {
  invitationId: string;
  clientReqId: string;
}

export interface CreatedAdultInvitation {
  invitationId: string;
  token: string;
  intendedRole: AdultRole;
  expiresAt: string;
}

export interface AdultInvitationPreview {
  familyDisplayName: string;
  intendedRole: AdultRole;
  expiresAt: string;
  status: 'active';
}

export interface AdultInvitationAcceptance {
  result: 'joined' | 'already_member';
  familyId: string;
  role: FamilyMembershipRole;
  destination: '/';
}

export async function createAdultInvitation(
  input: CreateAdultInvitationInput,
): Promise<CreatedAdultInvitation> {
  assertAdultInvitationContract();
  const callable = httpsCallable<CreateAdultInvitationInput, CreatedAdultInvitation>(
    functions,
    'createAdultInvitation',
  );
  return (await callable(input)).data;
}

export async function previewAdultInvitation(
  input: PreviewAdultInvitationInput,
): Promise<AdultInvitationPreview> {
  assertAdultInvitationContract();
  const callable = httpsCallable<PreviewAdultInvitationInput, AdultInvitationPreview>(
    functions,
    'previewAdultInvitation',
  );
  return (await callable(input)).data;
}

export async function acceptAdultInvitation(
  input: AcceptAdultInvitationInput,
): Promise<AdultInvitationAcceptance> {
  assertAdultInvitationContract();
  await requireCurrentFamilyAuthority();
  const callable = httpsCallable<AcceptAdultInvitationInput, AdultInvitationAcceptance>(
    functions,
    'acceptAdultInvitation',
  );
  return (await callable(input)).data;
}

export async function completeAdultInvitationProfile(
  input: CompleteAdultInvitationProfileInput,
): Promise<{ success: true }> {
  assertAdultInvitationContract();
  const callable = httpsCallable<CompleteAdultInvitationProfileInput, { success: true }>(
    functions,
    'completeAdultInvitationProfile',
  );
  return (await callable(input)).data;
}

export async function revokeAdultInvitation(
  input: RevokeAdultInvitationInput,
): Promise<{ success: true }> {
  assertAdultInvitationContract();
  const callable = httpsCallable<RevokeAdultInvitationInput, { success: true }>(
    functions,
    'revokeAdultInvitation',
  );
  return (await callable(input)).data;
}
