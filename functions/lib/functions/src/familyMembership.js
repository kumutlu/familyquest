"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.regenerateFamilyCode = exports.requestFamilyJoin = void 0;
exports.requestFamilyJoinImpl = requestFamilyJoinImpl;
exports.regenerateFamilyCodeImpl = regenerateFamilyCodeImpl;
const crypto_1 = require("crypto");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;
const FAMILY_CODE = /^[A-Z0-9]{6}$/;
function requireUid(request) {
    const uid = request.auth?.uid;
    if (!uid)
        throw new https_1.HttpsError('unauthenticated', 'AUTH_REQUIRED');
    return uid;
}
function validateRequestId(value) {
    if (typeof value !== 'string' || !REQUEST_ID.test(value)) {
        throw new https_1.HttpsError('invalid-argument', 'INVALID_REQUEST_ID');
    }
    return value;
}
function defaultCode() {
    return Array.from({ length: 6 }, () => CODE_ALPHABET[(0, crypto_1.randomInt)(CODE_ALPHABET.length)]).join('');
}
async function familyByCode(db, code) {
    const snapshot = await db.collection('families').where('inviteCode', '==', code).limit(2).get();
    if (snapshot.empty || snapshot.docs.length !== 1) {
        throw new https_1.HttpsError('not-found', 'INVALID_FAMILY_CODE');
    }
    return snapshot.docs[0];
}
async function enforceJoinRateLimit(context, uid, clientReqId) {
    const attemptRef = context.db.doc(`familyJoinAttempts/${uid}_${clientReqId}`);
    const rateRef = context.db.doc(`familyJoinRateLimits/${uid}`);
    const nowMs = (context.now ?? (() => new Date()))().getTime();
    await context.db.runTransaction(async (transaction) => {
        const [attempt, rate] = await Promise.all([
            transaction.get(attemptRef),
            transaction.get(rateRef),
        ]);
        if (attempt.exists)
            return;
        const current = rate.data();
        const withinWindow = typeof current?.windowStartedAtMs === 'number' &&
            nowMs - current.windowStartedAtMs < 15 * 60 * 1000;
        const count = withinWindow && typeof current?.count === 'number' ? current.count : 0;
        if (count >= 10)
            throw new https_1.HttpsError('resource-exhausted', 'TOO_MANY_JOIN_ATTEMPTS');
        transaction.set(attemptRef, {
            operation: 'family-code-attempt',
            requesterUid: uid,
            phase: 'recorded',
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        transaction.set(rateRef, {
            windowStartedAtMs: withinWindow ? current.windowStartedAtMs : nowMs,
            count: count + 1,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
    });
}
async function requestFamilyJoinImpl(input, request, context) {
    const uid = requireUid(request);
    const clientReqId = validateRequestId(input?.clientReqId);
    const familyCode = typeof input?.familyCode === 'string'
        ? input.familyCode.trim().toUpperCase()
        : '';
    if (!FAMILY_CODE.test(familyCode)) {
        throw new https_1.HttpsError('invalid-argument', 'INVALID_FAMILY_CODE');
    }
    const profileRef = context.db.doc(`users/${uid}`);
    const profileSnapshot = await profileRef.get();
    const profile = profileSnapshot.data();
    if (!profileSnapshot.exists || typeof profile?.displayName !== 'string' || !profile.displayName.trim()) {
        throw new https_1.HttpsError('failed-precondition', 'PROFILE_REQUIRED');
    }
    if (typeof profile.familyId === 'string' && profile.familyId) {
        throw new https_1.HttpsError('failed-precondition', 'ALREADY_IN_FAMILY');
    }
    await enforceJoinRateLimit(context, uid, clientReqId);
    const family = await familyByCode(context.db, familyCode);
    const familyId = family.id;
    const requestRef = context.db.doc(`families/${familyId}/join_requests/${uid}`);
    const operationRef = context.db.doc(`familyMembershipIdempotency/${uid}_${clientReqId}`);
    return context.db.runTransaction(async (transaction) => {
        const [latestProfile, existingRequest, existingOperation] = await Promise.all([
            transaction.get(profileRef),
            transaction.get(requestRef),
            transaction.get(operationRef),
        ]);
        if (latestProfile.data()?.familyId) {
            throw new https_1.HttpsError('failed-precondition', 'ALREADY_IN_FAMILY');
        }
        const operation = existingOperation.data();
        if (existingOperation.exists) {
            if (operation?.operation !== 'request-family-join' || operation?.familyId !== familyId) {
                throw new https_1.HttpsError('already-exists', 'REQUEST_ID_REUSED');
            }
            return { familyId, status: 'pending' };
        }
        if (existingRequest.exists) {
            if (existingRequest.data()?.status === 'pending') {
                return { familyId, status: 'pending' };
            }
            throw new https_1.HttpsError('failed-precondition', 'REQUEST_ALREADY_PROCESSED');
        }
        transaction.set(requestRef, {
            uid,
            displayName: profile.displayName.trim(),
            status: 'pending',
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        transaction.set(operationRef, {
            operation: 'request-family-join',
            requesterUid: uid,
            familyId,
            phase: 'complete',
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        return { familyId, status: 'pending' };
    });
}
async function regenerateFamilyCodeImpl(input, request, context) {
    const uid = requireUid(request);
    const clientReqId = validateRequestId(input?.clientReqId);
    const profile = (await context.db.doc(`users/${uid}`).get()).data();
    if (!profile?.familyId || profile.role !== 'owner') {
        throw new https_1.HttpsError('permission-denied', 'OWNER_REQUIRED');
    }
    const familyId = String(profile.familyId);
    const familyRef = context.db.doc(`families/${familyId}`);
    const operationRef = context.db.doc(`familyMembershipIdempotency/${uid}_${clientReqId}`);
    const prior = await operationRef.get();
    if (prior.exists) {
        const data = prior.data();
        if (data?.operation !== 'regenerate-family-code' || data?.familyId !== familyId) {
            throw new https_1.HttpsError('already-exists', 'REQUEST_ID_REUSED');
        }
        const family = await familyRef.get();
        return { familyCode: String(family.data()?.inviteCode ?? '') };
    }
    let familyCode = '';
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = (context.generateCode ?? defaultCode)();
        if (!FAMILY_CODE.test(candidate))
            throw new https_1.HttpsError('internal', 'CODE_GENERATION_FAILED');
        const collision = await context.db.collection('families').where('inviteCode', '==', candidate).limit(1).get();
        if (collision.empty) {
            familyCode = candidate;
            break;
        }
    }
    if (!familyCode)
        throw new https_1.HttpsError('resource-exhausted', 'CODE_GENERATION_FAILED');
    return context.db.runTransaction(async (transaction) => {
        const [family, operation] = await Promise.all([
            transaction.get(familyRef),
            transaction.get(operationRef),
        ]);
        if (!family.exists)
            throw new https_1.HttpsError('not-found', 'FAMILY_NOT_FOUND');
        if (operation.exists)
            return { familyCode: String(family.data()?.inviteCode ?? '') };
        transaction.update(familyRef, { inviteCode: familyCode });
        transaction.set(operationRef, {
            operation: 'regenerate-family-code',
            requesterUid: uid,
            familyId,
            phase: 'complete',
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
        return { familyCode };
    });
}
const productionContext = () => ({ db: (0, firestore_1.getFirestore)() });
exports.requestFamilyJoin = (0, https_1.onCall)({ region: 'europe-west1', enforceAppCheck: false }, request => requestFamilyJoinImpl(request.data, request, productionContext()));
exports.regenerateFamilyCode = (0, https_1.onCall)({ region: 'europe-west1', enforceAppCheck: false }, request => regenerateFamilyCodeImpl(request.data, request, productionContext()));
//# sourceMappingURL=familyMembership.js.map