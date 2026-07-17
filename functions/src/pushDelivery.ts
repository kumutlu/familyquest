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

import type { Firestore, Query } from 'firebase-admin/firestore';
import type { Messaging } from 'firebase-admin/messaging';

/** FCM multicast hard limit per send call. */
export const PUSH_BATCH_SIZE = 500;

/** Schema version stamped on every delivery record (safe to evolve later). */
export const DELIVERY_VERSION = 1;

/**
 * Events intentionally kept in-app only for this sprint. These are still
 * delivered as in-app notifications; they simply do not trigger a push.
 */
export const PUSH_DISABLED_TYPES = new Set<string>([
  'petbox_contribution',
  'petbox_expense',
]);

/** Minimal shape of a notification document we consume. */
export interface PushNotificationInput {
  id: string;
  familyId: string;
  type: string;
  actorId: string;
  recipientIds: string[];
  title: string;
  body: string;
  actionUrl?: string;
  dedupeKey?: string;
}

/** A token resolved from Firestore, with a bound delete for cleanup. */
export interface ResolvedToken {
  id: string;
  userId: string;
  familyId: string;
  token: string;
  enabled: boolean;
  delete: () => Promise<unknown>;
}

/** Injected backend dependencies (real Admin SDK in production, mocks in tests). */
export interface DeliveryContext {
  db: Firestore;
  messaging: Messaging;
  /** Returns a server-timestamp placeholder for records. */
  serverTimestamp: () => unknown;
  /** Structured observability sink. Never logs raw tokens or full bodies. */
  logger?: (entry: Record<string, unknown>) => void;
  /** When true, no real FCM send occurs (emulator / tests). */
  dryRun?: boolean;
}

export interface DeliveryRecord {
  notificationId: string;
  status: 'completed' | 'skipped' | 'failed';
  attemptedAt: unknown;
  completedAt?: unknown;
  tokenCount: number;
  successCount: number;
  failureCount: number;
  retryCount?: number;
  lastErrorCode?: string;
  deliveryVersion: number;
}

export interface DeliveryResult {
  status: 'completed' | 'skipped' | 'noop' | 'error';
  tokenCount: number;
  successCount: number;
  failureCount: number;
  invalidRemoved: number;
  reason?: string;
}

// ---------------------------------------------------------------------------
// PURE HELPERS
// ---------------------------------------------------------------------------

