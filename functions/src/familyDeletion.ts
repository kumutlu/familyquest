// ---------------------------------------------------------------------------
// FAMILYQUEST — SERVER-AUTHORITATIVE FAMILY DELETION (backend)
// ---------------------------------------------------------------------------
//
// Implements the approved specification
// docs/superpowers/specs/2026-07-29-family-deletion-danger-zone-design.md
// (commit 18f00e6): resumable, idempotent, server-only family deletion.
//
// Entry points:
//  * deleteFamily            — callable; atomic freeze + job create/reuse.
//  * processFamilyDeletion   — task-queue worker; advances bounded phases.
//  * recoverFamilyDeletionJobs — scheduler; re-enqueues eligible jobs.
//  * leaveFamily             — callable; non-owner self-registered departure.
//  * getFamilyDeletionStatus — callable; sanitized job status for the owner.
//
// Privacy invariants: no family name, family code, username, email,
// password-derived value, or synthetic login identifier is ever persisted in
// a job, receipt, log, metric, or error. Errors carry allowlisted codes only.
// ---------------------------------------------------------------------------

import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFunctions } from 'firebase-admin/functions';

// ---------------------------------------------------------------------------
// Reviewed registry of known family subcollections (regression guard only —
// runtime cleanup dynamically enumerates actual subcollections).
// ---------------------------------------------------------------------------

export const FAMILY_SUBCOLLECTION_REGISTRY: readonly string[] = [
  'join_requests', 'announcements', 'announcement_reads', 'tasks',
  'task_completions', 'behaviour_events', 'rewards', 'redemptions', 'wallets',
  'wallet_transactions', 'savings_goals', 'goal_requests', 'idempotency',
  'feed', 'notifications', 'notification_deliveries', 'notification_reads',
  'challenges', 'funds', 'fund_transactions', 'reversal_events', 'reversals',
  'transfer_requests', 'money_requests', 'petbox_requests',
  'profile_update_requests', 'users', 'childLoginIndex', 'childLogins',
  'childLoginAudit', 'childLoginIdempotency', 'task_occurrences',
  'gamification_events', 'daily_eligibility', 'daily_progress',
  'gamification_summaries', 'gamification_checkpoints',
];

export const FAMILY_NESTED_SUBCOLLECTIONS: readonly string[] = [
  'users/{userId}/avatar_unlocks',
  'users/{userId}/push_tokens',
  'savings_goals/{goalId}/contributions',
  'savings_goals/{goalId}/goal_ledger',
  'savings_goals/{goalId}/match_proposals',
];

// Legacy root namespaces scanned for documents carrying the deleted familyId.
export const LEGACY_ROOT_NAMESPACES: readonly string[] = [
  'task_occurrences', 'gamification_events', 'daily_eligibility',
  'gamification_checkpoints',
];

// ---------------------------------------------------------------------------
// Family-scoped profile fields (R2)
// ---------------------------------------------------------------------------
//
// A departing self-registered member keeps their account-level identity
// (uid, displayName, email, avatarUrl, avatarId, language preferences,
// createdAt) and loses every field that only has meaning inside a family.
// These are the REAL schema fields written by src/lib/api.ts; the previously
// cleared `points`/`xp`/`level`/`streak`/`familyJoinedAt` never existed.
export const FAMILY_SCOPED_PROFILE_FIELDS: readonly string[] = [
  // Membership
  'familyId', 'role', 'joinRequestId',
  // Gamification
  'rewardPoints', 'lifetimeXP', 'currentStreak', 'longestStreak', 'lastActiveDate',
  // Money mirror and ledger markers
  'walletBalance',
  'lastGoalTxId', 'lastManualTxId', 'lastTransferTxId', 'lastTransferReqId',
  'lastPenaltyTxId', 'lastFundTxId', 'lastBehaviourEventId', 'lastRedemptionId',
  'lastReversalId',
];

/** Field-delete map used by both family deletion and leaveFamily. */
export function familyScopedProfileClearUpdate(): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  for (const field of FAMILY_SCOPED_PROFILE_FIELDS) update[field] = FieldValue.delete();
  return update;
}

// ---------------------------------------------------------------------------
// Job schema
// ---------------------------------------------------------------------------

export const DELETION_PHASES = [
  'inventory_members',
  'revoke_member_access',
  'delete_managed_identities',
  'clear_self_registered_profiles',
  'delete_external_references',
  'delete_family_subcollections',
  'verify_orphans',
  'finalize',
] as const;

export type DeletionPhase = (typeof DELETION_PHASES)[number];
export type DeletionState = 'queued' | 'running' | 'retry_wait' | 'failed' | 'completed';

