"use strict";
// ---------------------------------------------------------------------------
// FAMILYQUEST — TRUSTED PUSH DELIVERY CORE
// ---------------------------------------------------------------------------
//
// This module contains the push-delivery business logic. It is intentionally
// free of any runtime dependency on firebase-admin / firebase-functions so it
// can be unit-tested with lightweight mocks (see tests/functions).
//
// Design rules honoured:
//  - The Firestore notification document is the canonical event. We never
//    modify it and never create a second in-app notification.
//  - Delivery is idempotent: a completed delivery record short-circuits retries.
//  - Only enabled tokens for the resolved recipients are loaded.
//  - Invalid / unregistered tokens are removed so they stop targeting the user.
//  - No raw FCM token or full sensitive body is ever logged.
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUSH_DISABLED_TYPES = exports.DELIVERY_VERSION = exports.PUSH_BATCH_SIZE = void 0;
exports.resolveRecipientIds = resolveRecipientIds;
exports.classifyDelivery = classifyDelivery;
exports.resolveRoute = resolveRoute;
exports.buildPushMessage = buildPushMessage;
exports.isInvalidTokenError = isInvalidTokenError;
exports.loadEnabledTokens = loadEnabledTokens;
exports.sendToTokens = sendToTokens;
exports.isDeliveryComplete = isDeliveryComplete;
exports.recordDelivery = recordDelivery;
exports.deliverNotification = deliverNotification;
exports.removeAllUserTokens = removeAllUserTokens;
/** FCM multicast hard limit per send call. */
exports.PUSH_BATCH_SIZE = 500;
/** Schema version stamped on every delivery record (safe to evolve later). */
exports.DELIVERY_VERSION = 1;
/**
 * Events intentionally kept in-app only for this sprint. These are still
 * delivered as in-app notifications; they simply do not trigger a push.
 */
exports.PUSH_DISABLED_TYPES = new Set([
    'petbox_contribution',
    'petbox_expense',
]);
// ---------------------------------------------------------------------------
// PURE HELPERS
// ---------------------------------------------------------------------------
/** Deduplicate and drop empty recipient ids. */
function resolveRecipientIds(input) {
    const seen = new Set();
    const out = [];
    for (const r of input.recipientIds ?? []) {
        if (typeof r === 'string' && r.length > 0 && !seen.has(r)) {
            seen.add(r);
            out.push(r);
        }
    }
    return out;
}
/** Quiet (in-app only) vs pushable event classification. */
function classifyDelivery(input) {
    if (exports.PUSH_DISABLED_TYPES.has(input.type))
        return 'skip_quiet';
    return 'send';
}
/**
 * Reuse the existing notification route. The notification document already
 * carries the canonical `actionUrl` produced by the central route mapping, so
 * we forward that rather than recomputing or duplicating routing logic.
 */
function resolveRoute(input) {
    if (typeof input.actionUrl === 'string' && input.actionUrl.startsWith('/')) {
        return input.actionUrl;
    }
    return '/';
}
/**
 * Build the minimal push payload. The deterministic tag uses the notification
 * dedupe key (or id) so the browser collapses retries into a single card.
 */