/** Deduplicate and drop empty recipient ids. */
export function resolveRecipientIds(input: PushNotificationInput): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of input.recipientIds ?? []) {
    if (typeof r === 'string' && r.length > 0 && !seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

/** Quiet (in-app only) vs pushable event classification. */
export function classifyDelivery(input: PushNotificationInput): 'send' | 'skip_quiet' {
  if (PUSH_DISABLED_TYPES.has(input.type)) return 'skip_quiet';
  return 'send';
}

/**
 * Reuse the existing notification route. The notification document already
 * carries the canonical `actionUrl` produced by the central route mapping, so
 * we forward that rather than recomputing or duplicating routing logic.
 */
export function resolveRoute(input: PushNotificationInput): string {
  if (typeof input.actionUrl === 'string' && input.actionUrl.startsWith('/')) {
    return input.actionUrl;
  }
  return '/';
}

/**
 * Build the minimal push payload. The deterministic tag uses the notification
 * dedupe key (or id) so the browser collapses retries into a single card.
 */
export function buildPushMessage(input: PushNotificationInput): {
  notification: { title: string; body: string; tag: string };
  data: Record<string, string>;
  android: { notification: { tag: string } };
  webpush: { notification: { tag: string; icon: string; badge: string } };
} {
  const tag = input.dedupeKey || input.id;
  const route = resolveRoute(input);
  const data: Record<string, string> = {
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
export function isInvalidTokenError(code: unknown): boolean {
  if (typeof code !== 'string') return false;
  return (
    code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token'
  );
}

// ---------------------------------------------------------------------------
// FIRESTORE / FCM INTERACTIONS
// ---------------------------------------------------------------------------

/** Load enabled push tokens for the given recipients within the family. */
export async function loadEnabledTokens(
  ctx: DeliveryContext,
  familyId: string,
  recipientIds: string[],
): Promise<ResolvedToken[]> {
  if (recipientIds.length === 0) return [];
  const snap = await (ctx.db
    .collectionGroup('push_tokens')
    .where('familyId', '==', familyId)
    .where('userId', 'in', recipientIds)
    .where('enabled', '==', true) as Query)
    .get();
  return snap.docs.map((d) => ({
    id: d.id,
    userId: (d.data() as { userId: string }).userId,
    familyId: (d.data() as { familyId: string }).familyId,
    token: (d.data() as { token: string }).token,
    enabled: (d.data() as { enabled: boolean }).enabled,
    delete: () => d.ref.delete(),
  }));
}

/** Send to a list of tokens in FCM-bounded batches. */
export async function sendToTokens(
  ctx: DeliveryContext,
  message: ReturnType<typeof buildPushMessage>,
  tokens: ResolvedToken[],
): Promise<{ successCount: number; failureCount: number; invalid: ResolvedToken[] }> {
  const log = ctx.logger ?? (() => {});
  if (tokens.length === 0) return { successCount: 0, failureCount: 0, invalid: [] };
  let successCount = 0;
  let failureCount = 0;
  const invalid: ResolvedToken[] = [];

  for (let i = 0; i < tokens.length; i += PUSH_BATCH_SIZE) {
    const batch = tokens.slice(i, i + PUSH_BATCH_SIZE);
    const batchTokens = batch.map((t) => t.token);
    let responses: Array<{ success: boolean; error?: { code?: string; message?: string } }>;

    if (ctx.dryRun) {
      responses = batchTokens.map(() => ({ success: true }));
    } else {
      const result = await ctx.messaging.sendEachForMulticast({
        tokens: batchTokens,
        notification: message.notification,
        data: message.data,
        android: message.android,
        webpush: message.webpush,
      });
      responses = result.responses as Array<{
        success: boolean;
        error?: { code?: string; message?: string };
      }>;
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
      } else {
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
        if (isInvalidTokenError(r.error?.code)) invalid.push(recipient);
      }
    });
  }
  return { successCount, failureCount, invalid };
}

/** True when a delivery record already completed (idempotency guard). */
export async function isDeliveryComplete(
  ctx: DeliveryContext,
  familyId: string,
  notificationId: string,
): Promise<boolean> {
  const ref = ctx.db
    .collection('families')
    .doc(familyId)
    .collection('notification_deliveries')
    .doc(notificationId);
  const snap = await ref.get();
  return snap.exists && (snap.data() as { status?: string } | undefined)?.status === 'completed';
}

/** Write (merge) the delivery record. Backend-only path. */
export async function recordDelivery(
  ctx: DeliveryContext,
  familyId: string,
  input: PushNotificationInput,
  record: DeliveryRecord,
): Promise<void> {
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
export async function deliverNotification(
  ctx: DeliveryContext,
  input: PushNotificationInput,
): Promise<DeliveryResult> {
  const log = ctx.logger ?? (() => {});

  // 1. Defensive validation of required fields.
  if (
    !input ||
    typeof input.id !== 'string' ||
    typeof input.familyId !== 'string' ||
    typeof input.type !== 'string' ||
    !Array.isArray(input.recipientIds)
  ) {
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
      deliveryVersion: DELIVERY_VERSION,
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
    deliveryVersion: DELIVERY_VERSION,
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
export async function removeAllUserTokens(
  ctx: DeliveryContext,
  userId: string,
): Promise<number> {
  const snap = await ctx.db
    .collectionGroup('push_tokens')
    .where('userId', '==', userId)
    .get();
  if (snap.empty) return 0;
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
  return snap.size;
}