export interface FamilyDeletionJob {
  schemaVersion: 1;
  familyId: string;
  clientReqId: string;
  requestedBy: string;
  state: DeletionState;
  phase: DeletionPhase;
  attemptCount: number;
  phaseAttemptCount: number;
  leaseOwner: string | null;
  // Millisecond epoch values: portable across emulator/tests and cheap to
  // compare inside transactions.
  leaseExpiresAt: number | null;
  nextAttemptAt: number | null;
  createdAt: unknown;
  startedAt: unknown | null;
  updatedAt: unknown;
  lastErrorCode: string | null;
  lastErrorAt: unknown | null;
  // Identity bookkeeping used by verify_orphans (R6) to re-verify Auth state
  // after the Firestore profiles have gone. Server-only, uid values only.
  managedAuthUids?: string[];
  selfRegisteredUids?: string[];
  verifyRetried?: boolean;
  progress: {
    processedMembers: number;
    deletedManagedIdentities: number;
    clearedSelfRegisteredProfiles: number;
    deletedExternalRecords: number;
    deletedFamilyDocuments: number;
  };
}

const LEASE_MS = 5 * 60 * 1000;
const MAX_AUTOMATIC_ATTEMPTS = 8;
const RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 50;

const CLIENT_REQ_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

// Allowlisted, non-sensitive error codes.
export type SanitizedErrorCode =
  | 'TRANSIENT'
  | 'IDENTITY_LINKAGE_ERROR'
  | 'INVARIANT_VIOLATION';

export interface FamilyDeletionContext {
  db: any;
  auth: any;
  enqueue: (familyId: string, delaySeconds?: number) => Promise<void>;
  now: () => number;
  invocationId: string;
}

export interface DeleteFamilyInput {
  familyId: string;
  familyNameConfirmation: string;
  clientReqId: string;
}

