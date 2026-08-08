// ---------------------------------------------------------------------------
// FAMILYQUEST — SERVER-AUTHORITATIVE ACCOUNT DELETION (App Store compliant)
// ---------------------------------------------------------------------------
//
// deleteAccount permanently deletes the calling adult's account in-app.
// The server determines the caller's role from its own records — never from
// client input — and handles four scenarios:
//
//  1. Non-owner adult          → leave family, purge profile, delete Auth last.
//  2. Owner + successor        → transfer ownership to a self-registered adult
//                                chosen by the owner, then scenario 1.
//  3. Owner, no successor      → the family deletion cascade runs first; the
//                                account purge "rides" the family-deletion job
//                                via accountDeletionJobs/{uid}, completed in
//                                the finalize phase.
//  4. Managed child            → rejected; parents use the existing child
//                                deletion flow.
//
// A recent login (<= 5 minutes) is required; otherwise the callable returns
// RECENT_LOGIN_REQUIRED and the client reauthenticates (password or Google;
// Sign in with Apple is not offered by this app, so Apple token revocation
// is not applicable). The Firebase Auth user is always deleted last so a
// failed run can be retried by the still-authenticated user.
// ---------------------------------------------------------------------------

import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { getFunctions } from 'firebase-admin/functions';
import type { FamilyDeletionContext, FamilyDeletionJob } from './familyDeletion';
import { purgeUserDailyCheckinRecords } from './dailyCheckinCleanup';

export const RECENT_LOGIN_WINDOW_MS = 5 * 60 * 1000;

export interface DeleteAccountInput {
  successorUid?: string;
  familyNameConfirmation?: string;
}

export type DeleteAccountStatus =
  | 'completed'
  | 'pending_family_deletion';

export interface DeleteAccountResult {
  status: DeleteAccountStatus;
}

function userRef(db: any, uid: string) {
  return db.doc(`users/${uid}`);
}
function familyRef(db: any, familyId: string) {
  return db.doc(`families/${familyId}`);
}
function accountJobRef(db: any, uid: string) {
  return db.doc(`accountDeletionJobs/${uid}`);
}

async function stripClaimsQuietly(ctx: FamilyDeletionContext, uid: string): Promise<void> {
  try {
    const user = await ctx.auth.getUser(uid);
    const claims = { ...(user.customClaims ?? {}) } as Record<string, unknown>;
    let changed = false;
    for (const key of ['familyId', 'role', 'childId', 'managedChild']) {
      if (key in claims) { delete claims[key]; changed = true; }
    }
    if (changed) await ctx.auth.setCustomUserClaims(uid, claims);
    await ctx.auth.revokeRefreshTokens(uid);
  } catch (err: any) {
    if (err?.code !== 'auth/user-not-found' && err?.errorInfo?.code !== 'auth/user-not-found') throw err;
  }
}

async function deleteAuthUserQuietly(ctx: FamilyDeletionContext, uid: string): Promise<void> {
  try {
    await ctx.auth.deleteUser(uid);
  } catch (err: any) {
    if (err?.code !== 'auth/user-not-found' && err?.errorInfo?.code !== 'auth/user-not-found') throw err;
  }
}

/** Firestore membership/profile purge plus a final global check-in sweep. Auth deletion stays last. */
async function purgeProfile(ctx: FamilyDeletionContext, uid: string, familyId: string | null): Promise<void> {
  const { db } = ctx;
  await db.runTransaction(async (t: any) => {
    if (familyId) t.delete(db.doc(`families/${familyId}/users/${uid}`));
    t.delete(userRef(db, uid));
  });
  // Once the profile is gone, no new self-write can pass Rules. This second
  // idempotent sweep closes the last-write window left by the pre-purge.
  await purgeUserDailyCheckinRecords(db, uid);
}

