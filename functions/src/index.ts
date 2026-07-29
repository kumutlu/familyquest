// ---------------------------------------------------------------------------
// FAMILYQUEST — CLOUD FUNCTIONS ENTRY POINT
// ---------------------------------------------------------------------------
//
// Trusted backend only. These functions run with the Admin SDK and are NOT
// subject to client security rules. They are the single place push delivery
// is triggered, keeping the existing business notification system untouched.
// ---------------------------------------------------------------------------

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { setGlobalOptions } from 'firebase-functions';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  deliverNotification,
  removeAllUserTokens,
  type DeliveryContext,
  type PushNotificationInput,
} from './pushDelivery';
import { AdminGamificationRepository } from './gamificationRepository';
import { createGamificationTriggers } from './gamificationTriggers';
import { finalizeGamificationDaysOnce } from './gamificationScheduler';

// Region chosen to be close to the project's European user base.
const REGION = 'europe-west1';

setGlobalOptions({ region: REGION, maxInstances: 10, timeoutSeconds: 60 });

// Initialise Admin SDK. In the emulator / deployed environment the project is
// resolved automatically; a service-account file is only used when explicitly
// provided (keeps secrets out of source).
if (process.env.FCM_SERVICE_ACCOUNT_PATH) {
  initializeApp({ credential: cert(process.env.FCM_SERVICE_ACCOUNT_PATH) });
} else {
  initializeApp();
}

const db = getFirestore();
const messaging = getMessaging();
const gamificationRepository = new AdminGamificationRepository(db);
const gamificationTriggers = createGamificationTriggers({
  repository: gamificationRepository,
  now: () => Date.now(),
});

export const onTaskCompletionWritten = gamificationTriggers.onTaskCompletionWritten;
export const onGamificationReversalCreated = gamificationTriggers.onGamificationReversalCreated;

export const finalizeGamificationDays = onSchedule('every 60 minutes', async () => {
  await finalizeGamificationDaysOnce({ repository: gamificationRepository, now: () => Date.now() });
});

const isEmulator =
  process.env.FUNCTIONS_EMULATOR === 'true' || process.env.FIRESTORE_EMULATOR_HOST != null;

function makeContext(): DeliveryContext {
  return {
    db,
    messaging,
    serverTimestamp: () => FieldValue.serverTimestamp(),
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
export const onNotificationCreated = onDocumentCreated(
  'families/{familyId}/notifications/{notificationId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() as Record<string, unknown>;
    const input: PushNotificationInput = {
      id: snap.id,
      familyId: event.params.familyId,
      type: String(data.type ?? ''),
      actorId: String(data.actorId ?? ''),
      recipientIds: Array.isArray(data.recipientIds) ? (data.recipientIds as string[]) : [],
      title: String(data.title ?? ''),
      body: String(data.body ?? ''),
      actionUrl: typeof data.actionUrl === 'string' ? data.actionUrl : undefined,
      dedupeKey: typeof data.dedupeKey === 'string' ? data.dedupeKey : undefined,
    };

    try {
      await deliverNotification(makeContext(), input);
    } catch (err) {
      // A push failure must NEVER roll back the original business event. We
      // only log; the notification document and business data are untouched.
      console.error(
        '[push-delivery] delivery-error',
        JSON.stringify({ notificationId: input.id, message: (err as Error)?.message }),
      );
    }
  },
);

/**
 * Push-token lifecycle cleanup. When a user is deleted, or switches family,
 * every one of their push tokens (across all families) is removed so no stale
 * delivery target remains indefinitely.
 */
export const onUserWritten = onDocumentWritten(
  'users/{userId}',
  async (event) => {
    const uid = event.params.userId;
    const beforeFamily = (event.data?.before?.data() as { familyId?: string } | undefined)?.familyId;
    const after = event.data?.after?.data() as { familyId?: string; exists?: boolean } | undefined;
    const deleted = !after || after.exists === false;
    const afterFamily = after?.familyId;

    const familyChanged =
      typeof beforeFamily === 'string' &&
      typeof afterFamily === 'string' &&
      beforeFamily !== afterFamily;

    if (deleted || familyChanged) {
      try {
        const removed = await removeAllUserTokens(makeContext(), uid);
        console.log('[push-delivery] tokens-cleaned', JSON.stringify({ userId: uid, removed }));
      } catch (err) {
        console.error(
          '[push-delivery] tokens-cleanup-error',
          JSON.stringify({ userId: uid, message: (err as Error)?.message }),
        );
      }
    }
  },
);

// Parent-created child login (Phase 1) + managed login lifecycle (Phase 4A).
// Trusted callables; see childLogin.ts.
export {
  createChildLogin,
  signInChild,
  resetChildPassword,
  disableChildLogin,
  enableChildLogin,
  revokeChildSessions,
  changeChildUsername,
  completeChildPasswordChange,
} from './childLogin';

export {
  requestFamilyJoin,
  regenerateFamilyCode,
} from './familyMembership';
