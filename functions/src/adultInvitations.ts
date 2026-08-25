import { createHash, randomBytes as cryptoRandomBytes } from 'node:crypto';
import {
  getFirestore,
  Timestamp,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';

export type AdultRole = 'parent' | 'adult';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AdultInvitationRecord = {
  version: 2;
  familyId: string;
  intendedRole: AdultRole;
  status: 'active' | 'accepted' | 'revoked';
  createdBy: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  acceptedBy?: string;
  acceptedAt?: Timestamp;
  revokedBy?: string;
  revokedAt?: Timestamp;
  clientReqId: string;
};

export function generateAdultInvitationToken(
  bytes: () => Buffer = () => cryptoRandomBytes(32),
): string {
  const tokenBytes = bytes();
  if (tokenBytes.length !== 32) {
    throw new Error('INVALID_INVITATION_TOKEN_BYTES');
  }
  return tokenBytes.toString('base64url');
}

function validateAdultInvitationToken(token: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('INVALID_INVITATION_TOKEN');
  }

  const decoded = Buffer.from(token, 'base64url');
  if (decoded.length !== 32 || decoded.toString('base64url') !== token) {
    throw new Error('INVALID_INVITATION_TOKEN');
  }
  return decoded;
}

export function hashAdultInvitationToken(token: string): string {
  validateAdultInvitationToken(token);
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function validateAdultRole(value: unknown): AdultRole {
  if (value === 'parent' || value === 'adult') {
    return value;
  }
  throw new Error('INVALID_INTENDED_ROLE');
}

const CLIENT_REQ_ID = /^[A-Za-z0-9_-]{8,128}$/;
const INVITATION_ID = /^[a-f0-9]{64}$/;
const PREVIEW_WINDOW_MS = 15 * 60 * 1000;
const PREVIEW_ATTEMPT_LIMIT = 10;

export interface AdultInvitationContext {
  db: Firestore;
  now?: () => Date;
  randomBytes?: () => Buffer;
  timestamp?: (date: Date) => Timestamp;
  eventId?: () => string;
  previewIdentity?: (request: CallableRequest<unknown>) => string;
}

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
  role: AdultRole;
  destination: '/';
}

type DocumentData = Record<string, unknown>;

function httpsError(
  code: ConstructorParameters<typeof HttpsError>[0],
  message: string,
  details?: unknown,
): HttpsError {
  return new HttpsError(code, message, details);
}