export interface DeleteFamilyResult {
  familyId: string;
  state: DeletionState;
  phase: DeletionPhase;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateDeleteFamilyInput(input: unknown): DeleteFamilyInput {
  if (!input || typeof input !== 'object') throw new HttpsError('invalid-argument', 'BAD_REQUEST');
  const data = input as Record<string, unknown>;
  if (typeof data.familyId !== 'string' || !data.familyId) {
    throw new HttpsError('invalid-argument', 'FAMILY_ID_REQUIRED');
  }
  if (typeof data.familyNameConfirmation !== 'string' || data.familyNameConfirmation.length === 0) {
    throw new HttpsError('invalid-argument', 'NAME_CONFIRMATION_REQUIRED');
  }
  if (typeof data.clientReqId !== 'string' || !CLIENT_REQ_ID_RE.test(data.clientReqId)) {
    throw new HttpsError('invalid-argument', 'CLIENT_REQ_ID_INVALID');
  }
  return {
    familyId: data.familyId,
    familyNameConfirmation: data.familyNameConfirmation,
    clientReqId: data.clientReqId,
  };
}

// ---------------------------------------------------------------------------
// Receipt schema (R3)
// ---------------------------------------------------------------------------

export interface FamilyDeletionReceipt {
  schemaVersion: 1;
  familyId: string;
  requestedBy: string;
  startedAt: unknown;
  completedAt: unknown;
  outcome: 'completed';
  expiresAt: unknown;
}

function buildReceipt(
  ctx: FamilyDeletionContext,
  familyId: string,
  job: FamilyDeletionJob,
): FamilyDeletionReceipt {
  return {
    schemaVersion: 1,
    familyId,
    requestedBy: job.requestedBy,
    startedAt: job.startedAt ?? FieldValue.serverTimestamp(),
    completedAt: FieldValue.serverTimestamp(),
    outcome: 'completed',
    expiresAt: Timestamp.fromMillis(ctx.now() + RECEIPT_TTL_MS),
  };
}

function jobRef(db: any, familyId: string) {
  return db.doc(`familyDeletionJobs/${familyId}`);
}
function receiptRef(db: any, familyId: string) {
  return db.doc(`familyDeletionReceipts/${familyId}`);
}
function familyRef(db: any, familyId: string) {
  return db.doc(`families/${familyId}`);
}

// ---------------------------------------------------------------------------
// deleteFamily — atomic freeze + durable job
// ---------------------------------------------------------------------------

export async function deleteFamilyImpl(
  ctx: FamilyDeletionContext,
  callerUid: string,
  rawInput: unknown,
): Promise<DeleteFamilyResult> {
  const input = validateDeleteFamilyInput(rawInput);
  const { db } = ctx;
  const { familyId } = input;

  const result = await db.runTransaction(async (t: any) => {
    const [familySnap, jobSnap, receiptSnap, callerSnap] = await Promise.all([
      t.get(familyRef(db, familyId)),
      t.get(jobRef(db, familyId)),
      t.get(receiptRef(db, familyId)),
      t.get(db.doc(`users/${callerUid}`)),
    ]);

    // Completed deletion: minimal receipt represents success.
    if (!familySnap.exists && !jobSnap.exists) {
      if (receiptSnap.exists) {
        return { familyId, state: 'completed' as DeletionState, phase: 'finalize' as DeletionPhase };
      }
      throw new HttpsError('not-found', 'FAMILY_NOT_FOUND');
    }

    const caller = callerSnap.exists ? callerSnap.data() : null;
    const family = familySnap.exists ? familySnap.data() : null;

    if (jobSnap.exists) {
      const job = jobSnap.data() as FamilyDeletionJob;

      // Authorization: current owner before owner-profile cleanup; the
      // immutable requestedBy afterwards.
      const isCurrentOwner = !!caller && caller.familyId === familyId && caller.role === 'owner';
      const isOriginalRequester = job.requestedBy === callerUid;
      if (!isCurrentOwner && !isOriginalRequester) {
        throw new HttpsError('permission-denied', 'NOT_AUTHORIZED');
      }

      // Exact-name confirmation still checked against the frozen family doc.
      if (family && input.familyNameConfirmation !== family.name) {
        throw new HttpsError('failed-precondition', 'NAME_MISMATCH');
      }

      // clientReqId reuse with incompatible metadata is rejected.
      if (input.clientReqId === job.clientReqId && job.requestedBy !== callerUid) {
        throw new HttpsError('already-exists', 'CLIENT_REQ_ID_CONFLICT');
      }

      if (job.state === 'failed') {
        // Explicit retry with a new clientReqId returns the job to queued and
        // clears ONLY the sanitized error fields (D9). Attempt counters are
        // durable abuse-control state and are deliberately preserved.
        t.update(jobRef(db, familyId), {
          state: 'queued',
          clientReqId: input.clientReqId,
          lastErrorCode: null,
          lastErrorAt: null,
          nextAttemptAt: null,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { familyId, state: 'queued' as DeletionState, phase: job.phase };
      }
      return { familyId, state: job.state, phase: job.phase };
    }

    // No job yet: only the current owner with an exact name match may freeze.
    if (!family) throw new HttpsError('not-found', 'FAMILY_NOT_FOUND');
    if (!caller || caller.familyId !== familyId || caller.role !== 'owner') {
      throw new HttpsError('permission-denied', 'NOT_AUTHORIZED');
    }
    // Exact, case-sensitive comparison. Leading/trailing whitespace
    // differences are rejected, never normalized.
    if (input.familyNameConfirmation !== family.name) {
      throw new HttpsError('failed-precondition', 'NAME_MISMATCH');
    }

    t.update(familyRef(db, familyId), {
      lifecycleState: 'deleting',
      deletionJobId: familyId,
      deletionRequestedAt: FieldValue.serverTimestamp(),
      deletionRequestedBy: callerUid,
    });

    const job: FamilyDeletionJob = {
      schemaVersion: 1,
      familyId,
      clientReqId: input.clientReqId,
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
    t.set(jobRef(db, familyId), job);
    return { familyId, state: 'queued' as DeletionState, phase: 'inventory_members' as DeletionPhase };
  });

  // Dispatch outside the transaction; a failure leaves the durable job for
  // the recovery scheduler.
  if (result.state === 'queued') {
    try {
      await ctx.enqueue(familyId);
    } catch {
      /* recovery scheduler will dispatch */
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// getFamilyDeletionStatus
// ---------------------------------------------------------------------------

export async function getFamilyDeletionStatusImpl(
  ctx: FamilyDeletionContext,
  callerUid: string,
  familyId: string,
): Promise<{ familyId: string; state: DeletionState | 'none'; phase?: DeletionPhase; progress?: FamilyDeletionJob['progress']; lastErrorCode?: string | null }> {
  const { db } = ctx;
  const jobSnap = await jobRef(db, familyId).get();
  if (!jobSnap.exists) {
    const receiptSnap = await receiptRef(db, familyId).get();
    if (receiptSnap.exists) return { familyId, state: 'completed' };
    return { familyId, state: 'none' };
  }
  const job = jobSnap.data() as FamilyDeletionJob;
  const callerSnap = await db.doc(`users/${callerUid}`).get();
  const caller = callerSnap.exists ? callerSnap.data() : null;
  const isCurrentOwner = !!caller && caller.familyId === familyId && caller.role === 'owner';
  if (!isCurrentOwner && job.requestedBy !== callerUid) {
    throw new HttpsError('permission-denied', 'NOT_AUTHORIZED');
  }
  return {
    familyId,
    state: job.state,
    phase: job.phase,
    progress: job.progress,
    lastErrorCode: job.lastErrorCode ?? null,
  };
}

// ---------------------------------------------------------------------------
// Identity classification (server records only)
// ---------------------------------------------------------------------------

class LinkageError extends Error {
  code: SanitizedErrorCode = 'IDENTITY_LINKAGE_ERROR';
}

/** Contradictory terminal state: neither the family nor its receipt exists. */
class InvariantViolation extends Error {
  code: SanitizedErrorCode = 'INVARIANT_VIOLATION';
}

async function verifyManagedChild(
  ctx: FamilyDeletionContext,
  familyId: string,
  profileId: string,
  profile: Record<string, any>,
): Promise<{ authUid: string | null }> {
  if (profile.isManaged !== true || profile.role !== 'child' || profile.familyId !== familyId) {
    throw new LinkageError('managed child classification mismatch');
  }
  const hasLogin = profile.hasLogin === true;
  const publicAuthUid = typeof profile.authUid === 'string' && profile.authUid ? profile.authUid : null;
  const loginSnap = await ctx.db.doc(`families/${familyId}/childLogins/${profileId}`).get();

  if (!hasLogin) {
    // Profile-only managed child: must have no login artefacts at all.
    if (publicAuthUid || loginSnap.exists) throw new LinkageError('unprovisioned child has login artefacts');
    return { authUid: null };
  }

  // Provisioned login: both links are mandatory and must agree.
  if (!publicAuthUid || !loginSnap.exists) throw new LinkageError('provisioned child missing linkage');
  const login = loginSnap.data() as Record<string, any>;
  const privateAuthUid = typeof login.authUid === 'string' ? login.authUid : null;
  if (!privateAuthUid || privateAuthUid !== publicAuthUid) {
    throw new LinkageError('auth uid linkage mismatch');
  }

  let authUser: any = null;
  try {
    authUser = await ctx.auth.getUser(publicAuthUid);
  } catch (err: any) {
    if (err?.code === 'auth/user-not-found' || err?.errorInfo?.code === 'auth/user-not-found') {
      // Already cleaned: acceptable idempotent state.
      return { authUid: publicAuthUid };
    }
    throw err;
  }
  const claims = authUser.customClaims ?? {};
  if (
    claims.managedChild !== true
    || claims.childId !== profileId
    || claims.familyId !== familyId
    || claims.role !== 'child'
  ) {
    throw new LinkageError('managed child claims mismatch');
  }
  return { authUid: publicAuthUid };
}

/** Returns the Auth user, or null when it no longer exists. */
async function getAuthUserOrNull(ctx: FamilyDeletionContext, authUid: string): Promise<any | null> {
  try {
    return await ctx.auth.getUser(authUid);
  } catch (err: any) {
    if (err?.code === 'auth/user-not-found' || err?.errorInfo?.code === 'auth/user-not-found') return null;
    throw err;
  }
}

async function stripFamilyClaims(ctx: FamilyDeletionContext, authUid: string): Promise<void> {
  let authUser: any;
  try {
    authUser = await ctx.auth.getUser(authUid);
  } catch (err: any) {
    if (err?.code === 'auth/user-not-found' || err?.errorInfo?.code === 'auth/user-not-found') return;
    throw err;
  }
  const claims = { ...(authUser.customClaims ?? {}) } as Record<string, unknown>;
  let changed = false;
  for (const key of ['familyId', 'role', 'childId', 'managedChild']) {
    if (key in claims) { delete claims[key]; changed = true; }
  }
  if (changed) await ctx.auth.setCustomUserClaims(authUid, claims);
  await ctx.auth.revokeRefreshTokens(authUid);
}

// ---------------------------------------------------------------------------
// processFamilyDeletion — bounded, idempotent phase runner
// ---------------------------------------------------------------------------

export async function processFamilyDeletionImpl(
  ctx: FamilyDeletionContext,
  familyId: string,
): Promise<{ done: boolean; state?: DeletionState }> {
  const { db } = ctx;

  // Claim (or take over) the lease transactionally.
  const claim = await db.runTransaction(async (t: any) => {
    const snap = await t.get(jobRef(db, familyId));
    if (!snap.exists) return { claimed: false, reason: 'missing' };
    const job = snap.data() as FamilyDeletionJob;
    const now = ctx.now();
    if (job.state === 'completed') return { claimed: false, reason: 'completed' };
    if (job.state === 'failed') return { claimed: false, reason: 'failed' };
    if (job.state === 'retry_wait' && job.nextAttemptAt != null && job.nextAttemptAt > now) {
      return { claimed: false, reason: 'waiting' };
    }
    if (job.state === 'running' && job.leaseOwner && job.leaseExpiresAt != null && job.leaseExpiresAt > now) {
      // Another unexpired lease exists: duplicate delivery exits successfully.
      return { claimed: false, reason: 'leased' };
    }
    t.update(jobRef(db, familyId), {
      state: 'running',
      leaseOwner: ctx.invocationId,
      leaseExpiresAt: now + LEASE_MS,
      startedAt: job.startedAt ?? FieldValue.serverTimestamp(),
      attemptCount: (job.attemptCount ?? 0) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { claimed: true, phase: job.phase };
  });
  if (!claim.claimed) return { done: claim.reason === 'completed' };

  try {
    // Advance phases until finished (tests) or budget consumed (prod worker
    // re-enqueues itself via Cloud Tasks retry / recovery scheduler).
    let guard = 0;
    for (;;) {
      guard += 1;
      if (guard > 1000) throw new Error('phase guard exceeded');
      const snap = await jobRef(db, familyId).get();
      if (!snap.exists) return { done: true };
      const job = snap.data() as FamilyDeletionJob;
      if (job.leaseOwner !== ctx.invocationId) return { done: false };
      if (job.state !== 'running') return { done: job.state === 'completed', state: job.state };

      const next = await runPhaseOnce(ctx, familyId, job);
      if (next === 'completed') return { done: true, state: 'completed' };
      if (next === 'yield') {
        await ctx.enqueue(familyId).catch(() => undefined);
        return { done: false };
      }
      // 'continue' loops into the next phase iteration.
    }
  } catch (err: any) {
    const code: SanitizedErrorCode = err instanceof LinkageError
      ? 'IDENTITY_LINKAGE_ERROR'
      : err instanceof InvariantViolation
        ? 'INVARIANT_VIOLATION'
        : 'TRANSIENT';
    await db.runTransaction(async (t: any) => {
      const snap = await t.get(jobRef(db, familyId));
      if (!snap.exists) return;
      const job = snap.data() as FamilyDeletionJob;
      if (job.leaseOwner !== ctx.invocationId) return;
      const exhausted = (job.attemptCount ?? 0) >= MAX_AUTOMATIC_ATTEMPTS;
      const failedHard = code !== 'TRANSIENT' || exhausted;
      const backoffMs = Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.min(10, job.attemptCount ?? 0))
        + Math.floor(Math.random() * 5_000);
      t.update(jobRef(db, familyId), {
        state: failedHard ? 'failed' : 'retry_wait',
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: failedHard ? null : ctx.now() + backoffMs,
        lastErrorCode: code,
        lastErrorAt: FieldValue.serverTimestamp(),
        phaseAttemptCount: (job.phaseAttemptCount ?? 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return { done: false };
  }
}

type PhaseOutcome = 'continue' | 'yield' | 'completed';

/**
 * Ownership-guarded job write. A worker that has lost its lease (takeover by
 * the recovery scheduler) must never write to the job again, and must never
 * resurrect its own expired lease.
 */
async function updateOwnedJob(
  ctx: FamilyDeletionContext,
  familyId: string,
  updates: Record<string, unknown>,
): Promise<void> {
  const { db } = ctx;
  await db.runTransaction(async (t: any) => {
    const snap = await t.get(jobRef(db, familyId));
    if (!snap.exists) return;
    const job = snap.data() as FamilyDeletionJob;
    if (job.leaseOwner !== ctx.invocationId) return;
    t.update(jobRef(db, familyId), updates);
  });
}

async function setPhase(ctx: FamilyDeletionContext, familyId: string, updates: Record<string, unknown>): Promise<void> {
  await updateOwnedJob(ctx, familyId, {
    ...updates,
    leaseExpiresAt: ctx.now() + LEASE_MS,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Extends the lease mid-phase. Long member loops, Auth round-trips and large
 * batch deletions can each outlive the 5-minute lease, which would otherwise
 * let the recovery scheduler run a second worker concurrently.
 */
async function renewLease(ctx: FamilyDeletionContext, familyId: string): Promise<void> {
  await updateOwnedJob(ctx, familyId, { leaseExpiresAt: ctx.now() + LEASE_MS });
}

async function membersQuery(ctx: FamilyDeletionContext, familyId: string, limit: number) {
  return ctx.db.collection('users').where('familyId', '==', familyId).limit(limit).get();
}

async function runPhaseOnce(
  ctx: FamilyDeletionContext,
  familyId: string,
  job: FamilyDeletionJob,
): Promise<PhaseOutcome> {
  const { db } = ctx;

  switch (job.phase) {
    case 'inventory_members': {
      const snap = await membersQuery(ctx, familyId, 500);
      await setPhase(ctx, familyId, {
        phase: 'revoke_member_access',
        phaseAttemptCount: 0,
        'progress.processedMembers': snap.docs.length,
      });
      return 'continue';
    }

    case 'revoke_member_access': {
      const snap = await membersQuery(ctx, familyId, BATCH_LIMIT);
      for (const docSnap of snap.docs) {
        await renewLease(ctx, familyId);
        const profile = docSnap.data() as Record<string, any>;
        const authUid = profile.isManaged === true
          ? (typeof profile.authUid === 'string' && profile.authUid ? profile.authUid : null)
          : docSnap.id;
        if (authUid) {
          if (profile.isManaged === true) {
            // Disable managed logins so they cannot authenticate during the
            // deletion window. Their claims are intentionally left intact:
            // delete_managed_identities verifies the full linkage agreement
            // (including claims) before deleting the Auth user outright.
            await ctx.auth.updateUser(authUid, { disabled: true }).catch((err: any) => {
              if (err?.code !== 'auth/user-not-found' && err?.errorInfo?.code !== 'auth/user-not-found') throw err;
            });
          } else {
            await stripFamilyClaims(ctx, authUid);
          }
        }
      }
      // Re-strip claims for profiles already cleared in an earlier pass: the
      // orphan scan (R6) can send the job back here after the user documents
      // no longer carry familyId.
      for (const uid of job.selfRegisteredUids ?? []) {
        await renewLease(ctx, familyId);
        await stripFamilyClaims(ctx, uid);
      }
      // Idempotent: re-running only repeats safe operations.
      await setPhase(ctx, familyId, { phase: 'delete_managed_identities', phaseAttemptCount: 0 });
      return 'continue';
    }

    case 'delete_managed_identities': {
      const snap = await db.collection('users')
        .where('familyId', '==', familyId)
        .where('isManaged', '==', true)
        .limit(BATCH_LIMIT)
        .get();
      if (snap.docs.length === 0) {
        await setPhase(ctx, familyId, { phase: 'clear_self_registered_profiles', phaseAttemptCount: 0 });
        return 'continue';
      }
      let deleted = 0;
      const managedAuthUids = [...(job.managedAuthUids ?? [])];
      for (const docSnap of snap.docs) {
        await renewLease(ctx, familyId);
        const profile = docSnap.data() as Record<string, any>;
        const { authUid } = await verifyManagedChild(ctx, familyId, docSnap.id, profile);
        if (authUid) {
          try {
            await ctx.auth.deleteUser(authUid);
          } catch (err: any) {
            if (err?.code !== 'auth/user-not-found' && err?.errorInfo?.code !== 'auth/user-not-found') throw err;
          }
          if (!managedAuthUids.includes(authUid)) managedAuthUids.push(authUid);
        }
        await docSnap.ref.delete();
        deleted += 1;
      }
      await setPhase(ctx, familyId, {
        managedAuthUids,
        'progress.deletedManagedIdentities': (job.progress.deletedManagedIdentities ?? 0) + deleted,
      });
      return 'continue';
    }

    case 'clear_self_registered_profiles': {
      const snap = await membersQuery(ctx, familyId, BATCH_LIMIT);
      if (snap.docs.length === 0) {
        await setPhase(ctx, familyId, { phase: 'delete_external_references', phaseAttemptCount: 0 });
        return 'continue';
      }
      let cleared = 0;
      const selfRegisteredUids = [...(job.selfRegisteredUids ?? [])];
      for (const docSnap of snap.docs) {
        await renewLease(ctx, familyId);
        // Every remaining member is self-registered: preserve the profile,
        // clear every family relationship and gamification value.
        await docSnap.ref.update(familyScopedProfileClearUpdate());
        if (!selfRegisteredUids.includes(docSnap.id)) selfRegisteredUids.push(docSnap.id);
        cleared += 1;
      }
      await setPhase(ctx, familyId, {
        selfRegisteredUids,
        'progress.clearedSelfRegisteredProfiles': (job.progress.clearedSelfRegisteredProfiles ?? 0) + cleared,
      });
      return 'continue';
    }

    case 'delete_external_references': {
      let deleted = 0;
      const idemSnap = await db.collection('familyMembershipIdempotency')
        .where('familyId', '==', familyId).limit(BATCH_LIMIT).get();
      for (const docSnap of idemSnap.docs) {
        await docSnap.ref.delete();
        deleted += 1;
      }
      if (idemSnap.docs.length > 0) {
        await setPhase(ctx, familyId, {
          'progress.deletedExternalRecords': (job.progress.deletedExternalRecords ?? 0) + deleted,
        });
        return 'continue';
      }
      for (const namespace of LEGACY_ROOT_NAMESPACES) {
        const legacySnap = await db.collection(namespace)
          .where('familyId', '==', familyId).limit(BATCH_LIMIT).get();
        for (const docSnap of legacySnap.docs) {
          await docSnap.ref.delete();
          deleted += 1;
        }
        if (legacySnap.docs.length > 0) {
          await setPhase(ctx, familyId, {
            'progress.deletedExternalRecords': (job.progress.deletedExternalRecords ?? 0) + deleted,
          });
          return 'continue';
        }
      }
      await setPhase(ctx, familyId, { phase: 'delete_family_subcollections', phaseAttemptCount: 0 });
      return 'continue';
    }

    case 'delete_family_subcollections': {
      // Dynamic enumeration is the cleanup mechanism; the registry above is
      // only a reviewed regression guard. The family document itself is
      // never passed to a recursive delete.
      const collections = await familyRef(db, familyId).listCollections();
      if (collections.length === 0) {
        await setPhase(ctx, familyId, { phase: 'verify_orphans', phaseAttemptCount: 0 });
        return 'continue';
      }
      let deletedDocs = 0;
      for (const coll of collections) {
        await renewLease(ctx, familyId);
        deletedDocs += await recursiveDeleteCollection(ctx, coll);
      }
      await setPhase(ctx, familyId, {
        'progress.deletedFamilyDocuments': (job.progress.deletedFamilyDocuments ?? 0) + deletedDocs,
      });
      return 'continue';
    }

    case 'verify_orphans': {
      const members = await membersQuery(ctx, familyId, 1);
      if (members.docs.length > 0) {
        await setPhase(ctx, familyId, { phase: 'delete_managed_identities', phaseAttemptCount: 0 });
        return 'continue';
      }
      const idem = await db.collection('familyMembershipIdempotency')
        .where('familyId', '==', familyId).limit(1).get();
      if (idem.docs.length > 0) {
        await setPhase(ctx, familyId, { phase: 'delete_external_references', phaseAttemptCount: 0 });
        return 'continue';
      }
      for (const namespace of LEGACY_ROOT_NAMESPACES) {
        const legacy = await db.collection(namespace)
          .where('familyId', '==', familyId).limit(1).get();
        if (legacy.docs.length > 0) {
          await setPhase(ctx, familyId, { phase: 'delete_external_references', phaseAttemptCount: 0 });
          return 'continue';
        }
      }
      const collections = await familyRef(db, familyId).listCollections();
      if (collections.length > 0) {
        await setPhase(ctx, familyId, { phase: 'delete_family_subcollections', phaseAttemptCount: 0 });
        return 'continue';
      }

      // Auth linkage re-verification (R6). Firestore residue is not enough:
      // the identity side must be proven clean before the family document is
      // allowed to disappear.
      for (const authUid of job.managedAuthUids ?? []) {
        await renewLease(ctx, familyId);
        const user = await getAuthUserOrNull(ctx, authUid);
        if (user) {
          // Profile deleted but the managed Auth identity survives: a
          // contradictory state that must never be finalized.
          throw new LinkageError('managed auth identity survived profile deletion');
        }
      }

      const stale: string[] = [];
      for (const uid of job.selfRegisteredUids ?? []) {
        await renewLease(ctx, familyId);
        const user = await getAuthUserOrNull(ctx, uid);
        if (!user) continue;
        const claims = (user.customClaims ?? {}) as Record<string, unknown>;
        if (claims.familyId === familyId || claims.childId != null || claims.managedChild === true) {
          stale.push(uid);
        }
      }
      if (stale.length > 0) {
        if (job.verifyRetried === true) {
          throw new LinkageError('family claims persist after re-verification');
        }
        await setPhase(ctx, familyId, {
          phase: 'revoke_member_access',
          phaseAttemptCount: 0,
          verifyRetried: true,
        });
        return 'continue';
      }

      await setPhase(ctx, familyId, { phase: 'finalize', phaseAttemptCount: 0 });
      return 'continue';
    }

    case 'finalize': {
      // Riding account deletions: owners whose account deletion triggered or
      // joined this family deletion are purged now (Auth deleted last).
      //
      // D8 (cross-spec compatibility): this purge is REQUIRED by the account
      // deletion contract in docs/account-and-family-deletion.md even though
      // the family-deletion specification narrative does not mention it.
      // Removing it would strand accountDeletionJobs records; keep it.
      const acctSnap = await db.collection('accountDeletionJobs')
        .where('familyId', '==', familyId).limit(BATCH_LIMIT).get();
      for (const docSnap of acctSnap.docs) {
        const uid = docSnap.id;
        await db.doc(`users/${uid}`).delete();
        try {
          await ctx.auth.deleteUser(uid);
        } catch (err: any) {
          if (err?.code !== 'auth/user-not-found' && err?.errorInfo?.code !== 'auth/user-not-found') throw err;
        }
        await docSnap.ref.delete();
      }

      // Completion is atomic: the durable receipt and the removal of the
      // family document commit together, after re-reading both inside the
      // transaction.
      //
      // Receipt schema (spec): schemaVersion, familyId, requestedBy, startedAt,
      // completedAt, outcome, expiresAt. No progress counts are retained and
      // expiresAt is a Timestamp so the Firestore TTL policy can act on it.
      const outcome: 'written' | 'already' | 'invariant' = await db.runTransaction(async (t: any) => {
        const [familySnap, receiptSnap] = await Promise.all([
          t.get(familyRef(db, familyId)),
          t.get(receiptRef(db, familyId)),
        ]);
        if (receiptSnap.exists) {
          // Resumed finalize: the receipt already proves success. Never
          // rewrite it; only remove a family document left behind.
          if (familySnap.exists) t.delete(familyRef(db, familyId));
          return 'already';
        }
        // Family gone with no receipt: a contradictory state that must never
        // be finalized silently.
        if (!familySnap.exists) return 'invariant';
        t.set(receiptRef(db, familyId), buildReceipt(ctx, familyId, job));
        t.delete(familyRef(db, familyId));
        return 'written';
      });
      if (outcome === 'invariant') {
        throw new InvariantViolation('family and receipt both missing at finalize');
      }

      // The job document is disposable bookkeeping: deleting it is a separate,
      // best-effort write outside the completion transaction.
      try {
        await jobRef(db, familyId).delete();
      } catch {
        /* recovery scheduler sees a completed family with a receipt */
      }
      return 'completed';
    }
  }
}

async function recursiveDeleteCollection(ctx: FamilyDeletionContext, coll: any): Promise<number> {
  // Prefer the Admin SDK recursive delete when available (production);
  // fall back to manual bounded deletion (tests / partial mocks).
  if (typeof ctx.db.recursiveDelete === 'function') {
    await ctx.db.recursiveDelete(coll);
    return 1;
  }
  let deleted = 0;
  const snap = await coll.limit(BATCH_LIMIT).get();
  for (const docSnap of snap.docs) {
    if (typeof docSnap.ref.listCollections === 'function') {
      const nested = await docSnap.ref.listCollections();
      for (const nestedColl of nested) {
        deleted += await recursiveDeleteCollection(ctx, nestedColl);
      }
    }
    await docSnap.ref.delete();
    deleted += 1;
  }
  return deleted;
}

// ---------------------------------------------------------------------------
// recoverFamilyDeletionJobs — dispatch-gap closure
// ---------------------------------------------------------------------------

export async function recoverFamilyDeletionJobsImpl(ctx: FamilyDeletionContext): Promise<number> {
  const { db } = ctx;
  const now = ctx.now();
  let enqueued = 0;
  const snap = await db.collection('familyDeletionJobs').limit(100).get();
  for (const docSnap of snap.docs) {
    const job = docSnap.data() as FamilyDeletionJob;
    const eligible =
      job.state === 'queued'
      || (job.state === 'retry_wait' && (job.nextAttemptAt == null || job.nextAttemptAt <= now))
      || (job.state === 'running' && (job.leaseExpiresAt == null || job.leaseExpiresAt <= now));
    if (eligible) {
      await ctx.enqueue(job.familyId).catch(() => undefined);
      enqueued += 1;
    }
  }
  return enqueued;
}

// ---------------------------------------------------------------------------
// leaveFamily — non-owner self-registered departure
// ---------------------------------------------------------------------------

export interface LeaveFamilyResult { left: boolean }

export async function leaveFamilyImpl(
  ctx: FamilyDeletionContext,
  callerUid: string,
  rawInput: unknown,
): Promise<LeaveFamilyResult> {
  const data = (rawInput ?? {}) as Record<string, unknown>;
  const familyId = typeof data.familyId === 'string' ? data.familyId : '';
  if (!familyId) throw new HttpsError('invalid-argument', 'FAMILY_ID_REQUIRED');
  const { db } = ctx;

  await db.runTransaction(async (t: any) => {
    const [callerSnap, familySnap] = await Promise.all([
      t.get(db.doc(`users/${callerUid}`)),
      t.get(familyRef(db, familyId)),
    ]);
    const caller = callerSnap.exists ? callerSnap.data() : null;
    // Already departed: success (idempotent retry).
    if (!caller || caller.familyId !== familyId) return;
    if (caller.role === 'owner') throw new HttpsError('failed-precondition', 'OWNER_CANNOT_LEAVE');
    if (caller.isManaged === true) throw new HttpsError('permission-denied', 'MANAGED_CHILD_CANNOT_LEAVE');
    if (familySnap.exists && familySnap.data().lifecycleState === 'deleting') {
      throw new HttpsError('failed-precondition', 'FAMILY_DELETING');
    }
    t.update(db.doc(`users/${callerUid}`), familyScopedProfileClearUpdate());
    t.delete(db.doc(`families/${familyId}/users/${callerUid}`));
  });

  await stripFamilyClaims(ctx, callerUid);
  return { left: true };
}

// ---------------------------------------------------------------------------
// Deployment wiring
// ---------------------------------------------------------------------------

const QUEUE_NAME = 'processFamilyDeletion';

function makeContext(): FamilyDeletionContext {
  return {
    db: getFirestore(),
    auth: getAuth(),
    enqueue: async (familyId: string, delaySeconds = 0) => {
      const queue = getFunctions().taskQueue(QUEUE_NAME);
      await queue.enqueue({ familyId }, delaySeconds > 0 ? { scheduleDelaySeconds: delaySeconds } : undefined);
    },
    now: () => Date.now(),
    invocationId: `proc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

function requireAuth(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'AUTH_REQUIRED');
  return uid;
}

export const deleteFamily = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  async (request: CallableRequest<DeleteFamilyInput>) =>
    deleteFamilyImpl(makeContext(), requireAuth(request), request.data),
);

export const getFamilyDeletionStatus = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  async (request: CallableRequest<{ familyId?: string }>) => {
    const uid = requireAuth(request);
    const familyId = typeof request.data?.familyId === 'string' ? request.data.familyId : '';
    if (!familyId) throw new HttpsError('invalid-argument', 'FAMILY_ID_REQUIRED');
    return getFamilyDeletionStatusImpl(makeContext(), uid, familyId);
  },
);

export const leaveFamily = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  async (request: CallableRequest<{ familyId?: string }>) =>
    leaveFamilyImpl(makeContext(), requireAuth(request), request.data),
);

export const processFamilyDeletion = onTaskDispatched(
  {
    region: 'europe-west1',
    retryConfig: { maxAttempts: 20, minBackoffSeconds: 30 },
    rateLimits: { maxConcurrentDispatches: 1 },
    timeoutSeconds: 540,
  },
  async task => {
    const familyId = (task.data as { familyId?: string })?.familyId;
    if (!familyId) return;
    await processFamilyDeletionImpl(makeContext(), familyId);
  },
);

export const recoverFamilyDeletionJobs = onSchedule(
  { region: 'europe-west1', schedule: 'every 10 minutes' },
  async () => {
    await recoverFamilyDeletionJobsImpl(makeContext());
  },
);
