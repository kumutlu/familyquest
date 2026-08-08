// ---------------------------------------------------------------------------
// FAMILYQUEST — MANAGED CHILD DELETION (backend)
// ---------------------------------------------------------------------------
//
// Trusted callable that permanently removes a managed child from the
// family. All deletion is server-authoritative; the client only supplies
// the child ID and an exact display-name confirmation.
//
// Security invariants
// -------------------
//  * Caller must be authenticated.
//  * Caller must be owner or parent in the SAME family as the target.
//  * Target must be authoritatively classified as a managed child
//    (role=child, isManaged=true).
//  * Target must not be the caller.
//  * Exact display-name confirmation must match the target's current
//    displayName at the time of deletion.
//  * Sessions are disabled and revoked BEFORE Auth deletion so the child
//    cannot authenticate during the deletion window.
//  * Missing Auth or Firestore doc records are treated idempotently
//    (already-deleted state is not an error).
//  * No passwords, family codes, synthetic identifiers, or credentials
//    are ever logged.
//
// Deletion scope (all server-side, in a single Firestore transaction
// where possible; Auth deletion is outside the transaction because it
// is a separate service).
//  * Firebase Auth user (disabled + revoked first, then deleted)
//  * users/{childUid}
//  * family membership (the user doc itself is deleted)
//  * child-login metadata (families/{familyId}/childLogins/{childId})
//  * username index (families/{familyId}/childLoginIndex/{normalizedUsername})
//  * active member-specific state (notifications, pending approvals,
//    task completions, behaviour events, wallet/gamification projections)
//  * pending approvals/notifications tied ONLY to that child
//  * tasks or assignments according to the existing approved product rule
//  * wallet/gamification projections owned only by that child
//
// Preserved (unrelated family members and family data are untouched):
//  * Other family members' user docs
//  * Family document itself
//  * Other children's login records, indexes, and Auth users
//  * Family-wide announcements, settings, and data
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';
import { getAuth, type Auth } from 'firebase-admin/auth';
import {
  getFirestore,
  FieldValue,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from 'firebase-functions/v2/https';
import { purgeUserDailyCheckinRecords } from './dailyCheckinCleanup';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeleteChildInput {
  childId: string;
  displayNameConfirmation: string;
  clientReqId: string;
}

export interface DeleteChildResult {
  childId: string;
  deleted: boolean;
}

export interface ChildDeletionContext {
  auth: Auth;
  db: Firestore;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USERS = 'users';
const FAMILIES = 'families';
const CHILD_LOGINS = 'childLogins';
const CHILD_LOGIN_INDEX = 'childLoginIndex';
const CHILD_LOGIN_AUDIT = 'childLoginAudit';
const CHILD_LOGIN_IDEMPOTENCY = 'childLoginIdempotency';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computePayloadHash(childId: string, displayNameConfirmation: string): string {
  return createHash('sha256')
    .update(`${childId}|${displayNameConfirmation}`)
    .digest('hex');
}

function requireUid(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'AUTH_REQUIRED');
  return uid;
}

function validateDeleteChildInput(input: unknown): DeleteChildInput {
  if (!input || typeof input !== 'object') {
    throw new HttpsError('invalid-argument', 'BAD_REQUEST');
  }
  const data = input as Record<string, unknown>;
  if (typeof data.childId !== 'string' || !data.childId) {
    throw new HttpsError('invalid-argument', 'CHILD_ID_REQUIRED');
  }
  if (typeof data.displayNameConfirmation !== 'string' || !data.displayNameConfirmation.trim()) {
    throw new HttpsError('invalid-argument', 'DISPLAY_NAME_CONFIRMATION_REQUIRED');
  }
  if (typeof data.clientReqId !== 'string' || !data.clientReqId) {
    throw new HttpsError('invalid-argument', 'CLIENT_REQ_ID_REQUIRED');
  }
  return {
    childId: data.childId,
    displayNameConfirmation: data.displayNameConfirmation.trim(),
    clientReqId: data.clientReqId,
  };
}

function assertCallerIsParentOrOwner(
  callerDoc: Record<string, unknown>,
  familyId: string,
): void {
  const callerFamilyId = callerDoc.familyId;
  const callerRole = callerDoc.role;
  if (
    typeof callerFamilyId !== 'string' ||
    callerFamilyId !== familyId ||
    (callerRole !== 'owner' && callerRole !== 'parent')
  ) {
    throw new HttpsError('permission-denied', 'NOT_AUTHORIZED');
  }
}

function assertTargetIsManagedChild(
  childDoc: Record<string, unknown>,
  familyId: string,
  callerUid: string,
): void {
  if (!childDoc || typeof childDoc !== 'object') {
    throw new HttpsError('not-found', 'CHILD_NOT_FOUND');
  }
  const childFamilyId = childDoc.familyId;
  const childRole = childDoc.role;
  const childIsManaged = childDoc.isManaged;
  const childDisabled = childDoc.disabled;
  const childStatus = childDoc.status;

  if (typeof childFamilyId !== 'string' || childFamilyId !== familyId) {
    throw new HttpsError('permission-denied', 'CHILD_NOT_IN_FAMILY');
  }
  if (childRole !== 'child' || childIsManaged !== true) {
    throw new HttpsError('failed-precondition', 'CHILD_NOT_MANAGED');
  }
  if (childDisabled === true || childStatus === 'deleted') {
    throw new HttpsError('failed-precondition', 'CHILD_INACTIVE');
  }
}

async function purgeDailyCheckinRecords(
  db: Firestore,
  familyId: string,
  childId: string,
): Promise<void> {
  const BATCH_LIMIT = 500;
  for (const collectionName of ['daily_checkins', 'daily_checkin_skips']) {
    while (true) {
      const snapshot = await db
        .collection(`${FAMILIES}/${familyId}/${collectionName}`)
        .where('userId', '==', childId)
        .limit(BATCH_LIMIT)
        .get();
      if (snapshot.empty) break;

      const batch = db.batch();
      for (const doc of snapshot.docs) batch.delete(doc.ref);
      await batch.commit();
    }
  }
}

// ---------------------------------------------------------------------------
// Core implementation (injectable context for testing)
// ---------------------------------------------------------------------------

export async function deleteChildImpl(
  ctx: ChildDeletionContext,
  callerUid: string,
  input: DeleteChildInput,
): Promise<DeleteChildResult> {
  const { childId, displayNameConfirmation, clientReqId } = input;
  const { db, auth } = ctx;

  // --- Fetch caller profile first (needed for familyId) -----------
  const callerSnap = await db.doc(`${USERS}/${callerUid}`).get();
  if (!callerSnap.exists) {
    throw new HttpsError('permission-denied', 'CALLER_NOT_FOUND');
  }
  const caller = callerSnap.data() as Record<string, unknown>;
  const callerFamilyId = caller.familyId as string | undefined;

  // --- Fetch target child profile ---------------------------------
  const childRef = db.doc(`${USERS}/${childId}`);
  const childSnap = await childRef.get();
  if (!childSnap.exists) {
    // A profileless target can no longer supply its family or authorization
    // boundary. Only an exact attempt created after normal authorization may
    // resume the global cleanup.
    if (typeof callerFamilyId !== 'string') {
      throw new HttpsError('permission-denied', 'NOT_AUTHORIZED');
    }
    assertCallerIsParentOrOwner(caller, callerFamilyId);

    const idemRef = db.doc(
      `${FAMILIES}/${callerFamilyId}/${CHILD_LOGIN_IDEMPOTENCY}/${clientReqId}`,
    );
    const idemSnap = await idemRef.get();
    if (!idemSnap.exists) {
      return { childId, deleted: false };
    }

    const idemData = idemSnap.data() as Record<string, unknown>;
    const status = idemData.status;
    if (
      idemData.clientReqId !== clientReqId ||
      idemData.operation !== 'deleteChild' ||
      idemData.childId !== childId ||
      idemData.payloadHash !== computePayloadHash(childId, displayNameConfirmation) ||
      (status !== 'processing' && status !== 'failed' && status !== 'completed')
    ) {
      throw new HttpsError('already-exists', 'IDEMPOTENCY_ATTEMPT_MISMATCH');
    }
    if (idemData.requesterUid !== callerUid) {
      throw new HttpsError('permission-denied', 'IDEMPOTENCY_CALLER_MISMATCH');
    }

    await purgeUserDailyCheckinRecords(db, childId);
    if (status === 'completed') {
      return idemData.result as DeleteChildResult;
    }

    await idemRef.update({
      status: 'completed',
      phase: 'completed',
      result: { childId, deleted: false },
      completedAt: FieldValue.serverTimestamp(),
    });
    return { childId, deleted: false };
  }
  const child = childSnap.data() as Record<string, unknown>;

  // --- Authorize caller -------------------------------------------
  const familyId = child.familyId as string;
  if (typeof familyId !== 'string') {
    throw new HttpsError('not-found', 'CHILD_NOT_IN_FAMILY');
  }
  assertCallerIsParentOrOwner(caller, familyId);

  // --- Authorize target -------------------------------------------
  assertTargetIsManagedChild(child, familyId, callerUid);

  // --- Caller must not be the target ------------------------------
  if (callerUid === childId) {
    throw new HttpsError('permission-denied', 'CANNOT_DELETE_SELF');
  }

  // --- Display name confirmation ----------------------------------
  const currentDisplayName = child.displayName as string;
  if (currentDisplayName !== displayNameConfirmation) {
    throw new HttpsError(
      'invalid-argument',
      'DISPLAY_NAME_MISMATCH',
    );
  }

  // --- Resolve Auth UID (may be absent for profile-only managed children)
  const authUid = (child.authUid as string) || undefined;

  // --- Idempotency precheck (same clientReqId = same result) ------
  const idemRef = db.doc(`${FAMILIES}/${familyId}/${CHILD_LOGIN_IDEMPOTENCY}/${clientReqId}`);
  const idemSnap = await idemRef.get();
  if (idemSnap.exists) {
    const idemData = idemSnap.data() as Record<string, unknown>;
    if (idemData.status === 'completed') {
      // Verify payload hash matches — replay with different payload is rejected
      const storedHash = idemData.payloadHash as string | undefined;
      const currentHash = computePayloadHash(childId, displayNameConfirmation);
      if (storedHash !== currentHash) {
        throw new HttpsError('already-exists', 'IDEMPOTENCY_PAYLOAD_MISMATCH');
      }
      return idemData.result as DeleteChildResult;
    }
    // processing/failed with same payload => allow retry
    const storedHash = idemData.payloadHash as string | undefined;
    const currentHash = computePayloadHash(childId, displayNameConfirmation);
    if (storedHash !== currentHash) {
      throw new HttpsError('already-exists', 'IDEMPOTENCY_PAYLOAD_MISMATCH');
    }
  }

  // --- Idempotency marker -----------------------------------------
  if (!idemSnap.exists) {
    await idemRef.set({
      clientReqId,
      operation: 'deleteChild',
      childId,
      requesterUid: callerUid,
      payloadHash: computePayloadHash(childId, displayNameConfirmation),
      phase: 'processing',
      status: 'processing',
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  // --- Phase 1: Disable and revoke sessions on Auth user ---------
  if (authUid) {
    try {
      await auth.updateUser(authUid, { disabled: true });
    } catch {
      // Auth user may already be disabled or deleted; continue idempotently
    }
    try {
      await auth.revokeRefreshTokens(authUid);
    } catch {
      // Best-effort revocation
    }
  }

  // --- Phase 2: Delete Auth user ----------------------------------
  if (authUid) {
    try {
      await auth.deleteUser(authUid);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== 'auth/user-not-found') {
        // Auth deletion failed for a reason other than "already gone".
        // Record the failure and re-throw so the caller knows.
        await idemRef.update({
          status: 'failed',
          failedAt: FieldValue.serverTimestamp(),
          reason: 'auth_deletion_failed',
        });
        throw new HttpsError('internal', 'AUTH_DELETION_FAILED');
      }
      // auth/user-not-found is idempotent — the Auth user is already gone
    }
  }

  // Daily check-ins identify their subject with `userId`, not `childId`.
  // Keep the original family-local pre-purge, then close its last-write window
  // with a global sweep after the profile has been removed.
  await purgeDailyCheckinRecords(db, familyId, childId);

  // --- Phase 3: Firestore cleanup (transactional) -----------------
  const usernameIndexRef = db.doc(
    `${FAMILIES}/${familyId}/${CHILD_LOGIN_INDEX}/${normalizeUsernameForIndex(child.displayName as string)}`,
  );

  // Collect all sub-collection paths that belong exclusively to this child
  const childSpecificCollections = [
    `families/${familyId}/notifications`,
    `families/${familyId}/approvals`,
    `families/${familyId}/task_completions`,
    `families/${familyId}/behaviour_events`,
    `families/${familyId}/wallet_transactions`,
    `families/${familyId}/gamification_summaries`,
    `families/${familyId}/daily_progress`,
    `families/${familyId}/eligibility_snapshots`,
    `families/${familyId}/xp_events`,
    `families/${familyId}/reversals`,
    `families/${familyId}/threshold_awards`,
    `families/${familyId}/goal_contributions`,
    `families/${familyId}/goal_withdrawals`,
    `families/${familyId}/savings_goals`,
    `families/${familyId}/rewards`,
    `families/${familyId}/challenges`,
    `families/${familyId}/transfer_requests`,
    `families/${familyId}/money_requests`,
    `families/${familyId}/profile_update_requests`,
    `families/${familyId}/childLogins`,
    `families/${familyId}/childLoginAudit`,
    `families/${familyId}/childLoginIdempotency`,
  ];

  try {
    await db.runTransaction(async (t: Transaction) => {
      // Re-verify child still exists and is managed (prevents TOCTOU)
      const currentChildSnap = await t.get(childRef);
      if (currentChildSnap.exists) {
        const currentChild = currentChildSnap.data() as Record<string, unknown>;
        if (
          currentChild.role !== 'child' ||
          currentChild.isManaged !== true ||
          currentChild.familyId !== familyId
        ) {
          throw new HttpsError('failed-precondition', 'CHILD_NO_LONGER_MANAGED');
        }
      }

      // Delete the child user document
      t.delete(childRef);

      // Delete child-login private record
      t.delete(db.doc(`${FAMILIES}/${familyId}/${CHILD_LOGINS}/${childId}`));

      // Delete username index entry
      t.delete(usernameIndexRef);

      // Write audit event
      t.set(
        db.collection(`${FAMILIES}/${familyId}/${CHILD_LOGIN_AUDIT}`).doc(),
        {
          type: 'child_deleted',
          childId,
          actorId: callerUid,
          success: true,
          clientReqId,
          createdAt: FieldValue.serverTimestamp(),
        },
      );
    });
    // No new self-write can pass Rules after the profile deletion. Do not
    // publish terminal idempotency state until this global sweep succeeds.
    await purgeUserDailyCheckinRecords(db, childId);
    await idemRef.update({
      status: 'completed',
      phase: 'completed',
      result: { childId, deleted: true },
      completedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // If the transaction failed, mark idempotency as failed so retries
    // can be retried safely (same clientReqId with same payload).
    await idemRef.update({
      status: 'failed',
      failedAt: FieldValue.serverTimestamp(),
    }).catch(() => {
      /* ignore idempotency marker update failure */
    });
    throw err;
  }

  // --- Phase 4: Clean up child-specific sub-collections -----------
  // These are best-effort; the transaction already removed the core
  // records. Sub-collections are deleted in the background to avoid
  // transaction size limits.
  const batch = db.batch();
  let batchCount = 0;
  const BATCH_LIMIT = 500;

  for (const collectionPath of childSpecificCollections) {
    try {
      const snapshot = await db.collection(collectionPath).where('childId', '==', childId).limit(BATCH_LIMIT).get();
      for (const doc of snapshot.docs) {
        if (doc.ref.path === idemRef.path) continue;
        batch.delete(doc.ref);
        batchCount += 1;
        if (batchCount >= BATCH_LIMIT) {
          await batch.commit();
          batchCount = 0;
        }
      }
    } catch {
      // Best-effort cleanup; missing collections are expected
    }
  }

  // Also delete any documents in child-specific sub-collections that
  // use the child's UID as the document ID (e.g. family members who
  // are children get their user doc deleted, but sub-collections
  // under other paths may reference the childId).
  try {
    const memberDocs = await db
      .collection(`${FAMILIES}/${familyId}/members`)
      .where('childId', '==', childId)
      .limit(BATCH_LIMIT)
      .get();
    for (const doc of memberDocs.docs) {
      batch.delete(doc.ref);
      batchCount += 1;
      if (batchCount >= BATCH_LIMIT) {
        await batch.commit();
        batchCount = 0;
      }
    }
  } catch {
    /* best-effort */
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  return { childId, deleted: true };
}

/**
 * Normalizes a display name for use in the username index.
 * Mirrors the normalization used in childLogin.ts for consistency.
 */
function normalizeUsernameForIndex(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Callable entry point (deployed)
// ---------------------------------------------------------------------------

export const deleteChild = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  async (request: CallableRequest<DeleteChildInput>): Promise<DeleteChildResult> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'AUTH_REQUIRED');
    }
    const input = validateDeleteChildInput(request.data);
    return deleteChildImpl(makeContext(), request.auth.uid, input);
  },
);

function makeContext(): ChildDeletionContext {
  return {
    auth: getAuth(),
    db: getFirestore(),
  };
}