function requireUid(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (!uid) throw httpsError('unauthenticated', 'AUTH_REQUIRED');
  return uid;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertInputShape(input: unknown, allowedKeys: readonly string[]): asserts input is Record<string, unknown> {
  if (!isRecord(input) || Object.keys(input).some(key => !allowedKeys.includes(key))) {
    throw httpsError('invalid-argument', 'BAD_REQUEST');
  }
}

function validateClientReqId(value: unknown): string {
  if (typeof value !== 'string' || !CLIENT_REQ_ID.test(value)) {
    throw httpsError('invalid-argument', 'INVALID_REQUEST_ID');
  }
  return value;
}

function validateRole(value: unknown): AdultRole {
  try {
    return validateAdultRole(value);
  } catch {
    throw httpsError('invalid-argument', 'INVALID_INTENDED_ROLE');
  }
}

function invitationIdFor(value: unknown): string {
  if (typeof value !== 'string') {
    throw httpsError('invalid-argument', 'INVALID_INVITATION');
  }
  try {
    return hashAdultInvitationToken(value);
  } catch {
    throw httpsError('invalid-argument', 'INVALID_INVITATION');
  }
}

function validateInvitationId(value: unknown): string {
  if (typeof value !== 'string' || !INVITATION_ID.test(value)) {
    throw httpsError('invalid-argument', 'INVALID_INVITATION');
  }
  return value;
}

function dateNow(context: AdultInvitationContext): Date {
  return new Date((context.now ?? (() => new Date()))().getTime());
}

function toTimestamp(context: AdultInvitationContext, date: Date): Timestamp {
  return context.timestamp?.(date) ?? Timestamp.fromDate(date);
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (isRecord(value) && typeof value.toDate === 'function') {
    const date = (value.toDate as () => unknown)();
    return date instanceof Date ? date : null;
  }
  return null;
}

function isActiveMember(data: DocumentData | undefined): boolean {
  return Boolean(
    data &&
    (data.lifecycle === undefined || data.lifecycle === 'active') &&
    data.status !== 'deleted' &&
    data.status !== 'disabled' &&
    data.disabled !== true,
  );
}

function isActiveFamily(data: DocumentData | undefined): boolean {
  return Boolean(
    data &&
    (data.lifecycleState === undefined || data.lifecycleState === 'active') &&
    data.status !== 'deleted',
  );
}

function invitationRecord(data: DocumentData | undefined): AdultInvitationRecord {
  if (
    !data ||
    data.version !== 2 ||
    typeof data.familyId !== 'string' ||
    (data.intendedRole !== 'parent' && data.intendedRole !== 'adult') ||
    (data.status !== 'active' && data.status !== 'accepted' && data.status !== 'revoked')
  ) {
    throw httpsError('failed-precondition', 'INVALID_INVITATION');
  }
  return data as AdultInvitationRecord;
}

function assertInvitationActive(
  invitation: AdultInvitationRecord,
  now: Date,
  claimantUid?: string,
): void {
  if (invitation.status === 'revoked') {
    throw httpsError('failed-precondition', 'INVITATION_REVOKED');
  }
  if (invitation.status === 'accepted') {
    if (claimantUid && invitation.acceptedBy === claimantUid) return;
    throw httpsError('failed-precondition', 'INVITATION_ALREADY_USED');
  }
  const expiresAt = toDate(invitation.expiresAt);
  if (!expiresAt) throw httpsError('failed-precondition', 'INVALID_INVITATION');
  if (expiresAt.getTime() <= now.getTime()) {
    throw httpsError('failed-precondition', 'INVITATION_EXPIRED');
  }
}

function invitationExpiryIso(invitation: AdultInvitationRecord): string {
  const expiresAt = toDate(invitation.expiresAt);
  if (!expiresAt) throw httpsError('failed-precondition', 'INVALID_INVITATION');
  return expiresAt.toISOString();
}

function previewIdentity(
  request: CallableRequest<unknown>,
  context: AdultInvitationContext,
): string {
  const injected = context.previewIdentity?.(request);
  if (injected) return injected;
  const appId = request.app?.appId;
  if (typeof appId === 'string' && appId) return `app:${appId}`;
  const ip = request.rawRequest?.ip;
  if (typeof ip === 'string' && ip) return `ip:${ip}`;
  return 'anonymous';
}

async function enforcePreviewRateLimit(
  request: CallableRequest<unknown>,
  context: AdultInvitationContext,
): Promise<void> {
  const identityHash = createHash('sha256')
    .update(previewIdentity(request, context), 'utf8')
    .digest('hex');
  const ref = context.db.doc(`adultInvitationPreviewRateLimits/${identityHash}`);
  const now = dateNow(context);
  await context.db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.data() as DocumentData | undefined;
    const windowStartedAt = toDate(current?.windowStartedAt);
    const withinWindow = Boolean(
      windowStartedAt && now.getTime() - windowStartedAt.getTime() < PREVIEW_WINDOW_MS,
    );
    const count = withinWindow && typeof current?.count === 'number' ? current.count : 0;
    if (count >= PREVIEW_ATTEMPT_LIMIT) {
      throw httpsError('resource-exhausted', 'TOO_MANY_ATTEMPTS');
    }
    transaction.set(ref, {
      windowStartedAt: withinWindow ? current?.windowStartedAt : toTimestamp(context, now),
      count: count + 1,
      updatedAt: toTimestamp(context, now),
    });
  });
}

