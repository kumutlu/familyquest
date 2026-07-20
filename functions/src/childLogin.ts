// ---------------------------------------------------------------------------
// FAMILYQUEST — PARENT-CREATED CHILD LOGIN (Phase 1, backend only)
// ---------------------------------------------------------------------------
//
// This module implements the trusted, server-side operations for letting a
// parent/owner create a Firebase Auth login for an EXISTING managed child
// profile, and for that child to later exchange (familyCode, username,
// password) for a Firebase custom token.
//
// IDENTITY-LINKING MODEL (critical invariants)
// --------------------------------------------
//  * The managed-child profile document (users/{childId}) already exists and
//    its document ID (childId) MUST NOT change. We never migrate wallet,
//    points, tasks, goals, rewards, behaviour events or history to a new UID.
//  * The Firebase Auth user is LINKED, never replaced:
//      - authUid  is written onto the EXISTING child profile (users/{childId})
//        as an internal linking field (NOT a public/display field).
//      - childId  is set as a custom claim on the Auth user, so the backend
//        always resolves identity from the claim, never from
//        request.auth.uid == childId (a managed child's Auth uid is a synthetic
//        account, distinct from any claimed/real account).
//  * The synthetic email is generated server-side and stored ONLY in the
//    server-owned private child-login record. It is NEVER returned to a client
//    and NEVER stored in any client-readable document.
//
// SECURITY CONTROLS
// -----------------
//  * All new collections are server-owned: clients are denied read/write by
//    Firestore Rules (allow read, write: if false). The Admin SDK bypasses
//    rules, so the trusted backend is the only writer.
//  * createChildLogin is callable only by an authenticated parent/owner of the
//    SAME family as the target child, and only for an active, managed child
//    that does not already have a login.
//  * Family-scoped username uniqueness is enforced atomically inside a
//    Firestore transaction (username index document).
//  * Deterministic idempotency is keyed by clientReqId; a replay with the same
//    clientReqId but a different payload is rejected.
//  * If Auth user creation succeeds but Firestore linking fails, the Auth user
//    is deleted (compensated) so no orphaned usable account remains.
//  * signInChild never exposes the synthetic email, returns a generic failure
//    for every error class, rate-limits server-side, and never logs the
//    plaintext password.
//
// FIREBASE ADMIN SDK LIMITATION (password verification)
// -----------------------------------------------------
// The Firebase Admin SDK has NO method to verify a user's password
// (there is no admin.auth().verifyPassword). To validate credentials
// server-side WITHOUT exposing the synthetic email to the client, signInChild
// resolves the synthetic email from the server-owned private record and calls
// the Identity Toolkit REST API `accounts:signInWithPassword` from the trusted
// backend. The email never leaves the server; only a custom token is returned.
// (See verifyPasswordViaAuthApi.) This is the secure path — we do NOT store the
// plaintext password, do NOT echo the email, and do NOT fall back to an
// insecure client-side check.
// ---------------------------------------------------------------------------

import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { getAuth, type Auth } from 'firebase-admin/auth';
import {
  getFirestore,
  FieldValue,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateChildLoginInput {
  childId: string;
  username: string;
  password: string;
  clientReqId: string;
  /**
   * Phase 4A: when true the child must change their password on first login.
   * Defaults safely to false when omitted (preserves existing callers).
   */
  requirePasswordChange?: boolean;
}

export interface CreateChildLoginResult {
  childId: string;
  username: string;
  loginEnabled: boolean;
  // authUid is intentionally OMITTED. It is linked server-side and must not be
  // returned to the client unless a future parent-admin UI strictly requires it.
}

export interface SignInChildInput {
  familyCode: string;
  username: string;
  password: string;
}

export interface SignInChildResult {
  customToken: string;
}

/** Pluggable password verifier (injected for tests; production uses Auth REST API). */
export type PasswordVerifier = (syntheticEmail: string, password: string) => Promise<boolean>;

/** Pluggable rate limiter. Returns true if the attempt is allowed. */
export type RateLimiter = (key: string) => boolean;

export interface ChildLoginContext {
  auth: Auth;
  db: Firestore;
  verifyPassword?: PasswordVerifier;
  rateLimiter?: RateLimiter;
  clock?: () => Date;
}

// ---------------------------------------------------------------------------
// Collection / field constants
// ---------------------------------------------------------------------------

const USERS = 'users';
const FAMILIES = 'families';
const CHILD_LOGIN_INDEX = 'childLoginIndex';
const CHILD_LOGINS = 'childLogins';
const CHILD_LOGIN_AUDIT = 'childLoginAudit';
const CHILD_LOGIN_IDEMPOTENCY = 'childLoginIdempotency';

// Public (client-readable) child-profile fields we maintain.
export const PUBLIC_LOGIN_FIELDS = ['hasLogin', 'username', 'loginEnabled', 'requiresPasswordChange'] as const;

// Fields a client must NEVER be able to set on a user document (server-only).
export const SERVER_ONLY_USER_FIELDS = [
  'hasLogin',
  'username',
  'loginEnabled',
  'requiresPasswordChange',
  'authUid',
] as const;

// Fields a client must never supply to createChildLogin (role-escalation guard).
const FORBIDDEN_CLIENT_FIELDS = [
  'role',
  'familyId',
  'managedChild',
  'authUid',
  'syntheticEmail',
  'claims',
  'customClaims',
  'isManaged',
] as const;

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable, no I/O)
// ---------------------------------------------------------------------------

/**
 * Deterministic username normalization. Lower-cases, trims, collapses internal
 * whitespace to a single space, and enforces an allowed character set. The
 * normalized form is what is stored and what uniqueness is enforced on.
 */
export function normalizeUsername(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new HttpsError('invalid-argument', 'USERNAME_REQUIRED');
  }
  const collapsed = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (collapsed.length < 3 || collapsed.length > 32) {
    throw new HttpsError('invalid-argument', 'USERNAME_LENGTH');
  }
  if (!/^[a-z0-9_ ]+$/.test(collapsed)) {
    throw new HttpsError('invalid-argument', 'USERNAME_CHARS');
  }
  return collapsed;
}

export interface PasswordCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Server-side password strength policy. Kept independent of any client check.
 */
export function validatePasswordStrength(
  password: unknown,
  normalizedUsername: string,
): PasswordCheck {
  if (typeof password !== 'string') return { ok: false, reason: 'PASSWORD_REQUIRED' };
  if (password.length < 8) return { ok: false, reason: 'PASSWORD_TOO_SHORT' };
  if (password.length > 128) return { ok: false, reason: 'PASSWORD_TOO_LONG' };
  if (!/[a-zA-Z]/.test(password)) return { ok: false, reason: 'PASSWORD_NEEDS_LETTER' };
  if (!/\d/.test(password)) return { ok: false, reason: 'PASSWORD_NEEDS_DIGIT' };
  if (password.toLowerCase() === normalizedUsername) {
    return { ok: false, reason: 'PASSWORD_SAME_AS_USERNAME' };
  }
  return { ok: true };
}

