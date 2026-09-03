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
