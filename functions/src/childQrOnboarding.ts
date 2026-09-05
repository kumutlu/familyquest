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
  const payload = (request.data || {}) as Record<string, any>;
  const intent = payload.intent ?? (payload.targetChildId ? 'existing_child_device_bind' : undefined);
  const targetChildId = typeof payload.targetChildId === 'string' ? payload.targetChildId.trim() : null;

  if (intent === 'existing_child_device_bind') {
    if (!targetChildId) {
      throw new HttpsError('invalid-argument', 'TARGET_CHILD_REQUIRED');
    }
    const targetSnap = await context.db.doc(`users/${targetChildId}`).get();
    if (!targetSnap.exists) {
      throw new HttpsError('not-found', 'CHILD_NOT_FOUND');
    }
    const targetData = targetSnap.data() as Record<string, any>;
    if (targetData.familyId !== familyId || targetData.role !== 'child') {
      throw new HttpsError('failed-precondition', 'INVALID_TARGET_CHILD');
    }
  } else if (intent === 'new_child_join') {
    if (targetChildId) {
      throw new HttpsError('invalid-argument', 'TARGET_CHILD_NOT_ALLOWED');
    }
  }

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
      ...(intent ? { intent } : {}),
      targetChildId,
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
      ...(intent ? { intent } : {}),
      targetChildId,
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
  input: { token?: string; requesterDisplayName?: string; requesterDeviceLabel?: string; clientReqId?: string },
  request: CallableRequest<unknown>,
  context: ChildQrOnboardingContext,
): Promise<{ requestId: string; requestSecret: string; status: 'pending'; expiresAtMs: number }> {
  const token = typeof input?.token === 'string' ? input.token.trim() : '';
  if (!token) {
    throw new HttpsError('invalid-argument', 'INVALID_QR_TOKEN');
  }

  const rawDisplayName = typeof input?.requesterDisplayName === 'string' ? input.requesterDisplayName : '';
  const trimmedDisplayName = rawDisplayName.trim();
  if (!trimmedDisplayName) {
    throw new HttpsError('invalid-argument', 'REQUESTER_NAME_REQUIRED');
  }
  const sanitizedDisplayName = trimmedDisplayName.replace(/<[^>]*>/g, '').trim();
  if (!sanitizedDisplayName) {
    throw new HttpsError('invalid-argument', 'REQUESTER_NAME_REQUIRED');
  }
  if (sanitizedDisplayName.length > 40) {
    throw new HttpsError('invalid-argument', 'REQUESTER_NAME_TOO_LONG');
  }

  const rawDeviceLabel = typeof input?.requesterDeviceLabel === 'string' ? input.requesterDeviceLabel : '';
  const sanitizedDeviceLabel = rawDeviceLabel.replace(/<[^>]*>/g, '').trim().slice(0, 40) || null;

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

  const usersSnap = await context.db
    .collection('users')
    .where('familyId', '==', familyId)
    .get();
  const parentUids = usersSnap.docs
    .map((docSnap) => docSnap.data() as Record<string, any>)
    .filter((u) => u.role === 'parent' || u.role === 'owner')
    .map((u) => u.id || u.uid)
    .filter(Boolean);

  const requestId = context.db.collection('x').doc().id;
  const requestSecret = generateEntropyToken();
  const requestSecretHash = hashSha256(requestSecret);

  const requestRef = context.db.doc(`families/${familyId}/child_qr_join_requests/${requestId}`);
  const secretRef = context.db.doc(`families/${familyId}/childQrJoinSecrets/${requestId}`);
  const requestLookupRef = context.db.doc(`childQrRequestLookup/${requestId}`);
  const notifRef = context.db.doc(`families/${familyId}/notifications/qr_join_${requestId}`);

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

    const sessionData = liveSession.data() as Record<string, any>;
    const intent = sessionData?.intent ?? (sessionData?.targetChildId ? 'existing_child_device_bind' : undefined);
    const targetChildId = sessionData?.targetChildId ?? null;

    transaction.set(requestRef, {
      requestId,
      qrSessionId,
      familyId,
      ...(intent ? { intent } : {}),
      targetChildId,
      requesterUid: request.auth?.uid ?? null,
      requesterDisplayName: sanitizedDisplayName,
      requesterDeviceLabel: sanitizedDeviceLabel,
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

    const isNewChild = intent === 'new_child_join';
    const notifTitle = isNewChild
      ? `${sanitizedDisplayName} wants to join your family`
      : `${sanitizedDisplayName} wants to connect a device`;
    const notifBody = isNewChild
      ? (sanitizedDeviceLabel ? `${sanitizedDeviceLabel} • Waiting for approval` : 'Waiting for approval to join your family')
      : (sanitizedDeviceLabel ? `${sanitizedDeviceLabel} • Waiting for approval` : 'Waiting for approval');

    transaction.set(notifRef, {
      id: `qr_join_${requestId}`,
      familyId,
      type: 'child_qr_device_join',
      actorId: request.auth?.uid ?? 'unauthenticated_child_device',
      recipientIds: parentUids,
      title: notifTitle,
      body: notifBody,
      actionUrl: '/review',
      route: '/review',
      requestId,
      createdAtMs: now,
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

  if (!requestId) {
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

  const reqRef = context.db.doc(`families/${familyId}/child_qr_join_requests/${requestId}`);
  const now = getNowMs(context);

  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) {
    throw new HttpsError('not-found', 'JOIN_REQUEST_NOT_FOUND');
  }
  const reqData = reqSnap.data() as Record<string, any>;
  if (reqData.status === 'approved') {
    const approvedChildId = reqData.selectedManagedChildId || reqData.approvedChildId;
    return { requestId, selectedManagedChildId: approvedChildId, status: 'approved' };
  }
  if (reqData.status !== 'pending') {
    throw new HttpsError('failed-precondition', 'REQUEST_NOT_PENDING');
  }

  const intent = reqData.intent === 'new_child_join' ? 'new_child_join' : 'existing_child_device_bind';

  if (intent === 'existing_child_device_bind') {
    // Legacy fallback or existing bind: strictly require targetChildId or selectedManagedChildId
    const targetChildId = reqData.targetChildId || selectedManagedChildId;
    if (!targetChildId) {
      throw new HttpsError('invalid-argument', 'INVALID_APPROVAL_PAYLOAD');
    }

    const childRef = context.db.doc(`users/${targetChildId}`);
    const childSnap = await childRef.get();
    if (!childSnap.exists) {
      throw new HttpsError('not-found', 'CHILD_NOT_FOUND');
    }
    const child = childSnap.data() as Record<string, any>;
    if (child.familyId !== familyId) {
      throw new HttpsError('failed-precondition', 'CHILD_NOT_IN_FAMILY');
    }
    if (child.role !== 'child' || child.status === 'deleted') {
      throw new HttpsError('failed-precondition', 'INVALID_TARGET_CHILD');
    }

    await context.db.runTransaction(async (transaction) => {
      const liveReq = await transaction.get(reqRef);
      if (!liveReq.exists) throw new HttpsError('not-found', 'JOIN_REQUEST_NOT_FOUND');
      const liveData = liveReq.data() as Record<string, any>;
      if (liveData.status === 'approved') return;
      if (liveData.status !== 'pending') throw new HttpsError('failed-precondition', 'REQUEST_NOT_PENDING');

      transaction.update(reqRef, {
        status: 'approved',
        resolvedAtMs: now,
        resolvedBy: callerUid,
        selectedManagedChildId: targetChildId,
        approvedChildId: targetChildId,
        resolvedAt: FieldValue.serverTimestamp(),
      });

      if (clientReqId) {
        const idemRef = context.db.doc(`families/${familyId}/qrIdempotency/${clientReqId}`);
        transaction.set(idemRef, {
          clientReqId,
          operation: 'approveChildQrJoinRequest',
          status: 'completed',
          result: { requestId, selectedManagedChildId: targetChildId, status: 'approved' },
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    });

    return { requestId, selectedManagedChildId: targetChildId, status: 'approved' };
  }

  // === NEW CHILD JOIN: 4-PHASE DURABLE STATE MACHINE ===
  const childId = `child_qr_${requestId}`;
  const authUid = childId;
  const childDisplayName = reqData.requesterDisplayName || 'Child';

  // Phase A: Reserve identity transactionally
  await context.db.runTransaction(async (transaction) => {
    const liveReq = await transaction.get(reqRef);
    if (!liveReq.exists) throw new HttpsError('not-found', 'JOIN_REQUEST_NOT_FOUND');
    const liveData = liveReq.data() as Record<string, any>;
    if (liveData.status === 'approved') return;
    if (liveData.status !== 'pending') throw new HttpsError('failed-precondition', 'REQUEST_NOT_PENDING');

    transaction.update(reqRef, {
      provisioningState: 'reserved',
      reservedChildId: childId,
      updatedAtMs: now,
    });
  });

  // Phase B: Auth Provisioning Outside Firestore Transaction
  const authInstance = context.auth ?? getAuth();
  try {
    await authInstance.getUser(authUid);
  } catch (err: any) {
    const code = err?.code || (err as any)?.errorInfo?.code;
    if (code === 'auth/user-not-found' || err?.message?.includes('User not found')) {
      await authInstance.createUser({
        uid: authUid,
        displayName: childDisplayName,
      });
    } else {
      throw err;
    }
  }

  if (authInstance.setCustomUserClaims) {
    await authInstance.setCustomUserClaims(authUid, {
      role: 'child',
      familyId,
      childId,
      managedChild: true,
    });
  }

  // Phase C & D: Canonical Managed-Child Firestore Provisioning & Finalize Request (Transaction)
  const userRef = context.db.doc(`users/${childId}`);
  const walletRef = context.db.doc(`families/${familyId}/wallets/${childId}`);
  const loginRef = context.db.doc(`families/${familyId}/childLogins/${childId}`);

  await context.db.runTransaction(async (transaction) => {
    const liveReq = await transaction.get(reqRef);
    if (!liveReq.exists) throw new HttpsError('not-found', 'JOIN_REQUEST_NOT_FOUND');
    const liveData = liveReq.data() as Record<string, any>;
    if (liveData.status === 'approved') return;

    // Canonical profile matching createManagedMember / Add Child flow
    transaction.set(userRef, {
      uid: childId,
      id: childId,
      familyId,
      role: 'child',
      isManaged: true,
      displayName: childDisplayName,
      avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(childDisplayName)}`,
      rewardPoints: 0,
      lifetimeXP: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastActiveDate: FieldValue.serverTimestamp(),
      authUid,
      hasLogin: true,
      username: childDisplayName,
      loginEnabled: true,
      createdAtMs: now,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // Canonical wallet in families/${familyId}/wallets/${childId} (NEVER root wallets/)
    transaction.set(walletRef, {
      balance: 0,
      createdAtMs: now,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // Canonical childLogin in families/${familyId}/childLogins/${childId}
    transaction.set(loginRef, {
      childId,
      authUid,
      familyId,
      status: 'enabled',
      createdAtMs: now,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // Phase D: Finalize request
    transaction.update(reqRef, {
      status: 'approved',
      provisioningState: 'complete',
      selectedManagedChildId: childId,
      approvedChildId: childId,
      resolvedAtMs: now,
      resolvedBy: callerUid,
      resolvedAt: FieldValue.serverTimestamp(),
    });

    if (clientReqId) {
      const idemRef = context.db.doc(`families/${familyId}/qrIdempotency/${clientReqId}`);
      transaction.set(idemRef, {
        clientReqId,
        operation: 'approveChildQrJoinRequest',
        status: 'completed',
        result: { requestId, selectedManagedChildId: childId, status: 'approved' },
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  });

  return { requestId, selectedManagedChildId: childId, status: 'approved' };
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

/**
 * 7. exchangeApprovedChildQrRequest
 * Child device exchanges an approved request + valid requestSecret for a Firebase custom token
 * corresponding to the EXISTING child's authUid and existing custom claims.
 * Retries are idempotent/recoverable.
 */
export async function exchangeApprovedChildQrRequestImpl(
  input: { requestId?: string; requestSecret?: string },
  context: ChildQrOnboardingContext,
): Promise<{ customToken: string; childId: string }> {
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
  if (reqData.status !== 'approved') {
    throw new HttpsError('failed-precondition', 'REQUEST_NOT_APPROVED');
  }

  const selectedManagedChildId = String(reqData.selectedManagedChildId ?? '');
  if (!selectedManagedChildId) {
    throw new HttpsError('failed-precondition', 'INVALID_APPROVAL_STATE');
  }

  // Revalidate target child profile & private login record
  const childSnap = await context.db.doc(`users/${selectedManagedChildId}`).get();
  if (!childSnap.exists) {
    throw new HttpsError('failed-precondition', 'CHILD_INACTIVE');
  }
  const child = childSnap.data() as Record<string, any>;
  if (child.familyId !== familyId || child.role !== 'child' || child.isManaged !== true || child.status === 'deleted') {
    throw new HttpsError('failed-precondition', 'CHILD_INACTIVE');
  }

  const loginSnap = await context.db.doc(`families/${familyId}/childLogins/${selectedManagedChildId}`).get();
  if (!loginSnap.exists || !loginSnap.data()?.authUid) {
    throw new HttpsError('failed-precondition', 'CHILD_INACTIVE');
  }
  const existingAuthUid = String(loginSnap.data()?.authUid ?? child.authUid ?? '');
  if (!existingAuthUid) {
    throw new HttpsError('failed-precondition', 'CHILD_INACTIVE');
  }

  // Mint Firebase custom token for existing child Auth UID with existing claims
  const authInstance = context.auth ?? getAuth();
  const customToken = await authInstance.createCustomToken(existingAuthUid, {
    role: 'child',
    familyId,
    childId: selectedManagedChildId,
    managedChild: true,
  });

  return { customToken, childId: selectedManagedChildId };
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

export const exchangeApprovedChildQrRequest = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  (request) => exchangeApprovedChildQrRequestImpl(request.data as any, prodCtx()),
);