/**
 * Generate a globally-unique synthetic email. (familyId, normalizedUsername) is
 * unique, so this email is unique across all Auth users. Stored ONLY in the
 * server-owned private record.
 */
export function generateSyntheticEmail(familyId: string, normalizedUsername: string): string {
  const safeFamily = String(familyId).toLowerCase();
  const safeUser = normalizedUsername.replace(/ /g, '-');
  return `child-${safeFamily}-${safeUser}@managed.familyquest.app`;
}

/** Stable hash of the idempotency payload (childId + normalizedUsername). */
export function computePayloadHash(
  childId: string,
  normalizedUsername: string,
  extra = '',
): string {
  return createHash('sha256')
    .update(`${childId}|${normalizedUsername}|${extra}`)
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Context builder (production)
// ---------------------------------------------------------------------------

function isEmulator(): boolean {
  return (
    process.env.FUNCTIONS_EMULATOR === 'true' ||
    process.env.FIRESTORE_EMULATOR_HOST != null ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST != null
  );
}

export function makeContext(): ChildLoginContext {
  return {
    auth: getAuth(),
    db: getFirestore(),
    verifyPassword: verifyPasswordViaAuthApi,
    rateLimiter: makeInMemoryRateLimiter(),
  };
}

// ---------------------------------------------------------------------------
// Password verification via Identity Toolkit REST API (server-side only)
// ---------------------------------------------------------------------------

/**
 * Verify (email, password) against Firebase Auth using the Identity Toolkit
 * REST API. The synthetic email is resolved server-side from the private
 * record and is NEVER sent to the client. Returns true only on a 200 response.
 *
 * Admin SDK limitation: there is no admin.auth().verifyPassword. This REST call
 * is the secure substitute and keeps the email server-side.
 */
export async function verifyPasswordViaAuthApi(
  syntheticEmail: string,
  password: string,
): Promise<boolean> {
  const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const base = emulatorHost
    ? `http://${emulatorHost}/identitytoolkit.googleapis.com/v1`
    : 'https://identitytoolkit.googleapis.com/v1';
  // The auth emulator accepts any non-empty key; production requires the web API key.
  const apiKey = process.env.FIREBASE_WEB_API_KEY ?? 'emulator';
  const url = `${base}/accounts:signInWithPassword?key=${apiKey}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: syntheticEmail, password, returnSecureToken: true }),
    });
    return res.status === 200;
  } catch {
    // Network/transport failure => treat as invalid (generic failure path).
    return false;
  }
}

// ---------------------------------------------------------------------------
// In-memory rate limiter (Phase 1). Production should use a shared store.
// ---------------------------------------------------------------------------

export function makeInMemoryRateLimiter(
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000,
): RateLimiter {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const now = Date.now();
    const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= maxAttempts) {
      hits.set(key, arr);
      return false;
    }
    arr.push(now);
    hits.set(key, arr);
    return true;
  };
}

// ---------------------------------------------------------------------------
// Shared errors
// ---------------------------------------------------------------------------

function httpError(code: string, message: string): HttpsError {
  return new HttpsError(code as any, message);
}

// Generic failure for signInChild — never reveals which step failed.
function throwGenericLoginFailure(): never {
  throw new HttpsError('invalid-argument', 'INVALID_CREDENTIALS');
}

// ---------------------------------------------------------------------------
// createChildLogin
// ---------------------------------------------------------------------------

export async function createChildLoginImpl(
  ctx: ChildLoginContext,
  callerUid: string,
  data: CreateChildLoginInput,
): Promise<CreateChildLoginResult> {
  // --- Input validation + role-escalation guard -------------------------
  if (!data || typeof data !== 'object') {
    throw httpError('invalid-argument', 'BAD_REQUEST');
  }
  for (const forbidden of FORBIDDEN_CLIENT_FIELDS) {
    if (forbidden in (data as unknown as Record<string, unknown>)) {
      throw httpError('invalid-argument', 'UNEXPECTED_FIELD');
    }
  }
  if (typeof data.childId !== 'string' || !data.childId) {
    throw httpError('invalid-argument', 'CHILD_ID_REQUIRED');
  }
  if (typeof data.clientReqId !== 'string' || !data.clientReqId) {
    throw httpError('invalid-argument', 'CLIENT_REQ_ID_REQUIRED');
  }

  // Phase 4A: accept requiresPasswordChange (defaults safely to false). It is
  // persisted to the child profile + private login record and included in the
  // idempotency payload hash so a replay with a different flag is rejected.
  const requiresPasswordChange =
    typeof data.requirePasswordChange === 'boolean' ? data.requirePasswordChange : false;

  const normalizedUsername = normalizeUsername(data.username);
  const pw = validatePasswordStrength(data.password, normalizedUsername);
  if (!pw.ok) {
    throw httpError('invalid-argument', pw.reason ?? 'WEAK_PASSWORD');
  }

  const { db, auth } = ctx;
  const childRef = db.doc(`${USERS}/${data.childId}`);

  // --- Precheck transaction: authz + eligibility + idempotency + index -----
  const pre = await db.runTransaction(async (t: Transaction) => {
    const callerSnap = await t.get(db.doc(`${USERS}/${callerUid}`));
    if (!callerSnap.exists) throw httpError('permission-denied', 'CALLER_NOT_FOUND');
    const caller = callerSnap.data() as Record<string, unknown>;
    const callerFamilyId = caller.familyId;
    const callerRole = caller.role;
    if (
      typeof callerFamilyId !== 'string' ||
      (callerRole !== 'owner' && callerRole !== 'parent')
    ) {
      throw httpError('permission-denied', 'NOT_AUTHORIZED');
    }

    const familyId = callerFamilyId as string;

    // Idempotency check FIRST. A completed request with the same clientReqId
    // must return the cached result even though the child already has a login
    // (which it will, on a retry). This MUST precede the child login-status
    // check below, otherwise a retry would be rejected as LOGIN_ALREADY_EXISTS
    // before the cached result can be returned.
    const idemRefReal = db.doc(
      `${FAMILIES}/${familyId}/${CHILD_LOGIN_IDEMPOTENCY}/${data.clientReqId}`,
    );
    const idemSnap = await t.get(idemRefReal);
    if (idemSnap.exists) {
      const d = idemSnap.data() as Record<string, unknown>;
      // A replay with the SAME clientReqId but a DIFFERENT payload (childId or
      // normalized username) is always rejected, even if the first attempt
      // already completed. This prevents a caller from reusing a clientReqId to
      // target a different child.
      const payloadHash = computePayloadHash(
        data.childId,
        normalizedUsername,
        String(requiresPasswordChange),
      );
      if (d.payloadHash !== payloadHash) {
        return { kind: 'replayMismatch' as const };
      }
      if (d.status === 'completed') {
        return { kind: 'done' as const, result: d.result as CreateChildLoginResult };
      }
      // processing/failed with same payload => allow retry
    } else {
      t.set(idemRefReal, {
        clientReqId: data.clientReqId,
        operation: 'createChildLogin',
        payloadHash: computePayloadHash(
          data.childId,
          normalizedUsername,
          String(requiresPasswordChange),
        ),
        status: 'processing',
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    const childSnap = await t.get(childRef);
    if (!childSnap.exists) throw httpError('not-found', 'CHILD_NOT_FOUND');
    const child = childSnap.data() as Record<string, unknown>;
    if (child.familyId !== familyId) {
      throw httpError('permission-denied', 'CHILD_NOT_IN_FAMILY');
    }
    if (child.role !== 'child' || child.isManaged !== true) {
      throw httpError('failed-precondition', 'CHILD_NOT_MANAGED');
    }
    if (child.hasLogin === true || child.authUid) {
      throw httpError('already-exists', 'LOGIN_ALREADY_EXISTS');
    }

    const indexRef = db.doc(
      `${FAMILIES}/${familyId}/${CHILD_LOGIN_INDEX}/${normalizedUsername}`,
    );
    const indexSnap = await t.get(indexRef);
    if (indexSnap.exists) throw httpError('already-exists', 'USERNAME_TAKEN');

    return { kind: 'proceed' as const, familyId };
  });

  if (pre.kind === 'done') return pre.result;
  if (pre.kind === 'replayMismatch') {
    throw httpError('already-exists', 'CLIENT_REQ_ID_REPLAY_MISMATCH');
  }
  const familyId = pre.familyId;

  // --- Create the Firebase Auth user (synthetic) --------------------------
  const syntheticEmail = generateSyntheticEmail(familyId, normalizedUsername);
  const childDisplayName = await getChildDisplayName(ctx, data.childId);
  let authUid: string;
  try {
    const userRecord = await auth.createUser({
      email: syntheticEmail,
      password: data.password,
      displayName: childDisplayName,
      disabled: false,
    });
    authUid = userRecord.uid;
  } catch (err) {
    // Creation failed before/at user creation. Leave idempotency as processing
    // so a same-payload retry is permitted. Best-effort cleanup.
    try {
      const partial = (err as { uid?: string })?.uid;
      if (partial) await auth.deleteUser(partial);
    } catch {
      /* ignore */
    }
    throw httpError('internal', 'AUTH_CREATE_FAILED');
  }

  // --- Set custom claims (identity link back to the managed child) --------
  try {
    await auth.setCustomUserClaims(authUid, {
      role: 'child',
      familyId,
      childId: data.childId,
      managedChild: true,
    });
  } catch (claimErr) {
    try {
      await auth.deleteUser(authUid);
    } catch {
      /* ignore */
    }
    throw httpError('internal', 'CLAIMS_FAILED');
  }

  // --- Link in Firestore (atomic) -----------------------------------------
  const indexRef = db.doc(
    `${FAMILIES}/${familyId}/${CHILD_LOGIN_INDEX}/${normalizedUsername}`,
  );
  const privateRef = db.doc(`${FAMILIES}/${familyId}/${CHILD_LOGINS}/${data.childId}`);
  const auditRef = db.doc(
    `${FAMILIES}/${familyId}/${CHILD_LOGIN_AUDIT}/${db.collection('x').doc().id}`,
  );
  const idemRefReal = db.doc(
    `${FAMILIES}/${familyId}/${CHILD_LOGIN_IDEMPOTENCY}/${data.clientReqId}`,
  );

  try {
    await db.runTransaction(async (t: Transaction) => {
      const childSnap = await t.get(childRef);
      const child = childSnap.data() as Record<string, unknown>;
      if (child.hasLogin === true || child.authUid) {
        throw httpError('already-exists', 'LOGIN_ALREADY_EXISTS');
      }
      const indexSnap = await t.get(indexRef);
      if (indexSnap.exists) throw httpError('already-exists', 'USERNAME_TAKEN');

      t.set(indexRef, {
        childId: data.childId,
        normalizedUsername,
        createdAt: FieldValue.serverTimestamp(),
      });
      t.set(privateRef, {
        childId: data.childId,
        username: data.username,
        normalizedUsername,
        syntheticEmail,
        authUid,
        familyId,
        status: 'enabled',
        requiresPasswordChange,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: callerUid,
      });
      t.update(childRef, {
        authUid,
        hasLogin: true,
        username: data.username,
        loginEnabled: true,
        requiresPasswordChange,
      });
      t.set(auditRef, {
        type: 'login_created',
        childId: data.childId,
        username: data.username,
        normalizedUsername,
        actorId: callerUid,
        success: true,
        createdAt: FieldValue.serverTimestamp(),
        clientReqId: data.clientReqId,
      });
      t.update(idemRefReal, {
        status: 'completed',
        result: { childId: data.childId, username: data.username, loginEnabled: true },
        authUid,
        completedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (linkErr) {
    // COMPENSATION: Auth user was created but Firestore linking failed. Delete
    // the Auth user so no orphaned usable account remains, and record the
    // compensation in the audit log.
    try {
      await auth.deleteUser(authUid);
    } catch {
      /* ignore */
    }
    try {
      await db
        .collection(`${FAMILIES}/${familyId}/${CHILD_LOGIN_AUDIT}`)
        .add({
          type: 'login_compensation',
          childId: data.childId,
          username: data.username,
          normalizedUsername,
          actorId: callerUid,
          success: false,
          reason: 'linking_failed',
          createdAt: FieldValue.serverTimestamp(),
          clientReqId: data.clientReqId,
        });
    } catch {
      /* ignore */
    }
    try {
      await idemRefReal.update({ status: 'failed', failedAt: FieldValue.serverTimestamp() });
    } catch {
      /* ignore */
    }
    throw linkErr;
  }

  // Success — omit authUid and syntheticEmail from the response.
  return { childId: data.childId, username: data.username, loginEnabled: true };
}

// Helper to read the child's display name for the Auth user (best-effort).
async function getChildDisplayName(ctx: ChildLoginContext, childId: string): Promise<string> {
  try {
    const snap = await ctx.db.doc(`${USERS}/${childId}`).get();
    const d = snap.data() as Record<string, unknown> | undefined;
    if (d && typeof d.displayName === 'string' && d.displayName) return d.displayName;
  } catch {
    /* ignore */
  }
  return 'Child';
}

// ---------------------------------------------------------------------------
// signInChild
// ---------------------------------------------------------------------------

export async function signInChildImpl(
  ctx: ChildLoginContext,
  data: SignInChildInput,
  meta: { ip?: string } = {},
): Promise<SignInChildResult> {
  // --- Input validation --------------------------------------------------
  if (!data || typeof data !== 'object') throwGenericLoginFailure();
  const familyCode = typeof data.familyCode === 'string' ? data.familyCode : '';
  const usernameRaw = typeof data.username === 'string' ? data.username : '';
  const password = typeof data.password === 'string' ? data.password : '';
  if (!familyCode || !usernameRaw || !password) throwGenericLoginFailure();

  let normalizedUsername: string;
  try {
    normalizedUsername = normalizeUsername(usernameRaw);
  } catch {
    throwGenericLoginFailure();
  }

  const { db, auth } = ctx;

  // --- Server-side rate limiting -----------------------------------------
  const limiter = ctx.rateLimiter ?? makeInMemoryRateLimiter();
  const rlKey = `${familyCode}:${normalizedUsername}`;
  const rlKeyIp = `${meta.ip ?? 'noip'}:${familyCode}:${normalizedUsername}`;
  if (!limiter(rlKey) || !limiter(rlKeyIp)) {
    await auditSignInAttempt(ctx, familyCode, normalizedUsername, false, 'rate_limited');
    throwGenericLoginFailure();
  }

  // --- Resolve the private record (server-owned) -------------------------
  const indexRef = db.doc(
    `${FAMILIES}/${familyCode}/${CHILD_LOGIN_INDEX}/${normalizedUsername}`,
  );
  const indexSnap = await indexRef.get();
  if (!indexSnap.exists) {
    await auditSignInAttempt(ctx, familyCode, normalizedUsername, false, 'no_user');
    throwGenericLoginFailure();
  }
  const childId = (indexSnap.data() as Record<string, unknown>).childId as string;

  const privateRef = db.doc(`${FAMILIES}/${familyCode}/${CHILD_LOGINS}/${childId}`);
  const privateSnap = await privateRef.get();
  if (!privateSnap.exists) {
    await auditSignInAttempt(ctx, familyCode, normalizedUsername, false, 'no_record');
    throwGenericLoginFailure();
  }
  const priv = privateSnap.data() as Record<string, unknown>;
  if (priv.status !== 'enabled') {
    await auditSignInAttempt(ctx, familyCode, normalizedUsername, false, 'disabled_login');
    throwGenericLoginFailure();
  }
  const syntheticEmail = priv.syntheticEmail as string;
  const authUid = priv.authUid as string;
  const familyId = priv.familyId as string;

  // --- Login mapping consistency + Firebase Auth disabled check -----------
  // A disabled child must never obtain a custom token. We reject with the same
  // generic error for every failure class so no condition is revealed.
  if (priv.childId !== childId || typeof authUid !== 'string' || !authUid) {
    await auditSignInAttempt(ctx, familyCode, normalizedUsername, false, 'mapping_inconsistent');
    throwGenericLoginFailure();
  }
  let authUser;
  try {
    authUser = await auth.getUser(authUid);
  } catch {
    await auditSignInAttempt(ctx, familyCode, normalizedUsername, false, 'auth_lookup_failed');
    throwGenericLoginFailure();
  }
  if (authUser.disabled) {
    await auditSignInAttempt(ctx, familyCode, normalizedUsername, false, 'auth_disabled');
    throwGenericLoginFailure();
  }

  // --- Child must still be active & managed ------------------------------
  const childSnap = await db.doc(`${USERS}/${childId}`).get();
  if (!childSnap.exists) {
    await auditSignInAttempt(ctx, familyCode, normalizedUsername, false, 'no_child');
    throwGenericLoginFailure();
  }
  const child = childSnap.data() as Record<string, unknown>;
  if (
    child.familyId !== familyId ||
    child.role !== 'child' ||
    child.isManaged !== true ||
    child.disabled === true ||
    child.status === 'deleted'
  ) {
    await auditSignInAttempt(ctx, familyCode, normalizedUsername, false, 'child_ineligible');
    throwGenericLoginFailure();
  }

  // --- Verify password (server-side, email stays server-side) ------------
  const verify = ctx.verifyPassword ?? verifyPasswordViaAuthApi;
  const ok = await verify(syntheticEmail, password);
  if (!ok) {
    await auditSignInAttempt(ctx, familyCode, normalizedUsername, false, 'bad_password');
    throwGenericLoginFailure();
  }

  // --- Mint a custom token ------------------------------------------------
  let customToken: string;
  try {
    customToken = await auth.createCustomToken(authUid, {
      role: 'child',
      familyId,
      childId,
      managedChild: true,
    });
  } catch {
    await auditSignInAttempt(ctx, familyCode, normalizedUsername, false, 'token_failed');
    throwGenericLoginFailure();
  }

  await auditSignInAttempt(ctx, familyCode, normalizedUsername, true, 'success');
  return { customToken };
}

async function auditSignInAttempt(
  ctx: ChildLoginContext,
  familyCode: string,
  normalizedUsername: string,
  success: boolean,
  reason: string,
): Promise<void> {
  try {
    await ctx.db
      .collection(`${FAMILIES}/${familyCode}/${CHILD_LOGIN_AUDIT}`)
      .add({
        type: success ? 'login_signin_success' : 'login_signin_failure',
        familyCode,
        normalizedUsername,
        success,
        reason,
        // NOTE: password is NEVER stored.
        createdAt: FieldValue.serverTimestamp(),
      });
  } catch {
    /* audit failures must not break the sign-in response */
  }
}

// ---------------------------------------------------------------------------
// Phase 4A — Managed child login lifecycle (trusted backend operations)
// ---------------------------------------------------------------------------
// All operations below are callable-only and run with the Admin SDK. They
// enforce same-family parent/owner authorization, atomic Firestore updates,
// deterministic idempotency, immutable audit events, and never expose the
// synthetic email or authUid to clients. Passwords are never logged or returned.
// ---------------------------------------------------------------------------

export interface ResetChildPasswordInput {
  childId: string;
  newPassword: string;
  requirePasswordChange?: boolean;
  clientReqId: string;
}

export interface ResetChildPasswordResult {
  childId: string;
  username: string;
  loginEnabled: boolean;
  requiresPasswordChange: boolean;
}

export interface DisableChildLoginInput {
  childId: string;
  clientReqId: string;
}

export interface DisableChildLoginResult {
  childId: string;
  loginEnabled: boolean;
}

export interface EnableChildLoginInput {
  childId: string;
  clientReqId: string;
}

export interface EnableChildLoginResult {
  childId: string;
  loginEnabled: boolean;
}

export interface RevokeChildSessionsInput {
  childId: string;
  clientReqId: string;
}

export interface RevokeChildSessionsResult {
  childId: string;
  success: boolean;
}

export interface ChangeChildUsernameInput {
  childId: string;
  newUsername: string;
  clientReqId: string;
}

export interface ChangeChildUsernameResult {
  childId: string;
  username: string;
  loginEnabled: boolean;
  requiresPasswordChange: boolean;
}

export interface CompleteChildPasswordChangeInput {
  currentPassword: string;
  newPassword: string;
  clientReqId: string;
}

export interface CompleteChildPasswordChangeResult {
  success: boolean;
}

// --- Shared lifecycle helpers ----------------------------------------------

/** Hash a secret (password) for inclusion in an idempotency payload hash. */
function hashSecret(value: string): string {
  return createHash('sha256').update(`secret:${value}`).digest('hex');
}

/** Stable hash of a lifecycle operation's idempotency payload. */
export function computeLifecyclePayloadHash(operation: string, fields: string[]): string {
  return createHash('sha256')
    .update(`${operation}|${fields.join('|')}`)
    .digest('hex');
}

async function requireParentOrOwner(
  ctx: ChildLoginContext,
  callerUid: string,
): Promise<{ familyId: string; role: string }> {
  const snap = await ctx.db.doc(`${USERS}/${callerUid}`).get();
  if (!snap.exists) throw httpError('permission-denied', 'CALLER_NOT_FOUND');
  const caller = snap.data() as Record<string, unknown>;
  const familyId = caller.familyId;
  const role = caller.role;
  if (typeof familyId !== 'string' || (role !== 'owner' && role !== 'parent')) {
    throw httpError('permission-denied', 'NOT_AUTHORIZED');
  }
  return { familyId, role: role as string };
}

function assertChildActive(child: Record<string, unknown>): void {
  if (child.role !== 'child' || child.isManaged !== true) {
    throw httpError('failed-precondition', 'CHILD_NOT_MANAGED');
  }
  if (child.disabled === true || child.status === 'deleted') {
    throw httpError('failed-precondition', 'CHILD_INACTIVE');
  }
}

async function resolveManagedChildWithLogin(
  ctx: ChildLoginContext,
  familyId: string,
  childId: string,
): Promise<{ child: Record<string, unknown>; priv: Record<string, unknown>; authUid: string }> {
  const childSnap = await ctx.db.doc(`${USERS}/${childId}`).get();
  if (!childSnap.exists) throw httpError('not-found', 'CHILD_NOT_FOUND');
  const child = childSnap.data() as Record<string, unknown>;
  if (child.familyId !== familyId) throw httpError('permission-denied', 'CHILD_NOT_IN_FAMILY');
  assertChildActive(child);
  const privateSnap = await ctx.db
    .doc(`${FAMILIES}/${familyId}/${CHILD_LOGINS}/${childId}`)
    .get();
  if (!privateSnap.exists) throw httpError('failed-precondition', 'NO_LOGIN_LINK');
  const priv = privateSnap.data() as Record<string, unknown>;
  const authUid = priv.authUid as string;
  if (typeof authUid !== 'string' || !authUid) {
    throw httpError('failed-precondition', 'NO_LOGIN_LINK');
  }
  return { child, priv, authUid };
}

async function writeAudit(
  ctx: ChildLoginContext,
  familyId: string,
  entry: Record<string, unknown>,
): Promise<void> {
  try {
    await ctx.db
      .collection(`${FAMILIES}/${familyId}/${CHILD_LOGIN_AUDIT}`)
      .add({ ...entry, createdAt: FieldValue.serverTimestamp() });
  } catch {
    /* audit failures must not break the operation */
  }
}

type IdemResult =
  | { kind: 'done'; result: unknown }
  | { kind: 'replayMismatch' }
  | { kind: 'proceed' };

async function lifecycleIdempotencyPrecheck(
  ctx: ChildLoginContext,
  familyId: string,
  clientReqId: string,
  operation: string,
  payloadHash: string,
): Promise<IdemResult> {
  return ctx.db.runTransaction(async (t: Transaction) => {
    const idemRef = ctx.db.doc(
      `${FAMILIES}/${familyId}/${CHILD_LOGIN_IDEMPOTENCY}/${clientReqId}`,
    );
    const snap = await t.get(idemRef);
    if (snap.exists) {
      const d = snap.data() as Record<string, unknown>;
      if (d.payloadHash !== payloadHash) return { kind: 'replayMismatch' };
      if (d.status === 'completed') return { kind: 'done', result: d.result };
    } else {
      t.set(idemRef, {
        clientReqId,
        operation,
        payloadHash,
        status: 'processing',
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    return { kind: 'proceed' };
  });
}

async function markIdempotencyCompleted(
  ctx: ChildLoginContext,
  familyId: string,
  clientReqId: string,
  result: unknown,
): Promise<void> {
  await ctx.db
    .doc(`${FAMILIES}/${familyId}/${CHILD_LOGIN_IDEMPOTENCY}/${clientReqId}`)
    .update({
      status: 'completed',
      result,
      completedAt: FieldValue.serverTimestamp(),
    });
}

// --- 1. resetChildPassword --------------------------------------------------

export async function resetChildPasswordImpl(
  ctx: ChildLoginContext,
  callerUid: string,
  data: ResetChildPasswordInput,
): Promise<ResetChildPasswordResult> {
  if (!data || typeof data !== 'object') throw httpError('invalid-argument', 'BAD_REQUEST');
  if (typeof data.childId !== 'string' || !data.childId) {
    throw httpError('invalid-argument', 'CHILD_ID_REQUIRED');
  }
  if (typeof data.clientReqId !== 'string' || !data.clientReqId) {
    throw httpError('invalid-argument', 'CLIENT_REQ_ID_REQUIRED');
  }
  const requiresPasswordChange =
    typeof data.requirePasswordChange === 'boolean' ? data.requirePasswordChange : true;

  const { familyId } = await requireParentOrOwner(ctx, callerUid);
  const { priv, authUid } = await resolveManagedChildWithLogin(ctx, familyId, data.childId);

  const normalizedUsername = priv.normalizedUsername as string;
  const pw = validatePasswordStrength(data.newPassword, normalizedUsername);
  if (!pw.ok) throw httpError('invalid-argument', pw.reason ?? 'WEAK_PASSWORD');

  const payloadHash = computeLifecyclePayloadHash('resetChildPassword', [
    data.childId,
    String(requiresPasswordChange),
    hashSecret(data.newPassword),
  ]);
  const pre = await lifecycleIdempotencyPrecheck(
    ctx,
    familyId,
    data.clientReqId,
    'resetChildPassword',
    payloadHash,
  );
  if (pre.kind === 'done') return pre.result as ResetChildPasswordResult;
  if (pre.kind === 'replayMismatch') {
    throw httpError('already-exists', 'CLIENT_REQ_ID_REPLAY_MISMATCH');
  }

  try {
    await ctx.auth.updateUser(authUid, { password: data.newPassword });
  } catch {
    throw httpError('internal', 'AUTH_UPDATE_FAILED');
  }
  try {
    await ctx.auth.revokeRefreshTokens(authUid);
  } catch {
    /* best-effort */
  }

  const privateRef = ctx.db.doc(`${FAMILIES}/${familyId}/${CHILD_LOGINS}/${data.childId}`);
  const childRef = ctx.db.doc(`${USERS}/${data.childId}`);
  await privateRef.update({ requiresPasswordChange, updatedAt: FieldValue.serverTimestamp() });
  await childRef.update({ requiresPasswordChange, updatedAt: FieldValue.serverTimestamp() });

  const result: ResetChildPasswordResult = {
    childId: data.childId,
    username: priv.username as string,
    loginEnabled: priv.status === 'enabled',
    requiresPasswordChange,
  };
  await markIdempotencyCompleted(ctx, familyId, data.clientReqId, result);
  await writeAudit(ctx, familyId, {
    type: 'password_reset',
    childId: data.childId,
    actorId: callerUid,
    success: true,
    requiresPasswordChange,
    clientReqId: data.clientReqId,
  });
  return result;
}

// --- 2. disableChildLogin ---------------------------------------------------

export async function disableChildLoginImpl(
  ctx: ChildLoginContext,
  callerUid: string,
  data: DisableChildLoginInput,
): Promise<DisableChildLoginResult> {
  if (!data || typeof data !== 'object') throw httpError('invalid-argument', 'BAD_REQUEST');
  if (typeof data.childId !== 'string' || !data.childId) {
    throw httpError('invalid-argument', 'CHILD_ID_REQUIRED');
  }
  if (typeof data.clientReqId !== 'string' || !data.clientReqId) {
    throw httpError('invalid-argument', 'CLIENT_REQ_ID_REQUIRED');
  }

  const { familyId } = await requireParentOrOwner(ctx, callerUid);
  const { authUid } = await resolveManagedChildWithLogin(ctx, familyId, data.childId);

  const payloadHash = computeLifecyclePayloadHash('disableChildLogin', [data.childId]);
  const pre = await lifecycleIdempotencyPrecheck(
    ctx,
    familyId,
    data.clientReqId,
    'disableChildLogin',
    payloadHash,
  );
  if (pre.kind === 'done') return pre.result as DisableChildLoginResult;
  if (pre.kind === 'replayMismatch') {
    throw httpError('already-exists', 'CLIENT_REQ_ID_REPLAY_MISMATCH');
  }

  try {
    await ctx.auth.updateUser(authUid, { disabled: true });
  } catch {
    throw httpError('internal', 'AUTH_DISABLE_FAILED');
  }
  try {
    await ctx.auth.revokeRefreshTokens(authUid);
  } catch {
    /* best-effort */
  }

  const privateRef = ctx.db.doc(`${FAMILIES}/${familyId}/${CHILD_LOGINS}/${data.childId}`);
  const childRef = ctx.db.doc(`${USERS}/${data.childId}`);
  await privateRef.update({
    status: 'disabled',
    loginEnabled: false,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await childRef.update({ loginEnabled: false, updatedAt: FieldValue.serverTimestamp() });

  const result: DisableChildLoginResult = { childId: data.childId, loginEnabled: false };
  await markIdempotencyCompleted(ctx, familyId, data.clientReqId, result);
  await writeAudit(ctx, familyId, {
    type: 'login_disabled',
    childId: data.childId,
    actorId: callerUid,
    success: true,
    clientReqId: data.clientReqId,
  });
  return result;
}

// --- 3. enableChildLogin ----------------------------------------------------

export async function enableChildLoginImpl(
  ctx: ChildLoginContext,
  callerUid: string,
  data: EnableChildLoginInput,
): Promise<EnableChildLoginResult> {
  if (!data || typeof data !== 'object') throw httpError('invalid-argument', 'BAD_REQUEST');
  if (typeof data.childId !== 'string' || !data.childId) {
    throw httpError('invalid-argument', 'CHILD_ID_REQUIRED');
  }
  if (typeof data.clientReqId !== 'string' || !data.clientReqId) {
    throw httpError('invalid-argument', 'CLIENT_REQ_ID_REQUIRED');
  }

  const { familyId } = await requireParentOrOwner(ctx, callerUid);
  const { child, authUid } = await resolveManagedChildWithLogin(ctx, familyId, data.childId);
  assertChildActive(child);

  const payloadHash = computeLifecyclePayloadHash('enableChildLogin', [data.childId]);
  const pre = await lifecycleIdempotencyPrecheck(
    ctx,
    familyId,
    data.clientReqId,
    'enableChildLogin',
    payloadHash,
  );
  if (pre.kind === 'done') return pre.result as EnableChildLoginResult;
  if (pre.kind === 'replayMismatch') {
    throw httpError('already-exists', 'CLIENT_REQ_ID_REPLAY_MISMATCH');
  }

  try {
    await ctx.auth.updateUser(authUid, { disabled: false });
  } catch {
    throw httpError('internal', 'AUTH_ENABLE_FAILED');
  }

  const privateRef = ctx.db.doc(`${FAMILIES}/${familyId}/${CHILD_LOGINS}/${data.childId}`);
  const childRef = ctx.db.doc(`${USERS}/${data.childId}`);
  await privateRef.update({
    status: 'enabled',
    loginEnabled: true,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await childRef.update({ loginEnabled: true, updatedAt: FieldValue.serverTimestamp() });

  const result: EnableChildLoginResult = { childId: data.childId, loginEnabled: true };
  await markIdempotencyCompleted(ctx, familyId, data.clientReqId, result);
  await writeAudit(ctx, familyId, {
    type: 'login_enabled',
    childId: data.childId,
    actorId: callerUid,
    success: true,
    clientReqId: data.clientReqId,
  });
  return result;
}

// --- 4. revokeChildSessions -------------------------------------------------

export async function revokeChildSessionsImpl(
  ctx: ChildLoginContext,
  callerUid: string,
  data: RevokeChildSessionsInput,
): Promise<RevokeChildSessionsResult> {
  if (!data || typeof data !== 'object') throw httpError('invalid-argument', 'BAD_REQUEST');
  if (typeof data.childId !== 'string' || !data.childId) {
    throw httpError('invalid-argument', 'CHILD_ID_REQUIRED');
  }
  if (typeof data.clientReqId !== 'string' || !data.clientReqId) {
    throw httpError('invalid-argument', 'CLIENT_REQ_ID_REQUIRED');
  }

  const { familyId } = await requireParentOrOwner(ctx, callerUid);
  const { authUid } = await resolveManagedChildWithLogin(ctx, familyId, data.childId);

  const payloadHash = computeLifecyclePayloadHash('revokeChildSessions', [data.childId]);
  const pre = await lifecycleIdempotencyPrecheck(
    ctx,
    familyId,
    data.clientReqId,
    'revokeChildSessions',
    payloadHash,
  );
  if (pre.kind === 'done') return pre.result as RevokeChildSessionsResult;
  if (pre.kind === 'replayMismatch') {
    throw httpError('already-exists', 'CLIENT_REQ_ID_REPLAY_MISMATCH');
  }

  try {
    await ctx.auth.revokeRefreshTokens(authUid);
  } catch {
    throw httpError('internal', 'AUTH_REVOKE_FAILED');
  }

  const result: RevokeChildSessionsResult = { childId: data.childId, success: true };
  await markIdempotencyCompleted(ctx, familyId, data.clientReqId, result);
  await writeAudit(ctx, familyId, {
    type: 'sessions_revoked',
    childId: data.childId,
    actorId: callerUid,
    success: true,
    clientReqId: data.clientReqId,
  });
  return result;
}

// --- 5. changeChildUsername -------------------------------------------------

export async function changeChildUsernameImpl(
  ctx: ChildLoginContext,
  callerUid: string,
  data: ChangeChildUsernameInput,
): Promise<ChangeChildUsernameResult> {
  if (!data || typeof data !== 'object') throw httpError('invalid-argument', 'BAD_REQUEST');
  if (typeof data.childId !== 'string' || !data.childId) {
    throw httpError('invalid-argument', 'CHILD_ID_REQUIRED');
  }
  if (typeof data.clientReqId !== 'string' || !data.clientReqId) {
    throw httpError('invalid-argument', 'CLIENT_REQ_ID_REQUIRED');
  }

  const { familyId } = await requireParentOrOwner(ctx, callerUid);
  const { priv, authUid } = await resolveManagedChildWithLogin(ctx, familyId, data.childId);

  const normalizedNewUsername = normalizeUsername(data.newUsername);
  const oldNormalized = priv.normalizedUsername as string;
  const oldSyntheticEmail = priv.syntheticEmail as string;
  const newSyntheticEmail = generateSyntheticEmail(familyId, normalizedNewUsername);

  const payloadHash = computeLifecyclePayloadHash('changeChildUsername', [
    data.childId,
    normalizedNewUsername,
  ]);
  const pre = await lifecycleIdempotencyPrecheck(
    ctx,
    familyId,
    data.clientReqId,
    'changeChildUsername',
    payloadHash,
  );
  if (pre.kind === 'done') return pre.result as ChangeChildUsernameResult;
  if (pre.kind === 'replayMismatch') {
    throw httpError('already-exists', 'CLIENT_REQ_ID_REPLAY_MISMATCH');
  }

  // No-op when the normalized username is unchanged: keep indexes/records
  // consistent and return the current safe state.
  if (normalizedNewUsername === oldNormalized) {
    const noopResult: ChangeChildUsernameResult = {
      childId: data.childId,
      username: data.newUsername,
      loginEnabled: priv.status === 'enabled',
      requiresPasswordChange: priv.requiresPasswordChange === true,
    };
    await markIdempotencyCompleted(ctx, familyId, data.clientReqId, noopResult);
    await writeAudit(ctx, familyId, {
      type: 'username_change',
      childId: data.childId,
      actorId: callerUid,
      success: true,
      unchanged: true,
      clientReqId: data.clientReqId,
    });
    return noopResult;
  }

  // Update the Auth email FIRST so a Firestore failure can be compensated by
  // reverting the Auth email (keeps the synthetic email consistent everywhere).
  try {
    await ctx.auth.updateUser(authUid, { email: newSyntheticEmail });
  } catch {
    throw httpError('internal', 'AUTH_EMAIL_UPDATE_FAILED');
  }

  const newIndexRef = ctx.db.doc(
    `${FAMILIES}/${familyId}/${CHILD_LOGIN_INDEX}/${normalizedNewUsername}`,
  );
  const oldIndexRef = ctx.db.doc(
    `${FAMILIES}/${familyId}/${CHILD_LOGIN_INDEX}/${oldNormalized}`,
  );
  const privateRef = ctx.db.doc(`${FAMILIES}/${familyId}/${CHILD_LOGINS}/${data.childId}`);
  const childRef = ctx.db.doc(`${USERS}/${data.childId}`);

  try {
    await ctx.db.runTransaction(async (t: Transaction) => {
      const newIndexSnap = await t.get(newIndexRef);
      if (newIndexSnap.exists) {
        const existingChild = (newIndexSnap.data() as Record<string, unknown>).childId;
        // Same child => already applied (idempotent retry); otherwise collision.
        if (existingChild !== data.childId) throw httpError('already-exists', 'USERNAME_TAKEN');
      }
      const oldIndexSnap = await t.get(oldIndexRef);
      if (
        oldIndexSnap.exists &&
        (oldIndexSnap.data() as Record<string, unknown>).childId === data.childId
      ) {
        t.delete(oldIndexRef);
      }
      if (!newIndexSnap.exists) {
        t.set(newIndexRef, {
          childId: data.childId,
          normalizedUsername: normalizedNewUsername,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      t.update(privateRef, {
        username: data.newUsername,
        normalizedUsername: normalizedNewUsername,
        syntheticEmail: newSyntheticEmail,
        updatedAt: FieldValue.serverTimestamp(),
      });
      t.update(childRef, { username: data.newUsername, updatedAt: FieldValue.serverTimestamp() });
    });
  } catch (err) {
    // COMPENSATION: revert the Auth email to the previous value to keep the
    // synthetic email consistent across Auth + private record. If the revert
    // also fails we cannot guarantee consistency and must report it.
    try {
      await ctx.auth.updateUser(authUid, { email: oldSyntheticEmail });
    } catch {
      await writeAudit(ctx, familyId, {
        type: 'username_change_inconsistent',
        childId: data.childId,
        actorId: callerUid,
        success: false,
        reason: 'auth_email_changed_firestore_failed_revert_failed',
        clientReqId: data.clientReqId,
      });
      throw httpError('internal', 'USERNAME_CHANGE_INCONSISTENT');
    }
    await writeAudit(ctx, familyId, {
      type: 'username_change_failed',
      childId: data.childId,
      actorId: callerUid,
      success: false,
      reason: 'firestore_transaction_failed',
      clientReqId: data.clientReqId,
    });
    throw err;
  }

  const result: ChangeChildUsernameResult = {
    childId: data.childId,
    username: data.newUsername,
    loginEnabled: priv.status === 'enabled',
    requiresPasswordChange: priv.requiresPasswordChange === true,
  };
  await markIdempotencyCompleted(ctx, familyId, data.clientReqId, result);
  await writeAudit(ctx, familyId, {
    type: 'username_change',
    childId: data.childId,
    actorId: callerUid,
    success: true,
    oldUsername: oldNormalized,
    newUsername: normalizedNewUsername,
    clientReqId: data.clientReqId,
  });
  return result;
}

// --- 6. completeChildPasswordChange -----------------------------------------

export async function completeChildPasswordChangeImpl(
  ctx: ChildLoginContext,
  callerUid: string,
  callerClaims: Record<string, unknown> | undefined,
  data: CompleteChildPasswordChangeInput,
): Promise<CompleteChildPasswordChangeResult> {
  if (!data || typeof data !== 'object') throw httpError('invalid-argument', 'BAD_REQUEST');
  if (typeof data.currentPassword !== 'string' || !data.currentPassword) {
    throw httpError('invalid-argument', 'CURRENT_PASSWORD_REQUIRED');
  }
  if (typeof data.newPassword !== 'string' || !data.newPassword) {
    throw httpError('invalid-argument', 'NEW_PASSWORD_REQUIRED');
  }
  if (typeof data.clientReqId !== 'string' || !data.clientReqId) {
    throw httpError('invalid-argument', 'CLIENT_REQ_ID_REQUIRED');
  }

  // Managed child only — identity resolved from trusted claims, never from uid.
  if (
    !callerClaims ||
    callerClaims.role !== 'child' ||
    callerClaims.managedChild !== true ||
    typeof callerClaims.childId !== 'string'
  ) {
    throw httpError('permission-denied', 'NOT_AUTHORIZED');
  }
  const childId = callerClaims.childId as string;
  const familyId = callerClaims.familyId as string;

  const privateRef = ctx.db.doc(`${FAMILIES}/${familyId}/${CHILD_LOGINS}/${childId}`);
  const privateSnap = await privateRef.get();
  if (!privateSnap.exists) throw httpError('failed-precondition', 'NO_LOGIN_LINK');
  const priv = privateSnap.data() as Record<string, unknown>;
  const authUid = priv.authUid as string;
  if (typeof authUid !== 'string' || !authUid) {
    throw httpError('failed-precondition', 'NO_LOGIN_LINK');
  }

  const payloadHash = computeLifecyclePayloadHash('completeChildPasswordChange', [
    childId,
    hashSecret(data.currentPassword),
    hashSecret(data.newPassword),
  ]);
  const pre = await lifecycleIdempotencyPrecheck(
    ctx,
    familyId,
    data.clientReqId,
    'completeChildPasswordChange',
    payloadHash,
  );
  if (pre.kind === 'done') return pre.result as CompleteChildPasswordChangeResult;
  if (pre.kind === 'replayMismatch') {
    throw httpError('already-exists', 'CLIENT_REQ_ID_REPLAY_MISMATCH');
  }

  // requiresPasswordChange must currently be true.
  if (priv.requiresPasswordChange !== true) {
    throw httpError('failed-precondition', 'CHANGE_NOT_REQUIRED');
  }

  const normalizedUsername = priv.normalizedUsername as string;
  const pw = validatePasswordStrength(data.newPassword, normalizedUsername);
  if (!pw.ok) throw httpError('invalid-argument', pw.reason ?? 'WEAK_PASSWORD');

  // Verify current password server-side via the trusted Identity Toolkit REST
  // pattern (Admin SDK has no verifyPassword). Synthetic email stays server-side.
  const syntheticEmail = priv.syntheticEmail as string;
  const verify = ctx.verifyPassword ?? verifyPasswordViaAuthApi;
  const ok = await verify(syntheticEmail, data.currentPassword);
  if (!ok) throw httpError('invalid-argument', 'INVALID_CREDENTIALS');

  try {
    await ctx.auth.updateUser(authUid, { password: data.newPassword });
  } catch {
    throw httpError('internal', 'AUTH_UPDATE_FAILED');
  }
  try {
    await ctx.auth.revokeRefreshTokens(authUid);
  } catch {
    /* best-effort */
  }

  await privateRef.update({ requiresPasswordChange: false, updatedAt: FieldValue.serverTimestamp() });
  await ctx.db
    .doc(`${USERS}/${childId}`)
    .update({ requiresPasswordChange: false, updatedAt: FieldValue.serverTimestamp() });

  const result: CompleteChildPasswordChangeResult = { success: true };
  await markIdempotencyCompleted(ctx, familyId, data.clientReqId, result);
  await writeAudit(ctx, familyId, {
    type: 'password_change_completed',
    childId,
    actorId: childId,
    success: true,
    clientReqId: data.clientReqId,
  });
  return result;
}

// ---------------------------------------------------------------------------
// Callable entry points (deployed)
// ---------------------------------------------------------------------------

export const createChildLogin = onCall(
  async (request: CallableRequest<CreateChildLoginInput>): Promise<CreateChildLoginResult> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'AUTH_REQUIRED');
    }
    return createChildLoginImpl(makeContext(), request.auth.uid, request.data);
  },
);

export const signInChild = onCall(
  async (request: CallableRequest<SignInChildInput>): Promise<SignInChildResult> => {
    const ip =
      (request.rawRequest as { ip?: string } | undefined)?.ip ??
      (request.rawRequest as { headers?: { 'x-forwarded-for'?: string } } | undefined)?.headers?.[
        'x-forwarded-for'
      ];
    return signInChildImpl(makeContext(), request.data, { ip });
  },
);

export const resetChildPassword = onCall(
  async (request: CallableRequest<ResetChildPasswordInput>): Promise<ResetChildPasswordResult> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'AUTH_REQUIRED');
    return resetChildPasswordImpl(makeContext(), request.auth.uid, request.data);
  },
);

export const disableChildLogin = onCall(
  async (request: CallableRequest<DisableChildLoginInput>): Promise<DisableChildLoginResult> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'AUTH_REQUIRED');
    return disableChildLoginImpl(makeContext(), request.auth.uid, request.data);
  },
);

export const enableChildLogin = onCall(
  async (request: CallableRequest<EnableChildLoginInput>): Promise<EnableChildLoginResult> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'AUTH_REQUIRED');
    return enableChildLoginImpl(makeContext(), request.auth.uid, request.data);
  },
);

export const revokeChildSessions = onCall(
  async (request: CallableRequest<RevokeChildSessionsInput>): Promise<RevokeChildSessionsResult> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'AUTH_REQUIRED');
    return revokeChildSessionsImpl(makeContext(), request.auth.uid, request.data);
  },
);

export const changeChildUsername = onCall(
  async (request: CallableRequest<ChangeChildUsernameInput>): Promise<ChangeChildUsernameResult> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'AUTH_REQUIRED');
    return changeChildUsernameImpl(makeContext(), request.auth.uid, request.data);
  },
);

export const completeChildPasswordChange = onCall(
  async (
    request: CallableRequest<CompleteChildPasswordChangeInput>,
  ): Promise<CompleteChildPasswordChangeResult> => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'AUTH_REQUIRED');
    return completeChildPasswordChangeImpl(
      makeContext(),
      request.auth.uid,
      request.auth.token as unknown as Record<string, unknown>,
      request.data,
    );
  },
);
