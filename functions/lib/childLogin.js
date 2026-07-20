"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.signInChild = exports.createChildLogin = exports.SERVER_ONLY_USER_FIELDS = exports.PUBLIC_LOGIN_FIELDS = void 0;
exports.normalizeUsername = normalizeUsername;
exports.validatePasswordStrength = validatePasswordStrength;
exports.generateSyntheticEmail = generateSyntheticEmail;
exports.computePayloadHash = computePayloadHash;
exports.makeContext = makeContext;
exports.verifyPasswordViaAuthApi = verifyPasswordViaAuthApi;
exports.makeInMemoryRateLimiter = makeInMemoryRateLimiter;
exports.createChildLoginImpl = createChildLoginImpl;
exports.signInChildImpl = signInChildImpl;
const https_1 = require("firebase-functions/v2/https");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
const crypto_1 = require("crypto");
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
exports.PUBLIC_LOGIN_FIELDS = ['hasLogin', 'username', 'loginEnabled', 'requiresPasswordChange'];
// Fields a client must NEVER be able to set on a user document (server-only).
exports.SERVER_ONLY_USER_FIELDS = [
    'hasLogin',
    'username',
    'loginEnabled',
    'requiresPasswordChange',
    'authUid',
];
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
];
// ---------------------------------------------------------------------------
// Pure helpers (unit-testable, no I/O)
// ---------------------------------------------------------------------------
/**
 * Deterministic username normalization. Lower-cases, trims, collapses internal
 * whitespace to a single space, and enforces an allowed character set. The
 * normalized form is what is stored and what uniqueness is enforced on.
 */
function normalizeUsername(raw) {
    if (typeof raw !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'USERNAME_REQUIRED');
    }
    const collapsed = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (collapsed.length < 3 || collapsed.length > 32) {
        throw new https_1.HttpsError('invalid-argument', 'USERNAME_LENGTH');
    }
    if (!/^[a-z0-9_ ]+$/.test(collapsed)) {
        throw new https_1.HttpsError('invalid-argument', 'USERNAME_CHARS');
    }
    return collapsed;
}
/**
 * Server-side password strength policy. Kept independent of any client check.
 */
