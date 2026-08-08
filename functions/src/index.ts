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
import { AdminBehaviourRepository } from './behaviourRepository';
import { createGamificationTriggers } from './gamificationTriggers';
import {
  createV4TaskApprovalEngine,
  denyStage7ByDefault,
} from './gamification/v4/taskApprovalAdapter';
import { finalizeGamificationDaysOnce } from './gamificationScheduler';
import { ensureFamilyGamificationInitialized } from './familyGamificationInit';

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
// Stage 7 / Task 7.1: the REAL V4 task-approval engine is constructed and
// injected here so the writer is production-ACTIVATABLE. It is NOT active:
// `processApprovedCompletion` resolves the route first and the default resolver
// is all-legacy, so this engine is never called. Even if a family were routed
// to v4, `denyStage7ByDefault` refuses before any write (fail closed).
const gamificationTriggers = createGamificationTriggers({
  repository: gamificationRepository,
  now: () => Date.now(),
  v4TaskApproval: createV4TaskApprovalEngine({
    db,
    verifyStage7: denyStage7ByDefault,
  }),
});

export const onTaskCompletionWritten = gamificationTriggers.onTaskCompletionWritten;
export const onGamificationReversalCreated = gamificationTriggers.onGamificationReversalCreated;

const behaviourRepository = new AdminBehaviourRepository(db);

/**
 * Server-authoritative behaviour awarding. The client only creates the
 * behaviour event; reward points, XP projection, level and the immutable
 * gamification event are all derived here, idempotently.
 */
export const onBehaviourEventCreated = onDocumentCreated(
  'families/{familyId}/behaviour_events/{behaviourEventId}',
  async (event) => {
    const result = await behaviourRepository.processBehaviourEvent({
      familyId: event.params.familyId,
      behaviourEventId: event.params.behaviourEventId,
      processingAt: event.time ? Date.parse(event.time) : Date.now(),
    });
    if (result.status === 'ignored') {
      console.warn('[behaviour-ignored]', JSON.stringify({
        familyId: event.params.familyId,
        behaviourEventId: event.params.behaviourEventId,
        reason: result.reason,
      }));
    }
  },
);

/**
 * Backstop for family creation. The client already stamps
 * `gamificationMigration` inside the family-creation transaction, so this is
 * normally a no-op; it exists so that a family created through any other path
 * can never be left in the `inactive` state that makes the processor silently
 * ignore every task completion.
 */
export const onFamilyCreatedInitializeGamification = onDocumentCreated(
  'families/{familyId}',
  async (event) => {
    const familyId = event.params.familyId;
    const result = await ensureFamilyGamificationInitialized(
      db,
      familyId,
      event.time ? new Date(event.time) : new Date(),
    );
    if (result.outcome === 'initialized' || result.outcome === 'malformed') {
      console.warn(
        '[gamification-init]',
        JSON.stringify({ familyId, outcome: result.outcome }),
      );
    }
  },
);

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

// Managed child deletion (Phase 4B).
// Trusted callable; see childDeletion.ts.
export { deleteChild } from './childDeletion';
export {
  deleteFamily,
  getFamilyDeletionStatus,
  leaveFamily,
  processFamilyDeletion,
  recoverFamilyDeletionJobs,
  purgeExpiredFamilyDeletionReceipts,
} from './familyDeletion';
export { deleteAccount } from './accountDeletion';

export {
  requestFamilyJoin,
  regenerateFamilyCode,
} from './familyMembership';

// Role-authoritative invitation records; see familyInvitations.ts. The
// resulting family role is always derived server-side from the stored
// invitation, never from client input or URL parameters.
export {
  createFamilyInvitation,
  previewInvitation,
  acceptInvitation,
} from './familyInvitations';

// Child join request with mandatory parent approval; see childJoinRequest.ts.
export {
  submitChildJoinRequest,
  getChildJoinRequestStatus,
  cancelChildJoinRequest,
  approveChildJoinRequest,
  rejectChildJoinRequest,
  purgeExpiredChildJoinRequests,
} from './childJoinRequest';
