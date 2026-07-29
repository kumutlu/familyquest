"use strict";
// ---------------------------------------------------------------------------
// FAMILYQUEST — CLOUD FUNCTIONS ENTRY POINT
// ---------------------------------------------------------------------------
//
// Trusted backend only. These functions run with the Admin SDK and are NOT
// subject to client security rules. They are the single place push delivery
// is triggered, keeping the existing business notification system untouched.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.regenerateFamilyCode = exports.requestFamilyJoin = exports.completeChildPasswordChange = exports.changeChildUsername = exports.revokeChildSessions = exports.enableChildLogin = exports.disableChildLogin = exports.resetChildPassword = exports.signInChild = exports.createChildLogin = exports.onUserWritten = exports.onNotificationCreated = exports.finalizeGamificationDays = exports.onGamificationReversalCreated = exports.onTaskCompletionWritten = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const messaging_1 = require("firebase-admin/messaging");
const firebase_functions_1 = require("firebase-functions");
const firestore_2 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const pushDelivery_1 = require("./pushDelivery");
const gamificationRepository_1 = require("./gamificationRepository");
const gamificationTriggers_1 = require("./gamificationTriggers");
const gamificationScheduler_1 = require("./gamificationScheduler");
// Region chosen to be close to the project's European user base.
const REGION = 'europe-west1';
(0, firebase_functions_1.setGlobalOptions)({ region: REGION, maxInstances: 10, timeoutSeconds: 60 });
// Initialise Admin SDK. In the emulator / deployed environment the project is
// resolved automatically; a service-account file is only used when explicitly
// provided (keeps secrets out of source).
if (process.env.FCM_SERVICE_ACCOUNT_PATH) {
    (0, app_1.initializeApp)({ credential: (0, app_1.cert)(process.env.FCM_SERVICE_ACCOUNT_PATH) });
}
else {
    (0, app_1.initializeApp)();
}
const db = (0, firestore_1.getFirestore)();
const messaging = (0, messaging_1.getMessaging)();
const gamificationRepository = new gamificationRepository_1.AdminGamificationRepository(db);
const gamificationTriggers = (0, gamificationTriggers_1.createGamificationTriggers)({
    repository: gamificationRepository,
    now: () => Date.now(),
});
exports.onTaskCompletionWritten = gamificationTriggers.onTaskCompletionWritten;
exports.onGamificationReversalCreated = gamificationTriggers.onGamificationReversalCreated;
exports.finalizeGamificationDays = (0, scheduler_1.onSchedule)('every 60 minutes', async () => {
    await (0, gamificationScheduler_1.finalizeGamificationDaysOnce)({ repository: gamificationRepository, now: () => Date.now() });
});
const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true' || process.env.FIRESTORE_EMULATOR_HOST != null;
function makeContext() {
    return {
        db,
        messaging,
        serverTimestamp: () => firestore_1.FieldValue.serverTimestamp(),
        // Emulator / tests never send a real push.
        dryRun: isEmulator,
        logger: (entry) => console.log('[push-delivery]', JSON.stringify(entry)),
    };
}
/**
 * Trusted push delivery. Triggered when a new notification document is created
 * by any business API. The notification document is the canonical event; we
 * only read it and never mutate it.
 */
exports.onNotificationCreated = (0, firestore_2.onDocumentCreated)('families/{familyId}/notifications/{notificationId}', async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const data = snap.data();
    const input = {
        id: snap.id,
        familyId: event.params.familyId,
        type: String(data.type ?? ''),
        actorId: String(data.actorId ?? ''),
        recipientIds: Array.isArray(data.recipientIds) ? data.recipientIds : [],
        title: String(data.title ?? ''),
        body: String(data.body ?? ''),
        actionUrl: typeof data.actionUrl === 'string' ? data.actionUrl : undefined,
        dedupeKey: typeof data.dedupeKey === 'string' ? data.dedupeKey : undefined,
    };
    try {
        await (0, pushDelivery_1.deliverNotification)(makeContext(), input);
    }
    catch (err) {
        // A push failure must NEVER roll back the original business event. We
        // only log; the notification document and business data are untouched.
        console.error('[push-delivery] delivery-error', JSON.stringify({ notificationId: input.id, message: err?.message }));
    }
});
/**
 * Push-token lifecycle cleanup. When a user is deleted, or switches family,
 * every one of their push tokens (across all families) is removed so no stale
 * delivery target remains indefinitely.
 */
exports.onUserWritten = (0, firestore_2.onDocumentWritten)('users/{userId}', async (event) => {
    const uid = event.params.userId;
    const beforeFamily = event.data?.before?.data()?.familyId;
    const after = event.data?.after?.data();
    const deleted = !after || after.exists === false;
    const afterFamily = after?.familyId;
    const familyChanged = typeof beforeFamily === 'string' &&
        typeof afterFamily === 'string' &&
        beforeFamily !== afterFamily;
    if (deleted || familyChanged) {
        try {
            const removed = await (0, pushDelivery_1.removeAllUserTokens)(makeContext(), uid);
            console.log('[push-delivery] tokens-cleaned', JSON.stringify({ userId: uid, removed }));
        }
        catch (err) {
            console.error('[push-delivery] tokens-cleanup-error', JSON.stringify({ userId: uid, message: err?.message }));
        }
    }
});
// Parent-created child login (Phase 1) + managed login lifecycle (Phase 4A).
// Trusted callables; see childLogin.ts.
var childLogin_1 = require("./childLogin");
Object.defineProperty(exports, "createChildLogin", { enumerable: true, get: function () { return childLogin_1.createChildLogin; } });
Object.defineProperty(exports, "signInChild", { enumerable: true, get: function () { return childLogin_1.signInChild; } });
Object.defineProperty(exports, "resetChildPassword", { enumerable: true, get: function () { return childLogin_1.resetChildPassword; } });
Object.defineProperty(exports, "disableChildLogin", { enumerable: true, get: function () { return childLogin_1.disableChildLogin; } });
Object.defineProperty(exports, "enableChildLogin", { enumerable: true, get: function () { return childLogin_1.enableChildLogin; } });
Object.defineProperty(exports, "revokeChildSessions", { enumerable: true, get: function () { return childLogin_1.revokeChildSessions; } });
Object.defineProperty(exports, "changeChildUsername", { enumerable: true, get: function () { return childLogin_1.changeChildUsername; } });
Object.defineProperty(exports, "completeChildPasswordChange", { enumerable: true, get: function () { return childLogin_1.completeChildPasswordChange; } });
var familyMembership_1 = require("./familyMembership");
Object.defineProperty(exports, "requestFamilyJoin", { enumerable: true, get: function () { return familyMembership_1.requestFamilyJoin; } });
Object.defineProperty(exports, "regenerateFamilyCode", { enumerable: true, get: function () { return familyMembership_1.regenerateFamilyCode; } });
//# sourceMappingURL=index.js.map