export async function createAdultInvitationImpl(
  input: CreateAdultInvitationInput,
  request: CallableRequest<CreateAdultInvitationInput>,
  context: AdultInvitationContext,
): Promise<CreatedAdultInvitation> {
  assertInputShape(input, ['intendedRole', 'clientReqId']);
  const uid = requireUid(request);
  const intendedRole = validateRole(input.intendedRole);
  const clientReqId = validateClientReqId(input.clientReqId);
  const now = dateNow(context);
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  const token = generateAdultInvitationToken(context.randomBytes);
  const invitationId = hashAdultInvitationToken(token);
  const profileRef = context.db.doc(`users/${uid}`);
  const operationRef = context.db.doc(`adultInvitationCreationIdempotency/${uid}_${clientReqId}`);
  const invitationRef = context.db.doc(`familyInvitations/${invitationId}`);

  await context.db.runTransaction(async (transaction: Transaction) => {
    const profileSnapshot = await transaction.get(profileRef);
    const profile = profileSnapshot.data() as DocumentData | undefined;
    if (
      !profileSnapshot.exists ||
      profile?.role !== 'owner' ||
      typeof profile.familyId !== 'string' ||
      !isActiveMember(profile)
    ) {
      throw httpsError('permission-denied', 'OWNER_REQUIRED');
    }
    const familyId = profile.familyId;
    const familyRef = context.db.doc(`families/${familyId}`);
    const [familySnapshot, operationSnapshot, collisionSnapshot] = await Promise.all([
      transaction.get(familyRef),
      transaction.get(operationRef),
      transaction.get(invitationRef),
    ]);
    const family = familySnapshot.data() as DocumentData | undefined;
    if (!familySnapshot.exists || !isActiveFamily(family)) {
      throw httpsError('failed-precondition', 'FAMILY_UNAVAILABLE');
    }
    if (operationSnapshot.exists) {
      const operation = operationSnapshot.data() as DocumentData;
      if (
        operation.operation !== 'create-adult-invitation' ||
        operation.familyId !== familyId ||
        operation.intendedRole !== intendedRole
      ) {
        throw httpsError('already-exists', 'REQUEST_ID_REUSED');
      }
      throw httpsError('already-exists', 'INVITATION_ALREADY_CREATED', {
        invitationId: operation.invitationId,
        intendedRole: operation.intendedRole,
        expiresAt: operation.expiresAt,
      });
    }
    if (collisionSnapshot.exists) throw httpsError('aborted', 'INVITATION_GENERATION_COLLISION');

    const createdAtTimestamp = toTimestamp(context, now);
    const expiresAtTimestamp = toTimestamp(context, expiresAt);
    transaction.set(invitationRef, {
      version: 2,
      familyId,
      intendedRole,
      status: 'active',
      createdBy: uid,
      createdAt: createdAtTimestamp,
      expiresAt: expiresAtTimestamp,
      clientReqId,
    });
    transaction.set(operationRef, {
      operation: 'create-adult-invitation',
      requesterUid: uid,
      familyId,
      invitationId,
      intendedRole,
      expiresAt: expiresAt.toISOString(),
      phase: 'complete',
      createdAt: createdAtTimestamp,
    });
  });

  return {
    invitationId,
    token,
    intendedRole,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function previewAdultInvitationImpl(
  input: PreviewAdultInvitationInput,
  request: CallableRequest<PreviewAdultInvitationInput>,
  context: AdultInvitationContext,
): Promise<AdultInvitationPreview> {
  assertInputShape(input, ['token']);
  await enforcePreviewRateLimit(request, context);
  const invitationId = invitationIdFor(input.token);
  const invitationSnapshot = await context.db.doc(`familyInvitations/${invitationId}`).get();
  if (!invitationSnapshot.exists) {
    throw httpsError('not-found', 'INVALID_INVITATION');
  }
  const invitation = invitationRecord(invitationSnapshot.data() as DocumentData | undefined);
  assertInvitationActive(invitation, dateNow(context));
  const familySnapshot = await context.db.doc(`families/${invitation.familyId}`).get();
  const family = familySnapshot.data() as DocumentData | undefined;
  if (!familySnapshot.exists || !isActiveFamily(family)) {
    throw httpsError('failed-precondition', 'FAMILY_UNAVAILABLE');
  }
  const displayName = typeof family?.displayName === 'string' && family.displayName.trim()
    ? family.displayName.trim()
    : String(family?.name ?? '');
  return {
    familyDisplayName: displayName,
    intendedRole: invitation.intendedRole,
    expiresAt: invitationExpiryIso(invitation),
    status: 'active',
  };
}

export async function acceptAdultInvitationImpl(
  input: AcceptAdultInvitationInput,
  request: CallableRequest<AcceptAdultInvitationInput>,
  context: AdultInvitationContext,
): Promise<AdultInvitationAcceptance> {
  // `role` and `familyId` are accepted only as inert compatibility fields. They
  // are never read, persisted, or used to choose an authority path.
  assertInputShape(input, ['token', 'clientReqId', 'role', 'familyId']);
  const uid = requireUid(request);
  const clientReqId = validateClientReqId(input.clientReqId);
  const invitationId = invitationIdFor(input.token);
  const invitationRef = context.db.doc(`familyInvitations/${invitationId}`);
  const profileRef = context.db.doc(`users/${uid}`);
  const operationRef = context.db.doc(`adultInvitationAcceptanceIdempotency/${uid}_${clientReqId}`);
  const now = dateNow(context);

  return context.db.runTransaction(async (transaction: Transaction) => {
    const invitationSnapshot = await transaction.get(invitationRef);
    if (!invitationSnapshot.exists) throw httpsError('not-found', 'INVALID_INVITATION');
    const invitation = invitationRecord(invitationSnapshot.data() as DocumentData | undefined);
    const familyRef = context.db.doc(`families/${invitation.familyId}`);
    const membershipRef = context.db.doc(`families/${invitation.familyId}/users/${uid}`);
    const [familySnapshot, profileSnapshot, membershipSnapshot, operationSnapshot] =
      await Promise.all([
        transaction.get(familyRef),
        transaction.get(profileRef),
        transaction.get(membershipRef),
        transaction.get(operationRef),
      ]);
    const family = familySnapshot.data() as DocumentData | undefined;
    if (!familySnapshot.exists || !isActiveFamily(family)) {
      throw httpsError('failed-precondition', 'FAMILY_UNAVAILABLE');
    }
    const profile = profileSnapshot.data() as DocumentData | undefined;
    if (
      !profileSnapshot.exists ||
      typeof profile?.displayName !== 'string' ||
      !profile.displayName.trim()
    ) {
      throw httpsError('failed-precondition', 'PROFILE_REQUIRED');
    }
    if (operationSnapshot.exists) {
      const operation = operationSnapshot.data() as DocumentData;
      if (
        operation.operation !== 'accept-adult-invitation' ||
        operation.invitationId !== invitationId
      ) {
        throw httpsError('already-exists', 'REQUEST_ID_REUSED');
      }
      return {
        result: operation.result as 'joined' | 'already_member',
        familyId: String(operation.familyId),
        role: operation.role as AdultRole,
        destination: '/',
      };
    }

    const profileFamilyId = typeof profile.familyId === 'string' && profile.familyId
      ? profile.familyId
      : undefined;
    if (profileFamilyId && profileFamilyId !== invitation.familyId) {
      throw httpsError('failed-precondition', 'ALREADY_IN_ANOTHER_FAMILY');
    }
    assertInvitationActive(invitation, now, uid);

    if (invitation.status === 'accepted' && invitation.acceptedBy === uid) {
      if (profileFamilyId === invitation.familyId) {
        return {
          result: 'joined',
          familyId: invitation.familyId,
          role: invitation.intendedRole,
          destination: '/',
        };
      }
      throw httpsError('failed-precondition', 'INVITATION_ALREADY_USED');
    }

    const membership = membershipSnapshot.data() as DocumentData | undefined;
    const alreadyMember = profileFamilyId === invitation.familyId && isActiveMember(profile) &&
      (!membershipSnapshot.exists || isActiveMember(membership));
    const result: 'joined' | 'already_member' = alreadyMember ? 'already_member' : 'joined';
    const acceptedAt = toTimestamp(context, now);
    const eventId = context.eventId?.() ?? createHash('sha256')
      .update(`${uid}:${clientReqId}`, 'utf8')
      .digest('hex');
    const eventRef = context.db.doc(
      `families/${invitation.familyId}/adultInvitationEvents/${eventId}`,
    );

    if (!alreadyMember) {
      transaction.set(profileRef, {
        familyId: invitation.familyId,
        role: invitation.intendedRole,
        lifecycle: 'active',
        adultInvitationAcceptedAt: acceptedAt,
        adultInvitationAcceptanceRequestId: clientReqId,
      }, { merge: true });
      transaction.set(membershipRef, {
        uid,
        displayName: profile.displayName.trim(),
        avatarUrl: typeof profile.avatarUrl === 'string' ? profile.avatarUrl : '',
        role: invitation.intendedRole,
        lifecycle: 'active',
        joinedAt: acceptedAt,
        joinSource: 'adult-invitation-v2',
      }, { merge: true });
    }
    transaction.update(invitationRef, {
      status: 'accepted',
      acceptedBy: uid,
      acceptedAt,
    });
    transaction.set(operationRef, {
      operation: 'accept-adult-invitation',
      requesterUid: uid,
      invitationId,
      familyId: invitation.familyId,
      role: invitation.intendedRole,
      result,
      phase: 'complete',
      createdAt: acceptedAt,
    });
    transaction.set(eventRef, {
      event: result === 'joined' ? 'adult_invitation_joined' : 'adult_invitation_already_member',
      memberUid: uid,
      role: invitation.intendedRole,
      createdAt: acceptedAt,
    });

    return {
      result,
      familyId: invitation.familyId,
      role: invitation.intendedRole,
      destination: '/',
    };
  });
}

export async function revokeAdultInvitationImpl(
  input: RevokeAdultInvitationInput,
  request: CallableRequest<RevokeAdultInvitationInput>,
  context: AdultInvitationContext,
): Promise<{ success: true }> {
  assertInputShape(input, ['invitationId', 'clientReqId']);
  const uid = requireUid(request);
  const invitationId = validateInvitationId(input.invitationId);
  const clientReqId = validateClientReqId(input.clientReqId);
  const invitationRef = context.db.doc(`familyInvitations/${invitationId}`);
  const profileRef = context.db.doc(`users/${uid}`);
  const operationRef = context.db.doc(`adultInvitationRevocationIdempotency/${uid}_${clientReqId}`);
  const now = dateNow(context);

  return context.db.runTransaction(async (transaction: Transaction) => {
    const [invitationSnapshot, profileSnapshot, operationSnapshot] = await Promise.all([
      transaction.get(invitationRef),
      transaction.get(profileRef),
      transaction.get(operationRef),
    ]);
    if (!invitationSnapshot.exists) throw httpsError('not-found', 'INVALID_INVITATION');
    const invitation = invitationRecord(invitationSnapshot.data() as DocumentData | undefined);
    const profile = profileSnapshot.data() as DocumentData | undefined;
    const familyRef = context.db.doc(`families/${invitation.familyId}`);
    const familySnapshot = await transaction.get(familyRef);
    const family = familySnapshot.data() as DocumentData | undefined;
    if (
      !profileSnapshot.exists ||
      profile?.role !== 'owner' ||
      profile.familyId !== invitation.familyId ||
      !isActiveMember(profile)
    ) {
      throw httpsError('permission-denied', 'OWNER_REQUIRED');
    }
    if (operationSnapshot.exists) {
      const operation = operationSnapshot.data() as DocumentData;
      if (
        operation.operation !== 'revoke-adult-invitation' ||
        operation.invitationId !== invitationId ||
        operation.familyId !== invitation.familyId
      ) {
        throw httpsError('already-exists', 'REQUEST_ID_REUSED');
      }
      return { success: true as const };
    }
    if (invitation.status === 'revoked') return { success: true as const };
    if (!familySnapshot.exists || !isActiveFamily(family)) {
      throw httpsError('failed-precondition', 'FAMILY_UNAVAILABLE');
    }
    if (invitation.status === 'accepted') {
      throw httpsError('failed-precondition', 'INVITATION_ALREADY_ACCEPTED');
    }
    const revokedAt = toTimestamp(context, now);
    transaction.update(invitationRef, {
      status: 'revoked',
      revokedBy: uid,
      revokedAt,
    });
    transaction.set(operationRef, {
      operation: 'revoke-adult-invitation',
      requesterUid: uid,
      invitationId,
      familyId: invitation.familyId,
      phase: 'complete',
      createdAt: revokedAt,
    });
    return { success: true as const };
  });
}

const productionContext = (): AdultInvitationContext => ({ db: getFirestore() });

export const createAdultInvitation = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  request => createAdultInvitationImpl(request.data, request, productionContext()),
);

export const previewAdultInvitation = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  request => previewAdultInvitationImpl(request.data, request, productionContext()),
);

export const acceptAdultInvitation = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  request => acceptAdultInvitationImpl(request.data, request, productionContext()),
);

export const revokeAdultInvitation = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  request => revokeAdultInvitationImpl(request.data, request, productionContext()),
);