function buildPushMessage(input) {
    const tag = input.dedupeKey || input.id;
    const route = resolveRoute(input);
    const data = {
        notificationId: input.id,
        familyId: input.familyId,
        type: input.type,
        route,
        title: input.title,
        body: input.body,
    };
    return {
        notification: { title: input.title, body: input.body, tag },
        data,
        android: { notification: { tag } },
        webpush: {
            notification: { tag, icon: '/pwa-192x192.png', badge: '/pwa-192x192.png' },
        },
    };
}
/** Token errors that mean the registration is dead and should be removed. */
function isInvalidTokenError(code) {
    if (typeof code !== 'string')
        return false;
    return (code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token');
}
// ---------------------------------------------------------------------------
// FIRESTORE / FCM INTERACTIONS
// ---------------------------------------------------------------------------
/** Load enabled push tokens for the given recipients within the family. */
async function loadEnabledTokens(ctx, familyId, recipientIds) {
    if (recipientIds.length === 0)
        return [];
    const snap = await ctx.db
        .collectionGroup('push_tokens')
        .where('familyId', '==', familyId)
        .where('userId', 'in', recipientIds)
        .where('enabled', '==', true)
        .get();
    return snap.docs.map((d) => ({
        id: d.id,
        userId: d.data().userId,
        familyId: d.data().familyId,
        token: d.data().token,
        enabled: d.data().enabled,
        delete: () => d.ref.delete(),
    }));
}
/** Send to a list of tokens in FCM-bounded batches. */
async function sendToTokens(ctx, message, tokens) {
    const log = ctx.logger ?? (() => { });
    if (tokens.length === 0)
        return { successCount: 0, failureCount: 0, invalid: [] };
    let successCount = 0;
    let failureCount = 0;
    const invalid = [];
    for (let i = 0; i < tokens.length; i += exports.PUSH_BATCH_SIZE) {
        const batch = tokens.slice(i, i + exports.PUSH_BATCH_SIZE);
        const batchTokens = batch.map((t) => t.token);
        let responses;
        if (ctx.dryRun) {
            responses = batchTokens.map(() => ({ success: true }));
        }
        else {
            const result = await ctx.messaging.sendEachForMulticast({
                tokens: batchTokens,
                notification: message.notification,
                data: message.data,
                android: message.android,
                webpush: message.webpush,
            });
            responses = result.responses;
        }
        responses.forEach((r, idx) => {
            // FCM returns responses in the same order as the tokens array, so the
            // absolute index (i + idx) maps to tokens[i + idx] and the batch-relative
            // index (idx) maps to batch[idx]. We log the recipient userId, never the
            // raw FCM token.
            const absoluteIndex = i + idx;
            const recipient = batch[idx];
            if (r.success) {
                successCount++;
            }
            else {
                failureCount++;
                log({
                    event: 'push_send_failure',
                    responseIndex: absoluteIndex,
                    batchIndex: idx,
                    userId: recipient?.userId,
                    tokenId: recipient?.id,
                    errorCode: r.error?.code,
                    errorMessage: r.error?.message,
                });
                if (isInvalidTokenError(r.error?.code))
                    invalid.push(recipient);
            }
        });
    }
    return { successCount, failureCount, invalid };
}
/** True when a delivery record already completed (idempotency guard). */
async function isDeliveryComplete(ctx, familyId, notificationId) {
    const ref = ctx.db
        .collection('families')
        .doc(familyId)
        .collection('notification_deliveries')
        .doc(notificationId);
    const snap = await ref.get();
    return snap.exists && snap.data()?.status === 'completed';
}
/** Write (merge) the delivery record. Backend-only path. */
async function recordDelivery(ctx, familyId, input, record) {
    const ref = ctx.db
        .collection('families')
        .doc(familyId)
        .collection('notification_deliveries')
        .doc(input.id);
    await ref.set(record, { merge: true });
}
// ---------------------------------------------------------------------------
// ORCHESTRATOR
// ---------------------------------------------------------------------------
/**
 * Deliver a push for a single notification document. Safe to call on Function
 * retry: a completed delivery is a no-op, and quiet events are recorded once.
 */
async function deliverNotification(ctx, input) {
    const log = ctx.logger ?? (() => { });
    // 1. Defensive validation of required fields.
    if (!input ||
        typeof input.id !== 'string' ||
        typeof input.familyId !== 'string' ||
        typeof input.type !== 'string' ||
        !Array.isArray(input.recipientIds)) {
        log({ event: 'push_validation_failed', notificationId: input?.id });
        return {
            status: 'noop',
            tokenCount: 0,
            successCount: 0,
            failureCount: 0,
            invalidRemoved: 0,
            reason: 'invalid_notification',
        };
    }
    // 2. Idempotency: never re-send a completed delivery.
    if (await isDeliveryComplete(ctx, input.familyId, input.id)) {
        log({ event: 'push_skipped_complete', notificationId: input.id });
        return {
            status: 'noop',
            tokenCount: 0,
            successCount: 0,
            failureCount: 0,
            invalidRemoved: 0,
            reason: 'already_delivered',
        };
    }
    // 3. Quiet events: record once, send nothing.
    if (classifyDelivery(input) === 'skip_quiet') {
        await recordDelivery(ctx, input.familyId, input, {
            notificationId: input.id,
            status: 'skipped',
            attemptedAt: ctx.serverTimestamp(),
            tokenCount: 0,
            successCount: 0,
            failureCount: 0,
            deliveryVersion: exports.DELIVERY_VERSION,
        });
        log({ event: 'push_skipped_quiet', notificationId: input.id, type: input.type });
        return {
            status: 'skipped',
            tokenCount: 0,
            successCount: 0,
            failureCount: 0,
            invalidRemoved: 0,
        };
    }
    // 4. Resolve recipients and load their enabled tokens.
    const recipients = resolveRecipientIds(input);
    const tokens = await loadEnabledTokens(ctx, input.familyId, recipients);
    // 5. Build content and send (batched, emulator-safe).
    const message = buildPushMessage(input);
    // Diagnostic: log the final WebPush message structure (no tokens, no raw
    // bodies beyond the already-canonical notification/data fields) so we can
    // confirm what was actually sent without leaking sensitive registration data.
    log({
        event: 'push_message_structure',
        notification: message.notification,
        data: message.data,
        android: message.android,
        webpush: message.webpush,
    });
    const sendResult = await sendToTokens(ctx, message, tokens);
    // 6. Remove invalid / unregistered tokens so they stop targeting the user.
    let invalidRemoved = 0;
    if (sendResult.invalid.length > 0) {
        await Promise.all(sendResult.invalid.map((t) => t.delete().catch(() => undefined)));
        invalidRemoved = sendResult.invalid.length;
    }
    // 7. Record aggregate status (never the immutable notification content).
    await recordDelivery(ctx, input.familyId, input, {
        notificationId: input.id,
        status: 'completed',
        attemptedAt: ctx.serverTimestamp(),
        completedAt: ctx.serverTimestamp(),
        tokenCount: tokens.length,
        successCount: sendResult.successCount,
        failureCount: sendResult.failureCount,
        deliveryVersion: exports.DELIVERY_VERSION,
    });
    log({
        event: 'push_delivered',
        notificationId: input.id,
        type: input.type,
        recipientCount: recipients.length,
        tokenCount: tokens.length,
        successCount: sendResult.successCount,
        failureCount: sendResult.failureCount,
        invalidRemoved,
    });
    return {
        status: 'completed',
        tokenCount: tokens.length,
        successCount: sendResult.successCount,
        failureCount: sendResult.failureCount,
        invalidRemoved,
    };
}
/**
 * Remove every push token belonging to a user across all families. Used when a
 * user is deleted or switches family, so no stale delivery target remains.
 */
async function removeAllUserTokens(ctx, userId) {
    const snap = await ctx.db
        .collectionGroup('push_tokens')
        .where('userId', '==', userId)
        .get();
    if (snap.empty)
        return 0;
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
    return snap.size;
}
//# sourceMappingURL=pushDelivery.js.map