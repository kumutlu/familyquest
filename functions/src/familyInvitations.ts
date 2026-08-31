// ---------------------------------------------------------------------------
// FAMILY INVITATIONS — ROLE-AUTHORITATIVE INVITE RECORDS
// ---------------------------------------------------------------------------
//
// The legacy model exposes a single reusable `families/{id}.inviteCode` which
// carries no role information. These callables introduce an authoritative
// invitation record stored at `families/{familyId}/invitations/{code}`.
//
// SECURITY MODEL
// - The invitation record is the ONLY source of authority for the role a
//   joining user will receive. The client never sends a role to the server on
//   the join path, and no URL query parameter is ever consulted.
// - `owner` can never be issued through an invitation.
// - Invitation documents are server-only (see firestore.rules); clients read
//   the minimal, validated projection returned by `previewInvitation`.
// ---------------------------------------------------------------------------

import { randomInt } from 'crypto';
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { requireFamilyAuthority } from './emailVerificationAuthority';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;
const INVITE_CODE = /^[A-Z0-9]{6}$/;

/** Legacy role invitations are the only records addressed by `/join?code=`. */
export function isLegacyInvitationCode(value: unknown): value is string {
  return typeof value === 'string' && INVITE_CODE.test(value.trim().toUpperCase());
}

/** Roles an invitation is allowed to grant. `owner` is deliberately absent. */
export type IntendedRole = 'parent' | 'child';

const INTENDED_ROLES: readonly string[] = ['parent', 'child'];

/** Default invitation lifetime: 7 days. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface FamilyInvitationContext {
  db: Firestore;
  now?: () => Date;
  generateCode?: () => string;
}

export interface CreateFamilyInvitationInput {
  intendedRole: IntendedRole;
  clientReqId: string;
}

export interface PreviewInvitationInput {
  code: string;
}

export interface AcceptInvitationInput {
  code: string;
  clientReqId: string;
}

export interface InvitationPreview {
  familyName: string;
  intendedRole: IntendedRole;
}

function requireUid(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'AUTH_REQUIRED');
  return uid;
}

function validateRequestId(value: unknown): string {
  if (typeof value !== 'string' || !REQUEST_ID.test(value)) {
    throw new HttpsError('invalid-argument', 'INVALID_REQUEST_ID');
  }
  return value;
}

function normaliseCode(value: unknown): string {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!isLegacyInvitationCode(code)) throw new HttpsError('invalid-argument', 'INVALID_INVITATION');
  return code;
}

/**
 * Validates the requested role. Anything other than `parent` or `child` — most
 * importantly `owner` — is rejected outright.
 */
function validateIntendedRole(value: unknown): IntendedRole {
  if (typeof value !== 'string' || !INTENDED_ROLES.includes(value)) {
    throw new HttpsError('invalid-argument', 'INVALID_INTENDED_ROLE');
  }
  return value as IntendedRole;
}

function defaultCode(): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

function nowMs(context: FamilyInvitationContext): number {
  return (context.now ?? (() => new Date()))().getTime();
}

interface InvitationRecord {
  code: string;
  familyId: string;
  intendedRole: IntendedRole;
  createdBy: string;
  status: 'active' | 'used' | 'revoked';
  expiresAtMs: number;
  usedBy?: string;
}

/**
 * Resolves a code to its authoritative invitation record. Returns `null` when
 * no invitation exists so callers can fall back to the legacy family code.
 */
async function findInvitation(
  db: Firestore,
  code: string,
): Promise<InvitationRecord | null> {
  const snapshot = await db
    .collectionGroup('invitations')
    .where('code', '==', code)
    .limit(2)
    .get();
  if (snapshot.empty || snapshot.docs.length !== 1) return null;
  return snapshot.docs[0].data() as InvitationRecord;
}

/**
 * Throws the appropriate error when an invitation is not usable.
 *
 * `claimantUid` lets the accept path treat an invitation already consumed by
 * the *same* user as replayable, so a refresh or browser-back never turns a
 * successful join into an error.
 */
function assertUsable(invitation: InvitationRecord, atMs: number, claimantUid?: string): void {
  if (invitation.status === 'revoked') {
    throw new HttpsError('failed-precondition', 'INVITATION_REVOKED');
  }
  if (invitation.status === 'used' && !(claimantUid && invitation.usedBy === claimantUid)) {
    throw new HttpsError('failed-precondition', 'INVITATION_ALREADY_USED');
  }
  if (typeof invitation.expiresAtMs === 'number' && invitation.expiresAtMs <= atMs) {
    throw new HttpsError('failed-precondition', 'INVITATION_EXPIRED');
  }
  if (!INTENDED_ROLES.includes(invitation.intendedRole)) {
    // Defensive: a corrupt record must never grant an unexpected role.
    throw new HttpsError('failed-precondition', 'INVALID_INVITATION');
  }
}