export async function deleteAccountImpl(
  ctx: FamilyDeletionContext,
  callerUid: string,
  rawInput: unknown,
  authTimeMs: number,
): Promise<DeleteAccountResult> {
  const input = (rawInput ?? {}) as DeleteAccountInput;
  const { db } = ctx;

  if (ctx.now() - authTimeMs > RECENT_LOGIN_WINDOW_MS) {
    throw new HttpsError('failed-precondition', 'RECENT_LOGIN_REQUIRED');
  }

  const profileSnap = await userRef(db, callerUid).get();

  // Idempotent completion / resume: no profile means only Auth may remain.
  if (!profileSnap.exists) {
    await purgeUserDailyCheckinRecords(db, callerUid);
    await accountJobRef(db, callerUid).delete();
    await deleteAuthUserQuietly(ctx, callerUid);
    return { status: 'completed' };
  }

  const profile = profileSnap.data() as Record<string, any>;
  if (profile.isManaged === true) {
    // Managed children are deleted by a parent through the existing flow.
    throw new HttpsError('permission-denied', 'MANAGED_CHILD_ACCOUNT');
  }

  const familyId: string | null = typeof profile.familyId === 'string' && profile.familyId
    ? profile.familyId
    : null;

  // Scenario: no family membership at all.
  if (!familyId) {
    await purgeUserDailyCheckinRecords(db, callerUid);
    await purgeProfile(ctx, callerUid, null);
    await deleteAuthUserQuietly(ctx, callerUid);
    return { status: 'completed' };
  }

  // Scenario: non-owner adult or self-registered child.
  if (profile.role !== 'owner') {
    await purgeUserDailyCheckinRecords(db, callerUid);
    await purgeProfile(ctx, callerUid, familyId);
    await stripClaimsQuietly(ctx, callerUid);
    await deleteAuthUserQuietly(ctx, callerUid);
    return { status: 'completed' };
  }

  // ----- Owner scenarios -------------------------------------------------

  const familySnap = await familyRef(db, familyId).get();
  const family = familySnap.exists ? (familySnap.data() as Record<string, any>) : null;
  const deletionJobSnap = await db.doc(`familyDeletionJobs/${familyId}`).get();

  // Family deletion already underway: register (idempotently) to ride it.
  if ((family && family.lifecycleState === 'deleting') || deletionJobSnap.exists) {
    await accountJobRef(db, callerUid).set({
      schemaVersion: 1,
      uid: callerUid,
      familyId,
      reason: 'owner_account_deletion',
      createdAt: FieldValue.serverTimestamp(),
    });
    return { status: 'pending_family_deletion' };
  }

  if (!family) {
    // Orphaned owner profile: nothing family-side to protect.
    await purgeUserDailyCheckinRecords(db, callerUid);
    await purgeProfile(ctx, callerUid, familyId);
    await stripClaimsQuietly(ctx, callerUid);
    await deleteAuthUserQuietly(ctx, callerUid);
    return { status: 'completed' };
  }

  // Server-side successor eligibility: self-registered adults only.
  const eligibleSnap = await db.collection('users')
    .where('familyId', '==', familyId)
    .where('role', '==', 'parent')
    .limit(50)
    .get();
  const eligible = eligibleSnap.docs.filter((d: any) => (d.data() as any)?.isManaged !== true);

  if (input.successorUid) {
    const successorDoc = eligible.find((d: any) => d.id === input.successorUid);
    if (!successorDoc) {
      throw new HttpsError('failed-precondition', 'SUCCESSOR_NOT_ELIGIBLE');
    }
    await purgeUserDailyCheckinRecords(db, callerUid);
    await db.runTransaction(async (t: any) => {
      const [ownerSnap, succSnap] = await Promise.all([
        t.get(userRef(db, callerUid)),
        t.get(userRef(db, input.successorUid as string)),
      ]);
      const owner = ownerSnap.exists ? ownerSnap.data() : null;
      const succ = succSnap.exists ? succSnap.data() : null;
      if (!owner || owner.familyId !== familyId || owner.role !== 'owner') {
        throw new HttpsError('failed-precondition', 'OWNERSHIP_CHANGED');
      }
      if (!succ || succ.familyId !== familyId || succ.role !== 'parent' || succ.isManaged === true) {
        throw new HttpsError('failed-precondition', 'SUCCESSOR_NOT_ELIGIBLE');
      }
      t.update(userRef(db, input.successorUid as string), { role: 'owner' });
      t.update(familyRef(db, familyId), { ownerId: input.successorUid });
      t.delete(db.doc(`families/${familyId}/users/${callerUid}`));
      t.delete(userRef(db, callerUid));
    });
    // The ownership-transfer transaction removes the old owner's authority;
    // sweep again before reporting terminal account completion.
    await purgeUserDailyCheckinRecords(db, callerUid);
    await stripClaimsQuietly(ctx, callerUid);
    await deleteAuthUserQuietly(ctx, callerUid);
    return { status: 'completed' };
  }

  if (eligible.length > 0) {
    // A successor exists but was not chosen; the client shows the picker.
    throw new HttpsError('failed-precondition', 'SUCCESSOR_REQUIRED');
  }

  // Sole adult owner: family deletion must run first, with the same exact
  // case-sensitive confirmation the Danger Zone requires.
  if (typeof input.familyNameConfirmation !== 'string'
    || input.familyNameConfirmation !== family.name) {
    throw new HttpsError('failed-precondition', 'FAMILY_DELETION_CONFIRMATION_REQUIRED');
  }

  await db.runTransaction(async (t: any) => {
    const famSnap = await t.get(familyRef(db, familyId));
    if (!famSnap.exists) return;
    if (famSnap.data().lifecycleState === 'deleting') return;
    t.update(familyRef(db, familyId), {
      lifecycleState: 'deleting',
      deletionJobId: familyId,
      deletionRequestedAt: FieldValue.serverTimestamp(),
      deletionRequestedBy: callerUid,
    });
    const job: FamilyDeletionJob = {
      schemaVersion: 1,
      familyId,
      clientReqId: `account-${callerUid}`.slice(0, 64),
      requestedBy: callerUid,
      state: 'queued',
      phase: 'inventory_members',
      attemptCount: 0,
      phaseAttemptCount: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      createdAt: FieldValue.serverTimestamp(),
      startedAt: null,
      updatedAt: FieldValue.serverTimestamp(),
      lastErrorCode: null,
      lastErrorAt: null,
      progress: {
        processedMembers: 0,
        deletedManagedIdentities: 0,
        clearedSelfRegisteredProfiles: 0,
        deletedExternalRecords: 0,
        deletedFamilyDocuments: 0,
      },
    };
    t.set(db.doc(`familyDeletionJobs/${familyId}`), job);
    t.set(accountJobRef(db, callerUid), {
      schemaVersion: 1,
      uid: callerUid,
      familyId,
      reason: 'owner_account_deletion',
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  await ctx.enqueue(familyId).catch(() => undefined);
  return { status: 'pending_family_deletion' };
}

// ---------------------------------------------------------------------------
// Deployment wiring
// ---------------------------------------------------------------------------

function makeContext(): FamilyDeletionContext {
  return {
    db: getFirestore(),
    auth: getAuth(),
    enqueue: async (familyId: string) => {
      const queue = getFunctions().taskQueue('processFamilyDeletion');
      await queue.enqueue({ familyId });
    },
    now: () => Date.now(),
    invocationId: `acct-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

export const deleteAccount = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  async (request: CallableRequest<DeleteAccountInput>) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'AUTH_REQUIRED');
    const authTimeSeconds = (request.auth?.token as any)?.auth_time ?? 0;
    return deleteAccountImpl(makeContext(), uid, request.data, authTimeSeconds * 1000);
  },
);