function validatePasswordStrength(password, normalizedUsername) {
    if (typeof password !== 'string')
        return { ok: false, reason: 'PASSWORD_REQUIRED' };
    if (password.length < 8)
        return { ok: false, reason: 'PASSWORD_TOO_SHORT' };
    if (password.length > 128)
        return { ok: false, reason: 'PASSWORD_TOO_LONG' };
    if (!/[a-zA-Z]/.test(password))
        return { ok: false, reason: 'PASSWORD_NEEDS_LETTER' };
    if (!/\d/.test(password))
        return { ok: false, reason: 'PASSWORD_NEEDS_DIGIT' };
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
function generateSyntheticEmail(familyId, normalizedUsername) {
    const safeFamily = String(familyId).toLowerCase();
    const safeUser = normalizedUsername.replace(/ /g, '-');
    return `child-${safeFamily}-${safeUser}@managed.familyquest.app`;
}
/** Stable hash of the idempotency payload (childId + normalizedUsername). */
function computePayloadHash(childId, normalizedUsername) {
    return (0, crypto_1.createHash)('sha256')
        .update(`${childId}|${normalizedUsername}`)
        .digest('hex');
}
// ---------------------------------------------------------------------------
// Context builder (production)
// ---------------------------------------------------------------------------
function isEmulator() {
    return (process.env.FUNCTIONS_EMULATOR === 'true' ||
        process.env.FIRESTORE_EMULATOR_HOST != null ||
        process.env.FIREBASE_AUTH_EMULATOR_HOST != null);
}
function makeContext() {
    return {
        auth: (0, auth_1.getAuth)(),
        db: (0, firestore_1.getFirestore)(),
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
async function verifyPasswordViaAuthApi(syntheticEmail, password) {
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
    }
    catch {
        // Network/transport failure => treat as invalid (generic failure path).
        return false;
    }
}
// ---------------------------------------------------------------------------
// In-memory rate limiter (Phase 1). Production should use a shared store.
// ---------------------------------------------------------------------------
function makeInMemoryRateLimiter(maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    const hits = new Map();
    return (key) => {
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
function httpError(code, message) {
    return new https_1.HttpsError(code, message);
}
// Generic failure for signInChild — never reveals which step failed.
function throwGenericLoginFailure() {
    throw new https_1.HttpsError('invalid-argument', 'INVALID_CREDENTIALS');
}
// ---------------------------------------------------------------------------
// createChildLogin
// ---------------------------------------------------------------------------
async function createChildLoginImpl(ctx, callerUid, data) {
    // --- Input validation + role-escalation guard -------------------------
    if (!data || typeof data !== 'object') {
        throw httpError('invalid-argument', 'BAD_REQUEST');
    }
    for (const forbidden of FORBIDDEN_CLIENT_FIELDS) {
        if (forbidden in data) {
            throw httpError('invalid-argument', 'UNEXPECTED_FIELD');
        }
    }
    if (typeof data.childId !== 'string' || !data.childId) {
        throw httpError('invalid-argument', 'CHILD_ID_REQUIRED');
    }
    if (typeof data.clientReqId !== 'string' || !data.clientReqId) {
        throw httpError('invalid-argument', 'CLIENT_REQ_ID_REQUIRED');
    }
    const normalizedUsername = normalizeUsername(data.username);
    const pw = validatePasswordStrength(data.password, normalizedUsername);
    if (!pw.ok) {
        throw httpError('invalid-argument', pw.reason ?? 'WEAK_PASSWORD');
    }
    const { db, auth } = ctx;
    const childRef = db.doc(`${USERS}/${data.childId}`);
    // --- Precheck transaction: authz + eligibility + idempotency + index -----
    const pre = await db.runTransaction(async (t) => {
        const callerSnap = await t.get(db.doc(`${USERS}/${callerUid}`));
        if (!callerSnap.exists)
            throw httpError('permission-denied', 'CALLER_NOT_FOUND');
        const caller = callerSnap.data();
        const callerFamilyId = caller.familyId;
        const callerRole = caller.role;
        if (typeof callerFamilyId !== 'string' ||
            (callerRole !== 'owner' && callerRole !== 'parent')) {
            throw httpError('permission-denied', 'NOT_AUTHORIZED');
        }
        const familyId = callerFamilyId;
        // Idempotency check FIRST. A completed request with the same clientReqId
        // must return the cached result even though the child already has a login
        // (which it will, on a retry). This MUST precede the child login-status
        // check below, otherwise a retry would be rejected as LOGIN_ALREADY_EXISTS
        // before the cached result can be returned.
        const idemRefReal = db.doc(`${FAMILIES}/${familyId}/${CHILD_LOGIN_IDEMPOTENCY}/${data.clientReqId}`);
        const idemSnap = await t.get(idemRefReal);
        if (idemSnap.exists) {
            const d = idemSnap.data();
            // A replay with the SAME clientReqId but a DIFFERENT payload (childId or
            // normalized username) is always rejected, even if the first attempt
            // already completed. This prevents a caller from reusing a clientReqId to
            // target a different child.
            const payloadHash = computePayloadHash(data.childId, normalizedUsername);
            if (d.payloadHash !== payloadHash) {
                return { kind: 'replayMismatch' };
            }
            if (d.status === 'completed') {
                return { kind: 'done', result: d.result };
            }
            // processing/failed with same payload => allow retry
        }
        else {
            t.set(idemRefReal, {
                clientReqId: data.clientReqId,
                operation: 'createChildLogin',
                payloadHash: computePayloadHash(data.childId, normalizedUsername),
                status: 'processing',
                createdAt: firestore_1.FieldValue.serverTimestamp(),
            });
        }
        const childSnap = await t.get(childRef);
        if (!childSnap.exists)
            throw httpError('not-found', 'CHILD_NOT_FOUND');
        const child = childSnap.data();
        if (child.familyId !== familyId) {
            throw httpError('permission-denied', 'CHILD_NOT_IN_FAMILY');
        }
        if (child.role !== 'child' || child.isManaged !== true) {
            throw httpError('failed-precondition', 'CHILD_NOT_MANAGED');
        }
        if (child.hasLogin === true || child.authUid) {
            throw httpError('already-exists', 'LOGIN_ALREADY_EXISTS');
        }
        const indexRef = db.doc(`${FAMILIES}/${familyId}/${CHILD_LOGIN_INDEX}/${normalizedUsername}`);
        const indexSnap = await t.get(indexRef);
        if (indexSnap.exists)
            throw httpError('already-exists', 'USERNAME_TAKEN');
        return { kind: 'proceed', familyId };
    });
    if (pre.kind === 'done')
        return pre.result;
    if (pre.kind === 'replayMismatch') {
        throw httpError('already-exists', 'CLIENT_REQ_ID_REPLAY_MISMATCH');
    }
    const familyId = pre.familyId;
    // --- Create the Firebase Auth user (synthetic) --------------------------
    const syntheticEmail = generateSyntheticEmail(familyId, normalizedUsername);
    const childDisplayName = await getChildDisplayName(ctx, data.childId);
    let authUid;
    try {
        const userRecord = await auth.createUser({
            email: syntheticEmail,
            password: data.password,
            displayName: childDisplayName,
            disabled: false,
        });
        authUid = userRecord.uid;
    }
    catch (err) {
        // Creation failed before/at user creation. Leave idempotency as processing
        // so a same-payload retry is permitted. Best-effort cleanup.
        try {
            const partial = err?.uid;
            if (partial)
                await auth.deleteUser(partial);
        }
        catch {
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
    }
    catch (claimErr) {
        try {
            await auth.deleteUser(authUid);
        }
        catch {
            /* ignore */
        }
        throw httpError('internal', 'CLAIMS_FAILED');
    }
    // --- Link in Firestore (atomic) -----------------------------------------
    const indexRef = db.doc(`${FAMILIES}/${familyId}/${CHILD_LOGIN_INDEX}/${normalizedUsername}`);
    const privateRef = db.doc(`${FAMILIES}/${familyId}/${CHILD_LOGINS}/${data.childId}`);
    const auditRef = db.doc(`${FAMILIES}/${familyId}/${CHILD_LOGIN_AUDIT}/${db.collection('x').doc().id}`);
    const idemRefReal = db.doc(`${FAMILIES}/${familyId}/${CHILD_LOGIN_IDEMPOTENCY}/${data.clientReqId}`);
    try {
        await db.runTransaction(async (t) => {
            const childSnap = await t.get(childRef);
            const child = childSnap.data();
            if (child.hasLogin === true || child.authUid) {
                throw httpError('already-exists', 'LOGIN_ALREADY_EXISTS');
            }
            const indexSnap = await t.get(indexRef);
            if (indexSnap.exists)
                throw httpError('already-exists', 'USERNAME_TAKEN');
            t.set(indexRef, {
                childId: data.childId,
                normalizedUsername,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
            });
            t.set(privateRef, {
                childId: data.childId,
                username: data.username,
                normalizedUsername,
                syntheticEmail,
                authUid,
                familyId,
                status: 'enabled',
                requiresPasswordChange: false,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
                createdBy: callerUid,
            });
            t.update(childRef, {
                authUid,
                hasLogin: true,
                username: data.username,
                loginEnabled: true,
                requiresPasswordChange: false,
            });
            t.set(auditRef, {
                type: 'login_created',
                childId: data.childId,
                username: data.username,
                normalizedUsername,
                actorId: callerUid,
                success: true,
                createdAt: firestore_1.FieldValue.serverTimestamp(),
                clientReqId: data.clientReqId,
            });
            t.update(idemRefReal, {
                status: 'completed',
                result: { childId: data.childId, username: data.username, loginEnabled: true },
                authUid,
                completedAt: firestore_1.FieldValue.serverTimestamp(),
            });
        });
    }
    catch (linkErr) {
        // COMPENSATION: Auth user was created but Firestore linking failed. Delete
        // the Auth user so no orphaned usable account remains, and record the
        // compensation in the audit log.
        try {
            await auth.deleteUser(authUid);
        }
        catch {
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
                createdAt: firestore_1.FieldValue.serverTimestamp(),
                clientReqId: data.clientReqId,
            });
        }
        catch {
            /* ignore */
        }
        try {
            await idemRefReal.update({ status: 'failed', failedAt: firestore_1.FieldValue.serverTimestamp() });
        }
        catch {
            /* ignore */
        }
        throw linkErr;
    }
    // Success — omit authUid and syntheticEmail from the response.
    return { childId: data.childId, username: data.username, loginEnabled: true };
}
// Helper to read the child's display name for the Auth user (best-effort).
async function getChildDisplayName(ctx, childId) {
    try {
        const snap = await ctx.db.doc(`${USERS}/${childId}`).get();
        const d = snap.data();
        if (d && typeof d.displayName === 'string' && d.displayName)
            return d.displayName;
    }
    catch {
        /* ignore */
    }
    return 'Child';
}
// ---------------------------------------------------------------------------
// signInChild
// ---------------------------------------------------------------------------
async function signInChildImpl(ctx, data, meta = {}) {
    // --- Input validation --------------------------------------------------
    if (!data || typeof data !== 'object')
        throwGenericLoginFailure();
    const familyCode = typeof data.familyCode === 'string' ? data.familyCode : '';
    const usernameRaw = typeof data.username === 'string' ? data.username : '';
    const password = typeof data.password === 'string' ? data.password : '';
    if (!familyCode || !usernameRaw || !password)
        throwGenericLoginFailure();
    let normalizedUsername;
    try {
        normalizedUsername = normalizeUsername(usernameRaw);
    }
    catch {
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
    const indexRef = db.doc(`${FAMILIES}/${familyCode}/${CHILD_LOGIN_INDEX}/${normalizedUsername}`);
    const indexSnap = await indexRef.get();
    if (!indexSnap.exists) {
        await auditSignInAttempt(ctx, familyCode, normalizedUsername, false, 'no_user');
        throwGenericLoginFailure();
    }
    const childId = indexSnap.data().childId;
    const privateRef = db.doc(`${FAMILIES}/${familyCode}/${CHILD_LOGINS}/${childId}`);
    const privateSnap = await privateRef.get();
    if (!privateSnap.exists) {
        await auditSignInAttempt(ctx, familyCode, normalizedUsername, false, 'no_record');
        throwGenericLoginFailure();
    }
    const priv = privateSnap.data();
    if (priv.status !== 'enabled') {
        await auditSignInAttempt(ctx, familyCode, normalizedUsername, false, 'disabled_login');
        throwGenericLoginFailure();
    }
    const syntheticEmail = priv.syntheticEmail;
    const authUid = priv.authUid;
    const familyId = priv.familyId;
    // --- Child must still be active & managed ------------------------------
    const childSnap = await db.doc(`${USERS}/${childId}`).get();
    if (!childSnap.exists) {
        await auditSignInAttempt(ctx, familyCode, normalizedUsername, false, 'no_child');
        throwGenericLoginFailure();
    }
    const child = childSnap.data();
    if (child.familyId !== familyId ||
        child.role !== 'child' ||
        child.isManaged !== true) {
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
    let customToken;
    try {
        customToken = await auth.createCustomToken(authUid, {
            role: 'child',
            familyId,
            childId,
            managedChild: true,
        });
    }
    catch {
        await auditSignInAttempt(ctx, familyCode, normalizedUsername, false, 'token_failed');
        throwGenericLoginFailure();
    }
    await auditSignInAttempt(ctx, familyCode, normalizedUsername, true, 'success');
    return { customToken };
}
async function auditSignInAttempt(ctx, familyCode, normalizedUsername, success, reason) {
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
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
    }
    catch {
        /* audit failures must not break the sign-in response */
    }
}
// ---------------------------------------------------------------------------
// Callable entry points (deployed)
// ---------------------------------------------------------------------------
exports.createChildLogin = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'AUTH_REQUIRED');
    }
    return createChildLoginImpl(makeContext(), request.auth.uid, request.data);
});
exports.signInChild = (0, https_1.onCall)(async (request) => {
    const ip = request.rawRequest?.ip ??
        request.rawRequest?.headers?.['x-forwarded-for'];
    return signInChildImpl(makeContext(), request.data, { ip });
});
//# sourceMappingURL=childLogin.js.map