// ---------------------------------------------------------------------------
// FAMILYQUEST — CHILD JOIN REQUEST WITH MANDATORY PARENT APPROVAL
// ---------------------------------------------------------------------------
//
// A child who is NOT yet a family member submits (familyCode, username,
// password) from /join-family. The request grants ZERO family access until a
// parent (or owner) of the exact target family approves it.
//
// IDENTITY MODEL (reuses the existing managed-child system verbatim)
// ------------------------------------------------------------------
//  * There is exactly ONE child identity model: the managed-child profile
//    users/{childId} (role 'child', isManaged true) linked to a synthetic
//    Firebase Auth user via `authUid` + custom claims. See childLogin.ts.
//  * This module does NOT introduce a second model. Approval provisions the
//    same documents createChildLogin provisions:
//      users/{childId}                                (profile + link)
//      families/{familyId}/childLoginIndex/{username} (uniqueness)
//      families/{familyId}/childLogins/{childId}      (private record)
//
// PASSWORD HANDLING (critical)
// ----------------------------
// The requester is unauthenticated, so the password cannot be parked anywhere
// we control. We therefore use the ONLY approved secure mechanism already in
// the codebase: Firebase Auth itself. At submission the synthetic Auth user is
// created with the supplied password but
//      disabled: true, and NO custom claims,
// so it cannot mint a usable session and has no Firestore membership. Firebase
// Auth stores a salted hash; the plaintext exists only for the lifetime of the
// callable invocation. It is NEVER written to Firestore, logs, analytics or
// error payloads. Approval enables + claims the same uid; rejection, expiry and
// cancellation delete it.
//
// RESERVATION
// -----------
// Pending requests reserve the normalized username in the EXISTING
// families/{familyId}/childLoginIndex namespace with
// { status: 'reserved', reservedByRequestId }. A live login and a pending
// request therefore can never collide. Reservations are released only when the
// stored reservedByRequestId still matches the request being resolved.
//
// EXPIRY
// ------
// 7 days (CHILD_JOIN_REQUEST_TTL_MS). Long enough for a parent who opens the
// app weekly, short enough that an abandoned username reservation is recycled.
// An hourly scheduled sweep expires stale requests.
//
// INFORMATION DISCLOSURE
// ----------------------
// Every family-resolution failure returns the same generic
// JOIN_REQUEST_FAILED, so arbitrary Family Codes cannot be probed. The child's
// status endpoint requires a one-time request secret and never returns the
// familyId, family code, synthetic email or any password-derived material.
// ---------------------------------------------------------------------------

import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { createHash, randomBytes } from 'crypto';
import {
  normalizeUsername,
  validatePasswordStrength,
  generateSyntheticEmail,
} from './childLogin';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Join requests expire 7 days after they are created. Documented in docs/. */
export const CHILD_JOIN_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Abuse protection: at most 10 submissions per key per 15 minutes. */
export const CHILD_JOIN_RATE_LIMIT_MAX = 10;
export const CHILD_JOIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

const FAMILY_CODE = /^[A-Z0-9]{6}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{6,128}$/;

const USERS = 'users';
const FAMILIES = 'families';
const CHILD_LOGIN_INDEX = 'childLoginIndex';
const CHILD_LOGINS = 'childLogins';
const CHILD_LOGIN_AUDIT = 'childLoginAudit';
/** Parent-readable projection. Contains no credential material. */
export const CHILD_JOIN_REQUESTS = 'child_join_requests';
/** Server-only secrets sidecar. */
export const CHILD_JOIN_SECRETS = 'childJoinSecrets';
/** Root, server-only: opaque requestId -> familyId. */
export const CHILD_JOIN_LOOKUP = 'childJoinRequestLookup';
/** Root, server-only: rate-limit counters. */
export const CHILD_JOIN_RATE_LIMITS = 'childJoinRateLimits';

export type ChildJoinRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChildJoinContext {
  auth: Auth;
  db: Firestore;
  now?: () => Date;
  generateId?: () => string;
  generateSecret?: () => string;
}

