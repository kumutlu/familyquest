import { createHash, randomBytes } from 'crypto';
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';

export const QR_SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const PENDING_REQUEST_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ChildQrOnboardingContext {
  db: Firestore;
  auth?: Auth;
  nowMs?: () => number;
  setMockTime?: (t: number) => void;
  generateToken?: () => string;
}

export function hashSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function generateEntropyToken(): string {
  return randomBytes(32).toString('hex');
}

function getNowMs(ctx: ChildQrOnboardingContext): number {
  return ctx.nowMs ? ctx.nowMs() : Date.now();
}

function requireUid(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'AUTH_REQUIRED');
  return uid;
}

async function assertParentOfFamily(
  ctx: ChildQrOnboardingContext,
  callerUid: string,
  familyId: string,
): Promise<void> {
  if (!callerUid || !familyId) {
    throw new HttpsError('permission-denied', 'NOT_AUTHORIZED');
  }
  const snap = await ctx.db.doc(`users/${callerUid}`).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'NOT_AUTHORIZED');
  const caller = snap.data() as Record<string, any>;
  if (caller.familyId !== familyId) throw new HttpsError('permission-denied', 'NOT_AUTHORIZED');
  if (caller.role !== 'parent' && caller.role !== 'owner') {
    throw new HttpsError('permission-denied', 'NOT_AUTHORIZED');
  }
}

/**
 * 1. generateChildQrToken
 * Generates an opaque 256-bit QR token for a parent/owner.
 * Revokes any existing active QR sessions for that family.
 */