export async function createFamilyInvitationImpl(
  input: CreateFamilyInvitationInput,
  request: CallableRequest<CreateFamilyInvitationInput>,
  context: FamilyInvitationContext,
): Promise<{ code: string; intendedRole: IntendedRole; expiresAtMs: number }> {
  const uid = requireUid(request);
  const clientReqId = validateRequestId(input?.clientReqId);
  const intendedRole = validateIntendedRole(input?.intendedRole);

  const profile = (await context.db.doc(`users/${uid}`).get()).data();
  if (!profile?.familyId || (profile.role !== 'owner' && profile.role !== 'parent')) {
    throw new HttpsError('permission-denied', 'PARENT_REQUIRED');
  }
  const familyId = String(profile.familyId);
  const operationRef = context.db.doc(`familyInvitationIdempotency/${uid}_${clientReqId}`);
  const prior = await operationRef.get();
  if (prior.exists) {
    const data = prior.data();
    if (data?.operation !== 'create-family-invitation' || data?.familyId !== familyId) {
      throw new HttpsError('already-exists', 'REQUEST_ID_REUSED');
    }
    return {
      code: String(data.code),
      intendedRole: data.intendedRole as IntendedRole,
      expiresAtMs: Number(data.expiresAtMs),
    };
  }

  let code = '';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = (context.generateCode ?? defaultCode)();
    if (!INVITE_CODE.test(candidate)) throw new HttpsError('internal', 'CODE_GENERATION_FAILED');
    if (!(await findInvitation(context.db, candidate))) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new HttpsError('resource-exhausted', 'CODE_GENERATION_FAILED');

  const expiresAtMs = nowMs(context) + INVITATION_TTL_MS;
  const invitationRef = context.db.doc(`families/${familyId}/invitations/${code}`);

  await context.db.runTransaction(async transaction => {
    const existing = await transaction.get(operationRef);
    if (existing.exists) return;
    transaction.set(invitationRef, {
      code,
      familyId,
      intendedRole,
      createdBy: uid,
      status: 'active',
      expiresAtMs,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.set(operationRef, {
      operation: 'create-family-invitation',
      requesterUid: uid,
      familyId,
      code,
      intendedRole,
      expiresAtMs,
      phase: 'complete',
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return { code, intendedRole, expiresAtMs };
}

/**
 * Validates a code and returns the minimum information required to render the
 * join confirmation. Nothing about the family is disclosed until the
 * invitation itself has been validated.
 */
export async function previewInvitationImpl(
  input: PreviewInvitationInput,
  _request: CallableRequest<PreviewInvitationInput>,
  context: FamilyInvitationContext,
): Promise<InvitationPreview> {
  const code = normaliseCode(input?.code);
  const invitation = await findInvitation(context.db, code);
  if (!invitation) throw new HttpsError('not-found', 'INVALID_INVITATION');
  assertUsable(invitation, nowMs(context));

  const family = await context.db.doc(`families/${invitation.familyId}`).get();
  if (!family.exists) throw new HttpsError('not-found', 'INVALID_INVITATION');

  return {
    familyName: String(family.data()?.name ?? ''),
    intendedRole: invitation.intendedRole,
  };
}

/**
 * Creates the pending join request for a validated invitation. The resulting
 * role is derived exclusively from the stored invitation record; the caller
 * cannot influence it.
 */
export async function acceptInvitationImpl(
  input: AcceptInvitationInput,
  request: CallableRequest<AcceptInvitationInput>,
  context: FamilyInvitationContext,
): Promise<{ familyId: string; status: 'pending'; intendedRole: IntendedRole }> {
  const uid = requireUid(request);
  requireFamilyAuthority(request);
  const clientReqId = validateRequestId(input?.clientReqId);
  const code = normaliseCode(input?.code);

  const profileRef = context.db.doc(`users/${uid}`);
  const profileSnapshot = await profileRef.get();
  const profile = profileSnapshot.data();
  if (!profileSnapshot.exists || typeof profile?.displayName !== 'string' || !profile.displayName.trim()) {
    throw new HttpsError('failed-precondition', 'PROFILE_REQUIRED');
  }

  const invitation = await findInvitation(context.db, code);
  if (!invitation) throw new HttpsError('not-found', 'INVALID_INVITATION');

  if (typeof profile.familyId === 'string' && profile.familyId) {
    throw new HttpsError(
      'failed-precondition',
      profile.familyId === invitation.familyId ? 'ALREADY_IN_THIS_FAMILY' : 'ALREADY_IN_FAMILY',
    );
  }

  assertUsable(invitation, nowMs(context), uid);

  const familyId = invitation.familyId;
  const intendedRole = invitation.intendedRole;
  const requestRef = context.db.doc(`families/${familyId}/join_requests/${uid}`);
  const invitationRef = context.db.doc(`families/${familyId}/invitations/${code}`);
  const operationRef = context.db.doc(`familyInvitationIdempotency/${uid}_${clientReqId}`);

  return context.db.runTransaction(async transaction => {
    const [latestProfile, existingRequest, existingOperation] = await Promise.all([
      transaction.get(profileRef),
      transaction.get(requestRef),
      transaction.get(operationRef),
    ]);
    if (latestProfile.data()?.familyId) {
      throw new HttpsError('failed-precondition', 'ALREADY_IN_FAMILY');
    }
    if (existingOperation.exists) {
      return { familyId, status: 'pending' as const, intendedRole };
    }
    if (existingRequest.exists && existingRequest.data()?.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'REQUEST_ALREADY_PROCESSED');
    }

    transaction.set(requestRef, {
      uid,
      displayName: profile.displayName.trim(),
      status: 'pending',
      // Server-written role authority consumed by the approval path.
      intendedRole,
      invitationCode: code,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.update(invitationRef, {
      status: 'used',
      usedBy: uid,
      usedAtMs: nowMs(context),
    });
    transaction.set(operationRef, {
      operation: 'accept-invitation',
      requesterUid: uid,
      familyId,
      code,
      intendedRole,
      phase: 'complete',
      createdAt: FieldValue.serverTimestamp(),
    });
    return { familyId, status: 'pending' as const, intendedRole };
  });
}

const productionContext = (): FamilyInvitationContext => ({ db: getFirestore() });

export const createFamilyInvitation = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  request => createFamilyInvitationImpl(request.data, request, productionContext()),
);

export const previewInvitation = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  request => previewInvitationImpl(request.data, request, productionContext()),
);

export const acceptInvitation = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  request => acceptInvitationImpl(request.data, request, productionContext()),
);