export interface SubmitChildJoinRequestInput {
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

export interface ResolveChildJoinRequestInput {
  familyId: string;
  requestId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function httpError(code: string, message: string): HttpsError {
  return new HttpsError(code as never, message);
}

/** Generic failure used for every family-resolution outcome (no existence leak). */
function genericFailure(): never {
  throw httpError('invalid-argument', 'JOIN_REQUEST_FAILED');
}

function nowMs(ctx: ChildJoinContext): number {
  return (ctx.now ?? (() => new Date()))().getTime();
}

function newId(ctx: ChildJoinContext): string {
  return (ctx.generateId ?? (() => randomBytes(16).toString('hex')))();
}

function newSecret(ctx: ChildJoinContext): string {
  return (ctx.generateSecret ?? (() => randomBytes(32).toString('base64url')))();
}

export function hashRequestSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Constant-time-ish comparison of two hex digests. */
function secretMatches(candidate: string, storedHash: unknown): boolean {
  if (typeof storedHash !== 'string' || storedHash.length === 0) return false;
  const candidateHash = hashRequestSecret(candidate);
  if (candidateHash.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < candidateHash.length; i += 1) {
    diff |= candidateHash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}

function requestRef(ctx: ChildJoinContext, familyId: string, requestId: string) {
  return ctx.db.doc(`${FAMILIES}/${familyId}/${CHILD_JOIN_REQUESTS}/${requestId}`);
}

function secretRef(ctx: ChildJoinContext, familyId: string, requestId: string) {
  return ctx.db.doc(`${FAMILIES}/${familyId}/${CHILD_JOIN_SECRETS}/${requestId}`);
}

function indexRef(ctx: ChildJoinContext, familyId: string, normalizedUsername: string) {
  return ctx.db.doc(`${FAMILIES}/${familyId}/${CHILD_LOGIN_INDEX}/${normalizedUsername}`);
}

async function audit(
  ctx: ChildJoinContext,
  familyId: string,
  entry: Record<string, unknown>,
): Promise<void> {
  try {
    await ctx.db.collection(`${FAMILIES}/${familyId}/${CHILD_LOGIN_AUDIT}`).add({
      ...entry,
      familyId,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch {
    /* audit failures must never break the operation */
  }
}

/** Transactional sliding-window counter, mirroring familyMembership.ts. */
async function enforceRateLimit(ctx: ChildJoinContext, key: string): Promise<void> {
  const ref = ctx.db.doc(`${CHILD_JOIN_RATE_LIMITS}/${key}`);
  const currentMs = nowMs(ctx);
  await ctx.db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    const withinWindow =
      typeof data?.windowStartedAtMs === 'number' &&
      currentMs - data.windowStartedAtMs < CHILD_JOIN_RATE_LIMIT_WINDOW_MS;
    const count = withinWindow && typeof data?.count === 'number' ? data.count : 0;
    if (count >= CHILD_JOIN_RATE_LIMIT_MAX) {
      throw httpError('resource-exhausted', 'TOO_MANY_JOIN_REQUESTS');
    }
    transaction.set(ref, {
      windowStartedAtMs: withinWindow ? data!.windowStartedAtMs : currentMs,
      count: count + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

function rateLimitKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

/** Delete the provisional (disabled, unclaimed) Auth user. Best effort. */
async function discardProvisionalAuthUser(
  ctx: ChildJoinContext,
  pendingAuthUid: unknown,
): Promise<void> {
  if (typeof pendingAuthUid !== 'string' || !pendingAuthUid) return;
  try {
    await ctx.auth.deleteUser(pendingAuthUid);
  } catch {
    /* already gone */
  }
}

// ---------------------------------------------------------------------------
// 1. submitChildJoinRequest (unauthenticated)
// ---------------------------------------------------------------------------

export async function submitChildJoinRequestImpl(
  ctx: ChildJoinContext,
  data: SubmitChildJoinRequestInput,
  meta: { ip?: string } = {},
): Promise<SubmitChildJoinRequestResult> {
  if (!data || typeof data !== 'object') genericFailure();

  const familyCode =
    typeof data.familyCode === 'string' ? data.familyCode.trim().toUpperCase() : '';

  // Username + password validation reuse the existing managed-child policy.
  const normalizedUsername = normalizeUsername(data.username);
  const strength = validatePasswordStrength(data.password, normalizedUsername);
  if (!strength.ok) throw httpError('invalid-argument', strength.reason ?? 'WEAK_PASSWORD');

  // Rate limit BEFORE resolving the family so probing is throttled too.
  await enforceRateLimit(ctx, rateLimitKey(`ip:${meta.ip ?? 'noip'}`));
  await enforceRateLimit(ctx, rateLimitKey(`code:${familyCode}`));

  if (!FAMILY_CODE.test(familyCode)) genericFailure();

  const matches = await ctx.db
    .collection(FAMILIES)
    .where('inviteCode', '==', familyCode)
    .limit(2)
    .get();
  if (matches.empty || matches.docs.length !== 1) genericFailure();
  const familyId = matches.docs[0].id;

  const createdAtMs = nowMs(ctx);
  const expiresAtMs = createdAtMs + CHILD_JOIN_REQUEST_TTL_MS;
  const requestId = newId(ctx);
  const requestSecret = newSecret(ctx);
  const displayUsername =
    typeof data.username === 'string' ? data.username.trim().replace(/\s+/g, ' ') : normalizedUsername;

  // --- Reserve the username atomically ------------------------------------
  // The reservation is taken FIRST so two concurrent submissions can never
  // both claim it, and so an Auth user is only created for the winner.
  await ctx.db.runTransaction(async transaction => {
    const reservation = await transaction.get(indexRef(ctx, familyId, normalizedUsername));
    if (reservation.exists) {
      const held = reservation.data() as Record<string, unknown>;
      const stale =
        held.status === 'reserved' &&
        typeof held.expiresAtMs === 'number' &&
        held.expiresAtMs <= createdAtMs;
      if (!stale) throw httpError('already-exists', 'USERNAME_TAKEN');
    }
    transaction.set(indexRef(ctx, familyId, normalizedUsername), {
      status: 'reserved',
      reservedByRequestId: requestId,
      normalizedUsername,
      expiresAtMs,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  // --- Provision the disabled, unclaimed Auth user ------------------------
  const syntheticEmail = generateSyntheticEmail(familyId, normalizedUsername);
  let pendingAuthUid: string;
  try {
    const record = await ctx.auth.createUser({
      email: syntheticEmail,
      password: data.password,
      displayName: displayUsername,
      // Zero access until a parent approves.
      disabled: true,
    });
    pendingAuthUid = record.uid;
  } catch {
    // Release the reservation we just took; never leak the reason.
    await releaseReservation(ctx, familyId, normalizedUsername, requestId);
    genericFailure();
  }

  // --- Persist the request -------------------------------------------------
  try {
    await ctx.db.runTransaction(async transaction => {
      transaction.set(requestRef(ctx, familyId, requestId), {
        requestId,
        familyId,
        normalizedUsername,
        displayUsername,
        status: 'pending' satisfies ChildJoinRequestStatus,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs,
        expiresAtMs,
        resolvedAt: null,
        resolvedBy: null,
        childId: null,
      });
      transaction.set(secretRef(ctx, familyId, requestId), {
        requestId,
        familyId,
        normalizedUsername,
        pendingAuthUid,
        syntheticEmail,
        requestSecretHash: hashRequestSecret(requestSecret),
        expiresAtMs,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.set(ctx.db.doc(`${CHILD_JOIN_LOOKUP}/${requestId}`), {
        familyId,
        expiresAtMs,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (error) {
    await discardProvisionalAuthUser(ctx, pendingAuthUid);
    await releaseReservation(ctx, familyId, normalizedUsername, requestId);
    throw error;
  }

  await audit(ctx, familyId, {
    type: 'child_join_requested',
    requestId,
    normalizedUsername,
    success: true,
  });

  return {
    requestId,
    requestSecret,
    username: displayUsername,
    status: 'pending',
    expiresAt: expiresAtMs,
  };
}

/** Deletes the reservation only when it is still held by this request. */
async function releaseReservation(
  ctx: ChildJoinContext,
  familyId: string,
  normalizedUsername: string,
  requestId: string,
): Promise<void> {
  const ref = indexRef(ctx, familyId, normalizedUsername);
  await ctx.db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const held = snapshot.data() as Record<string, unknown>;
    if (held.reservedByRequestId !== requestId) return;
    transaction.delete(ref);
  });
}

// ---------------------------------------------------------------------------
// Shared resolution for the unauthenticated child endpoints
// ---------------------------------------------------------------------------

async function loadBySecret(
  ctx: ChildJoinContext,
  input: { requestId?: unknown; requestSecret?: unknown },
): Promise<{
  familyId: string;
  requestId: string;
  request: Record<string, unknown>;
  secret: Record<string, unknown>;
}> {
  const requestId = typeof input?.requestId === 'string' ? input.requestId : '';
  const requestSecret = typeof input?.requestSecret === 'string' ? input.requestSecret : '';
  if (!REQUEST_ID.test(requestId) || !requestSecret) {
    throw httpError('not-found', 'JOIN_REQUEST_NOT_FOUND');
  }

  const lookup = await ctx.db.doc(`${CHILD_JOIN_LOOKUP}/${requestId}`).get();
  const familyId = lookup.exists ? String(lookup.data()?.familyId ?? '') : '';
  if (!familyId) throw httpError('not-found', 'JOIN_REQUEST_NOT_FOUND');

  const [requestSnap, secretSnap] = await Promise.all([
    requestRef(ctx, familyId, requestId).get(),
    secretRef(ctx, familyId, requestId).get(),
  ]);
  if (!requestSnap.exists || !secretSnap.exists) {
    throw httpError('not-found', 'JOIN_REQUEST_NOT_FOUND');
  }
  const secret = secretSnap.data() as Record<string, unknown>;
  if (!secretMatches(requestSecret, secret.requestSecretHash)) {
    throw httpError('not-found', 'JOIN_REQUEST_NOT_FOUND');
  }
  return {
    familyId,
    requestId,
    request: requestSnap.data() as Record<string, unknown>,
    secret,
  };
}

/**
 * Lazily flips a pending-but-past-TTL request to `expired` (and releases its
 * reservation) so no caller can act on it. Returns the effective status.
 */
async function settleExpiry(
  ctx: ChildJoinContext,
  familyId: string,
  requestId: string,
  request: Record<string, unknown>,
): Promise<ChildJoinRequestStatus> {
  const status = String(request.status ?? '') as ChildJoinRequestStatus;
  if (status !== 'pending') return status;
  const expiresAtMs = typeof request.expiresAtMs === 'number' ? request.expiresAtMs : 0;
  if (expiresAtMs > nowMs(ctx)) return 'pending';

  await expireRequest(ctx, familyId, requestId);
  return 'expired';
}

async function expireRequest(
  ctx: ChildJoinContext,
  familyId: string,
  requestId: string,
): Promise<boolean> {
  const secretSnap = await secretRef(ctx, familyId, requestId).get();
  const secret = (secretSnap.data() ?? {}) as Record<string, unknown>;

  const changed = await ctx.db.runTransaction(async transaction => {
    const snapshot = await transaction.get(requestRef(ctx, familyId, requestId));
    if (!snapshot.exists) return false;
    const data = snapshot.data() as Record<string, unknown>;
    if (data.status !== 'pending') return false;
    transaction.update(requestRef(ctx, familyId, requestId), {
      status: 'expired' satisfies ChildJoinRequestStatus,
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: null,
    });
    return true;
  });

  if (!changed) return false;
  await releaseReservation(ctx, familyId, String(secret.normalizedUsername ?? ''), requestId);
  await discardProvisionalAuthUser(ctx, secret.pendingAuthUid);
  await audit(ctx, familyId, {
    type: 'child_join_expired',
    requestId,
    normalizedUsername: secret.normalizedUsername ?? null,
    success: true,
  });
  return true;
}

// ---------------------------------------------------------------------------
// 2. getChildJoinRequestStatus (unauthenticated, secret-scoped)
// ---------------------------------------------------------------------------

export async function getChildJoinRequestStatusImpl(
  ctx: ChildJoinContext,
  input: { requestId?: unknown; requestSecret?: unknown },
): Promise<ChildJoinStatusResult> {
  const { familyId, requestId, request } = await loadBySecret(ctx, input);
  const status = await settleExpiry(ctx, familyId, requestId, request);
  return {
    requestId,
    username: String(request.displayUsername ?? request.normalizedUsername ?? ''),
    status,
    expiresAt: typeof request.expiresAtMs === 'number' ? request.expiresAtMs : 0,
  };
}

// ---------------------------------------------------------------------------
// 3. cancelChildJoinRequest (unauthenticated, secret-scoped)
// ---------------------------------------------------------------------------

export async function cancelChildJoinRequestImpl(
  ctx: ChildJoinContext,
  input: { requestId?: unknown; requestSecret?: unknown },
): Promise<{ requestId: string; status: ChildJoinRequestStatus }> {
  const { familyId, requestId, request, secret } = await loadBySecret(ctx, input);
  const status = await settleExpiry(ctx, familyId, requestId, request);
  if (status !== 'pending') {
    return { requestId, status };
  }

  const cancelled = await ctx.db.runTransaction(async transaction => {
    const snapshot = await transaction.get(requestRef(ctx, familyId, requestId));
    if (!snapshot.exists || (snapshot.data() as Record<string, unknown>).status !== 'pending') {
      return false;
    }
    transaction.update(requestRef(ctx, familyId, requestId), {
      status: 'cancelled' satisfies ChildJoinRequestStatus,
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: null,
    });
    return true;
  });

  if (cancelled) {
    await releaseReservation(ctx, familyId, String(secret.normalizedUsername ?? ''), requestId);
    await discardProvisionalAuthUser(ctx, secret.pendingAuthUid);
    await audit(ctx, familyId, {
      type: 'child_join_cancelled',
      requestId,
      normalizedUsername: secret.normalizedUsername ?? null,
      success: true,
    });
  }
  return { requestId, status: 'cancelled' };
}

// ---------------------------------------------------------------------------
// Parent authorization
// ---------------------------------------------------------------------------

async function assertParentOfFamily(
  ctx: ChildJoinContext,
  callerUid: string,
  familyId: string,
): Promise<void> {
  if (typeof callerUid !== 'string' || !callerUid) {
    throw httpError('permission-denied', 'NOT_AUTHORIZED');
  }
  if (typeof familyId !== 'string' || !familyId) {
    throw httpError('permission-denied', 'NOT_AUTHORIZED');
  }
  const snapshot = await ctx.db.doc(`${USERS}/${callerUid}`).get();
  if (!snapshot.exists) throw httpError('permission-denied', 'NOT_AUTHORIZED');
  const caller = snapshot.data() as Record<string, unknown>;
  if (caller.familyId !== familyId) throw httpError('permission-denied', 'NOT_AUTHORIZED');
  if (caller.role !== 'parent' && caller.role !== 'owner') {
    throw httpError('permission-denied', 'NOT_AUTHORIZED');
  }
}

// ---------------------------------------------------------------------------
// 4. approveChildJoinRequest (parent only, trusted)
// ---------------------------------------------------------------------------

export async function approveChildJoinRequestImpl(
  ctx: ChildJoinContext,
  callerUid: string,
  input: ResolveChildJoinRequestInput,
): Promise<{ requestId: string; childId: string; status: 'approved' }> {
  const familyId = String(input?.familyId ?? '');
  const requestId = String(input?.requestId ?? '');
  await assertParentOfFamily(ctx, callerUid, familyId);
  if (!REQUEST_ID.test(requestId)) throw httpError('not-found', 'JOIN_REQUEST_NOT_FOUND');

  const [requestSnap, secretSnap] = await Promise.all([
    requestRef(ctx, familyId, requestId).get(),
    secretRef(ctx, familyId, requestId).get(),
  ]);
  if (!requestSnap.exists || !secretSnap.exists) {
    throw httpError('not-found', 'JOIN_REQUEST_NOT_FOUND');
  }
  const request = requestSnap.data() as Record<string, unknown>;
  const secret = secretSnap.data() as Record<string, unknown>;

  if (request.status !== 'pending') throw httpError('failed-precondition', 'REQUEST_NOT_PENDING');
  const expiresAtMs = typeof request.expiresAtMs === 'number' ? request.expiresAtMs : 0;
  if (expiresAtMs <= nowMs(ctx)) {
    await expireRequest(ctx, familyId, requestId);
    throw httpError('failed-precondition', 'REQUEST_EXPIRED');
  }

  const normalizedUsername = String(secret.normalizedUsername ?? '');
  const pendingAuthUid = String(secret.pendingAuthUid ?? '');
  if (!normalizedUsername || !pendingAuthUid) {
    throw httpError('failed-precondition', 'REQUEST_INVALID');
  }

  const childId = ctx.db.collection(USERS).doc().id;
  const displayUsername = String(request.displayUsername ?? normalizedUsername);

  // --- Atomically claim the request + reservation --------------------------
  // Everything that must not happen twice is decided inside one transaction.
  await ctx.db.runTransaction(async transaction => {
    const liveRequest = await transaction.get(requestRef(ctx, familyId, requestId));
    if (!liveRequest.exists) throw httpError('not-found', 'JOIN_REQUEST_NOT_FOUND');
    if ((liveRequest.data() as Record<string, unknown>).status !== 'pending') {
      throw httpError('failed-precondition', 'REQUEST_NOT_PENDING');
    }
    const reservation = await transaction.get(indexRef(ctx, familyId, normalizedUsername));
    if (!reservation.exists) throw httpError('failed-precondition', 'RESERVATION_LOST');
    const held = reservation.data() as Record<string, unknown>;
    if (held.reservedByRequestId !== requestId) {
      throw httpError('failed-precondition', 'RESERVATION_LOST');
    }

    // Managed-child profile — identical shape to a parent-created child.
    transaction.set(ctx.db.doc(`${USERS}/${childId}`), {
      uid: childId,
      familyId,
      role: 'child',
      isManaged: true,
      displayName: displayUsername,
      avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(displayUsername)}`,
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastActiveDate: FieldValue.serverTimestamp(),
      // Managed-child login link (server-only fields).
      authUid: pendingAuthUid,
      hasLogin: true,
      username: displayUsername,
      loginEnabled: true,
      // The child chose this password themselves, so no forced change.
      requiresPasswordChange: false,
      joinRequestId: requestId,
      createdAt: FieldValue.serverTimestamp(),
    });

    transaction.set(ctx.db.doc(`${FAMILIES}/${familyId}/wallets/${childId}`), {
      balance: 0,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Finalize the reservation into the canonical index entry.
    transaction.set(indexRef(ctx, familyId, normalizedUsername), {
      childId,
      normalizedUsername,
      createdAt: FieldValue.serverTimestamp(),
    });

    transaction.set(ctx.db.doc(`${FAMILIES}/${familyId}/${CHILD_LOGINS}/${childId}`), {
      childId,
      username: displayUsername,
      normalizedUsername,
      syntheticEmail: secret.syntheticEmail,
      authUid: pendingAuthUid,
      familyId,
      status: 'enabled',
      requiresPasswordChange: false,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: callerUid,
      viaJoinRequestId: requestId,
    });

    transaction.update(requestRef(ctx, familyId, requestId), {
      status: 'approved' satisfies ChildJoinRequestStatus,
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: callerUid,
      childId,
    });
  });

  // --- Activate the Auth identity -----------------------------------------
  try {
    await ctx.auth.setCustomUserClaims(pendingAuthUid, {
      role: 'child',
      familyId,
      childId,
      managedChild: true,
    });
    await ctx.auth.updateUser(pendingAuthUid, { disabled: false });
  } catch {
    // Compensate: the child must not be left half-provisioned.
    await ctx.db.runTransaction(async transaction => {
      transaction.update(requestRef(ctx, familyId, requestId), {
        status: 'pending' satisfies ChildJoinRequestStatus,
        resolvedAt: null,
        resolvedBy: null,
        childId: null,
      });
      transaction.delete(ctx.db.doc(`${USERS}/${childId}`));
      transaction.delete(ctx.db.doc(`${FAMILIES}/${familyId}/wallets/${childId}`));
      transaction.delete(ctx.db.doc(`${FAMILIES}/${familyId}/${CHILD_LOGINS}/${childId}`));
      transaction.set(indexRef(ctx, familyId, normalizedUsername), {
        status: 'reserved',
        reservedByRequestId: requestId,
        normalizedUsername,
        expiresAtMs,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    await audit(ctx, familyId, {
      type: 'child_join_approval_compensated',
      requestId,
      actorId: callerUid,
      success: false,
    });
    throw httpError('internal', 'APPROVAL_FAILED');
  }

  await audit(ctx, familyId, {
    type: 'child_join_approved',
    requestId,
    childId,
    normalizedUsername,
    actorId: callerUid,
    success: true,
  });

  return { requestId, childId, status: 'approved' };
}

// ---------------------------------------------------------------------------
// 5. rejectChildJoinRequest (parent only, trusted)
// ---------------------------------------------------------------------------

export async function rejectChildJoinRequestImpl(
  ctx: ChildJoinContext,
  callerUid: string,
  input: ResolveChildJoinRequestInput,
): Promise<{ requestId: string; status: 'rejected' }> {
  const familyId = String(input?.familyId ?? '');
  const requestId = String(input?.requestId ?? '');
  await assertParentOfFamily(ctx, callerUid, familyId);
  if (!REQUEST_ID.test(requestId)) throw httpError('not-found', 'JOIN_REQUEST_NOT_FOUND');

  const [requestSnap, secretSnap] = await Promise.all([
    requestRef(ctx, familyId, requestId).get(),
    secretRef(ctx, familyId, requestId).get(),
  ]);
  if (!requestSnap.exists) throw httpError('not-found', 'JOIN_REQUEST_NOT_FOUND');
  const request = requestSnap.data() as Record<string, unknown>;
  const secret = (secretSnap.data() ?? {}) as Record<string, unknown>;
  if (request.status !== 'pending') throw httpError('failed-precondition', 'REQUEST_NOT_PENDING');

  await ctx.db.runTransaction(async transaction => {
    const live = await transaction.get(requestRef(ctx, familyId, requestId));
    if (!live.exists) throw httpError('not-found', 'JOIN_REQUEST_NOT_FOUND');
    if ((live.data() as Record<string, unknown>).status !== 'pending') {
      throw httpError('failed-precondition', 'REQUEST_NOT_PENDING');
    }
    transaction.update(requestRef(ctx, familyId, requestId), {
      status: 'rejected' satisfies ChildJoinRequestStatus,
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: callerUid,
    });
  });

  // No membership is ever created; release everything the request held.
  await releaseReservation(ctx, familyId, String(secret.normalizedUsername ?? ''), requestId);
  await discardProvisionalAuthUser(ctx, secret.pendingAuthUid);
  await audit(ctx, familyId, {
    type: 'child_join_rejected',
    requestId,
    normalizedUsername: secret.normalizedUsername ?? null,
    actorId: callerUid,
    success: true,
  });

  return { requestId, status: 'rejected' };
}

// ---------------------------------------------------------------------------
// 6. Scheduled expiry sweep
// ---------------------------------------------------------------------------

export async function purgeExpiredChildJoinRequestsImpl(
  ctx: ChildJoinContext,
): Promise<{ expired: number }> {
  const cutoff = nowMs(ctx);
  const snapshot = await ctx.db
    .collectionGroup(CHILD_JOIN_REQUESTS)
    .where('status', '==', 'pending')
    .where('expiresAtMs', '<=', cutoff)
    .limit(200)
    .get();

  let expired = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    const familyId = String(data.familyId ?? '');
    const requestId = String(data.requestId ?? doc.id);
    if (!familyId) continue;
    if (await expireRequest(ctx, familyId, requestId)) expired += 1;
  }
  return { expired };
}

// ---------------------------------------------------------------------------
// Callable wrappers
// ---------------------------------------------------------------------------

function productionContext(): ChildJoinContext {
  return { auth: getAuth(), db: getFirestore() };
}

function callerIp(request: CallableRequest<unknown>): string | undefined {
  const raw = request.rawRequest as { ip?: string; headers?: Record<string, unknown> } | undefined;
  const forwarded = raw?.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0]!.trim();
  return raw?.ip;
}

function requireUid(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (!uid) throw httpError('unauthenticated', 'AUTH_REQUIRED');
  return uid;
}

export const submitChildJoinRequest = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  request =>
    submitChildJoinRequestImpl(
      productionContext(),
      request.data as SubmitChildJoinRequestInput,
      { ip: callerIp(request) },
    ),
);

export const getChildJoinRequestStatus = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  request =>
    getChildJoinRequestStatusImpl(
      productionContext(),
      request.data as { requestId?: unknown; requestSecret?: unknown },
    ),
);

export const cancelChildJoinRequest = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  request =>
    cancelChildJoinRequestImpl(
      productionContext(),
      request.data as { requestId?: unknown; requestSecret?: unknown },
    ),
);

export const approveChildJoinRequest = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  request =>
    approveChildJoinRequestImpl(
      productionContext(),
      requireUid(request),
      request.data as ResolveChildJoinRequestInput,
    ),
);

export const rejectChildJoinRequest = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  request =>
    rejectChildJoinRequestImpl(
      productionContext(),
      requireUid(request),
      request.data as ResolveChildJoinRequestInput,
    ),
);

export const purgeExpiredChildJoinRequests = onSchedule(
  { region: 'europe-west1', schedule: 'every 60 minutes' },
  async () => {
    const result = await purgeExpiredChildJoinRequestsImpl(productionContext());
    console.log('[child-join] purge', JSON.stringify(result));
  },
);