export async function generateChildQrTokenImpl(
  request: CallableRequest<unknown>,
  context: ChildQrOnboardingContext,
): Promise<{ rawToken: string; expiresAtMs: number }> {
  const uid = requireUid(request);
  const now = getNowMs(context);
  const expiresAtMs = now + QR_SESSION_TTL_MS;

  const profileSnap = await context.db.doc(`users/${uid}`).get();
  if (!profileSnap.exists) {
    throw new HttpsError('permission-denied', 'PARENT_REQUIRED');
  }
  const profile = profileSnap.data() as Record<string, any>;
  if (!profile?.familyId || (profile.role !== 'owner' && profile.role !== 'parent')) {
    throw new HttpsError('permission-denied', 'PARENT_REQUIRED');
  }

  const familyId = String(profile.familyId);
  const rawToken = context.generateToken ? context.generateToken() : generateEntropyToken();
  const tokenHash = hashSha256(rawToken);
  const sessionId = context.db.collection('x').doc().id;

  const sessionRef = context.db.doc(`families/${familyId}/child_qr_sessions/${sessionId}`);
  const lookupRef = context.db.doc(`childQrTokenLookup/${tokenHash}`);

  // Revoke active sessions for this family
  const activeSessions = await context.db
    .collection(`families/${familyId}/child_qr_sessions`)
    .where('status', '==', 'active')
    .get();

  await context.db.runTransaction(async (transaction) => {
    for (const docSnap of activeSessions.docs) {
      const data = docSnap.data();
      transaction.update(docSnap.ref, {
        status: 'revoked',
        revokedAtMs: now,
      });
      if (data.tokenHash) {
        const oldLookupRef = context.db.doc(`childQrTokenLookup/${data.tokenHash}`);
        transaction.update(oldLookupRef, { status: 'revoked' });
      }
    }

    transaction.set(sessionRef, {
      qrSessionId: sessionId,
      familyId,
      tokenHash,
      createdBy: uid,
      status: 'active',
      createdAtMs: now,
      expiresAtMs,
      consumedAtMs: null,
      consumedByRequestId: null,
      revokedAtMs: null,
      createdAt: FieldValue.serverTimestamp(),
    });

    transaction.set(lookupRef, {
      qrSessionId: sessionId,
      familyId,
      status: 'active',
      expiresAtMs,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return { rawToken, expiresAtMs };
}

/**
 * 2. scanChildQrToken
 * Unauthenticated preview for child scanning QR.
 * Validates active & unexpired status without consuming the token.
 */
export async function scanChildQrTokenImpl(
  input: { token?: string },
  context: ChildQrOnboardingContext,
): Promise<{ valid: true; expiresAtMs: number }> {
  const token = typeof input?.token === 'string' ? input.token.trim() : '';
  if (!token) {
    throw new HttpsError('invalid-argument', 'INVALID_QR_TOKEN');
  }

  const tokenHash = hashSha256(token);
  const now = getNowMs(context);

  const lookupSnap = await context.db.doc(`childQrTokenLookup/${tokenHash}`).get();
  if (!lookupSnap.exists) {
    throw new HttpsError('not-found', 'INVALID_QR_TOKEN');
  }
  const lookup = lookupSnap.data() as Record<string, any>;
  if (lookup.status === 'revoked') {
    throw new HttpsError('failed-precondition', 'QR_REVOKED');
  }
  if (lookup.status === 'consumed') {
    throw new HttpsError('failed-precondition', 'QR_ALREADY_USED');
  }

  const sessionSnap = await context.db
    .doc(`families/${lookup.familyId}/child_qr_sessions/${lookup.qrSessionId}`)
    .get();

  if (!sessionSnap.exists) {
    throw new HttpsError('not-found', 'INVALID_QR_TOKEN');
  }

  const session = sessionSnap.data() as Record<string, any>;
  if (session.status === 'revoked') {
    throw new HttpsError('failed-precondition', 'QR_REVOKED');
  }
  if (session.status === 'consumed') {
    throw new HttpsError('failed-precondition', 'QR_ALREADY_USED');
  }
  if (typeof session.expiresAtMs === 'number' && session.expiresAtMs <= now) {
    throw new HttpsError('failed-precondition', 'QR_EXPIRED');
  }

  return { valid: true, expiresAtMs: session.expiresAtMs };
}

/**
 * 3. submitChildQrJoinRequest
 * Unauthenticated child device submits join request using scanned QR token.
 * Consumes QR token atomically (`active -> consumed`).
 * Generates bearer `requestSecret` (hashed server-side) and creates pending request.
 */
export async function submitChildQrJoinRequestImpl(
  input: { token?: string; clientReqId?: string },
  request: CallableRequest<unknown>,
  context: ChildQrOnboardingContext,
): Promise<{ requestId: string; requestSecret: string; status: 'pending'; expiresAtMs: number }> {
  const uid = requireUid(request);
  const token = typeof input?.token === 'string' ? input.token.trim() : '';
  if (!token) {
    throw new HttpsError('invalid-argument', 'INVALID_QR_TOKEN');
  }

  const tokenHash = hashSha256(token);
  const now = getNowMs(context);
  const expiresAtMs = now + PENDING_REQUEST_TTL_MS;

  const lookupRef = context.db.doc(`childQrTokenLookup/${tokenHash}`);
  const lookupSnap = await lookupRef.get();
  if (!lookupSnap.exists) {
    throw new HttpsError('not-found', 'INVALID_QR_TOKEN');
  }
  const lookup = lookupSnap.data() as Record<string, any>;
  if (lookup.status === 'revoked') {
    throw new HttpsError('failed-precondition', 'QR_REVOKED');
  }
  if (lookup.status === 'consumed') {
    throw new HttpsError('failed-precondition', 'QR_ALREADY_USED');
  }
  if (typeof lookup.expiresAtMs === 'number' && lookup.expiresAtMs <= now) {
    throw new HttpsError('failed-precondition', 'QR_EXPIRED');
  }

  const familyId = String(lookup.familyId);
  const qrSessionId = String(lookup.qrSessionId);
  const sessionRef = context.db.doc(`families/${familyId}/child_qr_sessions/${qrSessionId}`);

  const requestId = context.db.collection('x').doc().id;
  const requestSecret = generateEntropyToken();
  const requestSecretHash = hashSha256(requestSecret);

  const requestRef = context.db.doc(`families/${familyId}/child_qr_join_requests/${requestId}`);
  const secretRef = context.db.doc(`families/${familyId}/childQrJoinSecrets/${requestId}`);
  const requestLookupRef = context.db.doc(`childQrRequestLookup/${requestId}`);

  await context.db.runTransaction(async (transaction) => {
    const liveLookup = await transaction.get(lookupRef);
    if (!liveLookup.exists || liveLookup.data()?.status !== 'active') {
      throw new HttpsError('failed-precondition', 'QR_ALREADY_USED');
    }
    const liveSession = await transaction.get(sessionRef);
    if (!liveSession.exists || liveSession.data()?.status !== 'active') {
      throw new HttpsError('failed-precondition', 'QR_ALREADY_USED');
    }

    transaction.update(lookupRef, { status: 'consumed' });
    transaction.update(sessionRef, {
      status: 'consumed',
      consumedAtMs: now,
      consumedByRequestId: requestId,
    });

    transaction.set(requestRef, {
      requestId,
      qrSessionId,
      familyId,
      requesterUid: uid,
      category: 'join',
      type: 'child_qr_device_join',
      status: 'pending',
      createdAtMs: now,
      expiresAtMs,
      resolvedAtMs: null,
      resolvedBy: null,
      selectedManagedChildId: null,
      rejectionReason: null,
      createdAt: FieldValue.serverTimestamp(),
    });

    transaction.set(secretRef, {
      requestId,
      familyId,
      requestSecretHash,
      createdAtMs: now,
      expiresAtMs,
      createdAt: FieldValue.serverTimestamp(),
    });

    transaction.set(requestLookupRef, {
      familyId,
      requestId,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    requestId,
    requestSecret,
    status: 'pending',
    expiresAtMs,
  };
}

/**
 * 4. getChildQrJoinStatus
 * Polling endpoint for scanning child device using requestId & bearer requestSecret.
 */
export async function getChildQrJoinStatusImpl(
  input: { requestId?: string; requestSecret?: string },
  context: ChildQrOnboardingContext,
): Promise<{ requestId: string; status: string; expiresAtMs: number }> {
  const requestId = typeof input?.requestId === 'string' ? input.requestId.trim() : '';
  const requestSecret = typeof input?.requestSecret === 'string' ? input.requestSecret.trim() : '';
  if (!requestId || !requestSecret) {
    throw new HttpsError('invalid-argument', 'JOIN_REQUEST_NOT_FOUND');
  }

  const lookupSnap = await context.db.doc(`childQrRequestLookup/${requestId}`).get();
  if (!lookupSnap.exists) {
    throw new HttpsError('not-found', 'JOIN_REQUEST_NOT_FOUND');
  }
  const familyId = String(lookupSnap.data()?.familyId ?? '');

  const secretSnap = await context.db.doc(`families/${familyId}/childQrJoinSecrets/${requestId}`).get();
  if (!secretSnap.exists) {
    throw new HttpsError('not-found', 'JOIN_REQUEST_NOT_FOUND');
  }
  const secretData = secretSnap.data() as Record<string, any>;
  const computedHash = hashSha256(requestSecret);
  if (secretData.requestSecretHash !== computedHash) {
    throw new HttpsError('not-found', 'JOIN_REQUEST_NOT_FOUND');
  }

  const reqSnap = await context.db.doc(`families/${familyId}/child_qr_join_requests/${requestId}`).get();
  if (!reqSnap.exists) {
    throw new HttpsError('not-found', 'JOIN_REQUEST_NOT_FOUND');
  }
  const reqData = reqSnap.data() as Record<string, any>;

  return {
    requestId,
    status: String(reqData.status ?? 'pending'),
    expiresAtMs: Number(reqData.expiresAtMs ?? 0),
  };
}

/**
 * 5. approveChildQrJoinRequest
 * Server-authoritative parent approval of a pending QR join request.
 * Parent selects an EXISTING managed child (`selectedManagedChildId`).
 * Updates ONLY request resolution state. Does NOT alter target child document or Auth identity.
 */
export async function approveChildQrJoinRequestImpl(
  input: { familyId?: string; requestId?: string; selectedManagedChildId?: string; clientReqId?: string },
  request: CallableRequest<unknown>,
  context: ChildQrOnboardingContext,
): Promise<{ requestId: string; selectedManagedChildId: string; status: 'approved' }> {
  const callerUid = requireUid(request);
  const familyId = typeof input?.familyId === 'string' ? input.familyId.trim() : '';
  const requestId = typeof input?.requestId === 'string' ? input.requestId.trim() : '';
  const selectedManagedChildId = typeof input?.selectedManagedChildId === 'string' ? input.selectedManagedChildId.trim() : '';
  const clientReqId = typeof input?.clientReqId === 'string' ? input.clientReqId.trim() : '';

  await assertParentOfFamily(context, callerUid, familyId);

  if (!requestId || !selectedManagedChildId) {
    throw new HttpsError('invalid-argument', 'INVALID_APPROVAL_PAYLOAD');
  }

  // Idempotency check
  if (clientReqId) {
    const idemRef = context.db.doc(`families/${familyId}/qrIdempotency/${clientReqId}`);
    const idemSnap = await idemRef.get();
    if (idemSnap.exists && idemSnap.data()?.status === 'completed') {
      return idemSnap.data()?.result as { requestId: string; selectedManagedChildId: string; status: 'approved' };
    }
  }

  // Validate target child profile
  const childSnap = await context.db.doc(`users/${selectedManagedChildId}`).get();
  if (!childSnap.exists) {
    throw new HttpsError('not-found', 'CHILD_NOT_FOUND');
  }
  const child = childSnap.data() as Record<string, any>;
  if (child.familyId !== familyId) {
    throw new HttpsError('failed-precondition', 'CHILD_NOT_IN_FAMILY');
  }
  if (child.role !== 'child' || child.isManaged !== true || child.status === 'deleted') {
    throw new HttpsError('failed-precondition', 'INVALID_TARGET_CHILD');
  }

  // Validate private child login record
  const loginSnap = await context.db.doc(`families/${familyId}/childLogins/${selectedManagedChildId}`).get();
  if (!loginSnap.exists || !loginSnap.data()?.authUid) {
    throw new HttpsError('failed-precondition', 'CHILD_LOGIN_INCONSISTENT');
  }

  const reqRef = context.db.doc(`families/${familyId}/child_qr_join_requests/${requestId}`);
  const now = getNowMs(context);

  await context.db.runTransaction(async (transaction) => {
    const liveReq = await transaction.get(reqRef);
    if (!liveReq.exists) {
      throw new HttpsError('not-found', 'JOIN_REQUEST_NOT_FOUND');
    }
    const data = liveReq.data() as Record<string, any>;
    if (data.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'REQUEST_NOT_PENDING');
    }

    transaction.update(reqRef, {
      status: 'approved',
      resolvedAtMs: now,
      resolvedBy: callerUid,
      selectedManagedChildId,
      resolvedAt: FieldValue.serverTimestamp(),
    });

    if (clientReqId) {
      const idemRef = context.db.doc(`families/${familyId}/qrIdempotency/${clientReqId}`);
      transaction.set(idemRef, {
        clientReqId,
        operation: 'approveChildQrJoinRequest',
        status: 'completed',
        result: { requestId, selectedManagedChildId, status: 'approved' },
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  });

  return { requestId, selectedManagedChildId, status: 'approved' };
}

/**
 * 6. rejectChildQrJoinRequest
 * Server-authoritative parent rejection of a pending QR join request. Rejection is final.
 */
export async function rejectChildQrJoinRequestImpl(
  input: { familyId?: string; requestId?: string; rejectionReason?: string; clientReqId?: string },
  request: CallableRequest<unknown>,
  context: ChildQrOnboardingContext,
): Promise<{ requestId: string; status: 'rejected' }> {
  const callerUid = requireUid(request);
  const familyId = typeof input?.familyId === 'string' ? input.familyId.trim() : '';
  const requestId = typeof input?.requestId === 'string' ? input.requestId.trim() : '';
  const rejectionReason = typeof input?.rejectionReason === 'string' ? input.rejectionReason.trim() : null;

  await assertParentOfFamily(context, callerUid, familyId);

  if (!requestId) {
    throw new HttpsError('invalid-argument', 'INVALID_REJECTION_PAYLOAD');
  }

  const reqRef = context.db.doc(`families/${familyId}/child_qr_join_requests/${requestId}`);
  const now = getNowMs(context);

  await context.db.runTransaction(async (transaction) => {
    const liveReq = await transaction.get(reqRef);
    if (!liveReq.exists) {
      throw new HttpsError('not-found', 'JOIN_REQUEST_NOT_FOUND');
    }
    const data = liveReq.data() as Record<string, any>;
    if (data.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'REQUEST_NOT_PENDING');
    }

    transaction.update(reqRef, {
      status: 'rejected',
      resolvedAtMs: now,
      resolvedBy: callerUid,
      rejectionReason,
      resolvedAt: FieldValue.serverTimestamp(),
    });
  });

  return { requestId, status: 'rejected' };
}

// Callables exported for Firebase deployment
const prodCtx = (): ChildQrOnboardingContext => ({
  db: getFirestore(),
  auth: getAuth(),
});

export const generateChildQrToken = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  (request) => generateChildQrTokenImpl(request, prodCtx()),
);

export const scanChildQrToken = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  (request) => scanChildQrTokenImpl(request.data as any, prodCtx()),
);

export const submitChildQrJoinRequest = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  (request) => submitChildQrJoinRequestImpl(request.data as any, request, prodCtx()),
);

export const getChildQrJoinStatus = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  (request) => getChildQrJoinStatusImpl(request.data as any, prodCtx()),
);

export const approveChildQrJoinRequest = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  (request) => approveChildQrJoinRequestImpl(request.data as any, request, prodCtx()),
);

export const rejectChildQrJoinRequest = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  (request) => rejectChildQrJoinRequestImpl(request.data as any, request, prodCtx()),
);
