// ---------------------------------------------------------------------------
// FAMILYQUEST — SERVER-AUTHORITATIVE MEMBER LIFECYCLE (backend)
// ---------------------------------------------------------------------------
//
// Implements the family member lifecycle without ever trusting client-supplied
// role / familyId / lifecycle / ownership. Every operation re-derives the
// caller's identity and the target's membership from server records.
//
// Lifecycle states (explicit `lifecycle` field on users/{uid}; distinct from the
// legacy `status` field which only carries 'deleted' / 'disabled'):
//   active   — normal participating member (default when absent).
//   archived — preserved in the family, history intact, no active participation.
//   removed  — account survives, family membership terminated, history retained.
//
// Historical-data guarantee: NONE of these operations delete gamification
// events, wallets, wallet_transactions, task_completions, behaviour_events,
// redemptions, feed, notifications, daily_progress, challenge records, rankings,
// or audit records. Archive/Remove only flip a lifecycle flag or clear
// family-scoped profile fields; the authoritative ledger is never touched.
//
// Authorization matrix (enforced here, not in the UI):
//   OWNER  : archive/restore any non-owner member; remove parent/adult (never a child);
//            changeRole (adult<->parent); transferOwnership.
//   PARENT : archive/restore a CHILD only (never remove, never change role).
//   ADULT  : leave (see familyDeletion.leaveFamily); cannot manage others.
//   CHILD  : nothing here (cannot archive/remove/change self or others).
//   NOTE  : children are NEVER removed via Remove From Family. A child is
//            archived/restored (parent or owner) or permanently deleted via the
//            dedicated Danger Zone child-deletion flow. child->adult promotion
//            is intentionally unsupported (see docs/member-lifecycle-contract.md).
// ---------------------------------------------------------------------------

import { getFirestore, FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { familyScopedProfileClearUpdate } from './familyDeletion';

export type MemberLifecycle = 'active' | 'archived' | 'removed';

export interface MemberLifecycleContext {
  db: Firestore;
  now?: () => Date;
}

export interface LifecycleTargetInput {
  targetUid: string;
  clientReqId: string;
}

export interface ChangeRoleInput {
  targetUid: string;
  newRole: 'adult' | 'parent';
  clientReqId: string;
}

export interface TransferOwnershipInput {
  targetUid: string;
  clientReqId: string;
}

export interface LifecycleResult {
  targetUid: string;
  lifecycle: MemberLifecycle;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireUid(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'AUTH_REQUIRED');
  return uid;
}

function validateTargetUid(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    throw new HttpsError('invalid-argument', 'TARGET_UID_REQUIRED');
  }
  return value;
}

function validateClientReqId(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    throw new HttpsError('invalid-argument', 'CLIENT_REQ_ID_REQUIRED');
  }
  return value;
}

function isOwnerRole(role: unknown): boolean {
  return role === 'owner';
}
function isParentRole(role: unknown): boolean {
  return role === 'owner' || role === 'parent';
}
function isChildRole(role: unknown): boolean {
  return role === 'child';
}

/** A member is "inactive" if soft-deleted/disabled or already lifecycle-exited. */
function isInactiveMember(doc: Record<string, unknown> | null): boolean {
  if (!doc) return true;
  const status = doc.status;
  if (status === 'deleted' || status === 'disabled') return true;
  if (doc.disabled === true) return true;
  const lifecycle = doc.lifecycle;
  return lifecycle === 'archived' || lifecycle === 'removed';
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

export async function archiveMemberImpl(
  ctx: MemberLifecycleContext,
  callerUid: string,
  input: LifecycleTargetInput,
): Promise<LifecycleResult> {
  const targetUid = validateTargetUid(input?.targetUid);
  validateClientReqId(input?.clientReqId);
  const { db } = ctx;

  await db.runTransaction(async (t: Transaction) => {
    const [callerSnap, targetSnap] = await Promise.all([
      t.get(db.doc(`users/${callerUid}`)),
      t.get(db.doc(`users/${targetUid}`)),
    ]);
    const caller = callerSnap.exists ? (callerSnap.data() as Record<string, unknown>) : null;
    const target = targetSnap.exists ? (targetSnap.data() as Record<string, unknown>) : null;

    if (!caller || typeof caller.familyId !== 'string') {
      throw new HttpsError('permission-denied', 'NOT_AUTHORIZED');
    }
    const familyId: string = caller.familyId;

    // Authorization: owner may archive anyone non-owner; parent may archive a child only.
    const callerIsOwner = isOwnerRole(caller.role);
    const callerIsParent = isParentRole(caller.role);
    if (!callerIsOwner && !callerIsParent) {
      throw new HttpsError('permission-denied', 'NOT_AUTHORIZED');
    }

    if (!target || typeof target.familyId !== 'string' || target.familyId !== familyId) {
      throw new HttpsError('not-found', 'TARGET_NOT_IN_FAMILY');
    }
    if (targetUid === callerUid) throw new HttpsError('failed-precondition', 'CANNOT_ARCHIVE_SELF');
    if (isOwnerRole(target.role)) throw new HttpsError('failed-precondition', 'CANNOT_ARCHIVE_OWNER');

    // Parent may only archive children; owner may archive anyone non-owner.
    if (!callerIsOwner && !isChildRole(target.role)) {
      throw new HttpsError('permission-denied', 'NOT_AUTHORIZED');
    }
    if (isInactiveMember(target)) {
      // Idempotent: already archived/removed/deleted is not an error.
      if (target.lifecycle === 'archived') return;
      throw new HttpsError('failed-precondition', 'TARGET_INACTIVE');
    }

    t.update(db.doc(`users/${targetUid}`), {
      lifecycle: 'archived',
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy: callerUid,
    });
    // Keep the family membership projection consistent (server-only, historical).
    t.set(db.doc(`families/${familyId}/users/${targetUid}`), {
      uid: targetUid,
      displayName: target.displayName,
      avatarUrl: target.avatarUrl ?? '',
      avatarConfig: target.avatarConfig ?? null,
      role: target.role,
      lifecycle: 'archived',
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy: callerUid,
    }, { merge: true });
  });

  return { targetUid, lifecycle: 'archived' };
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export async function restoreMemberImpl(
  ctx: MemberLifecycleContext,
  callerUid: string,
  input: LifecycleTargetInput,
): Promise<LifecycleResult> {
  const targetUid = validateTargetUid(input?.targetUid);
  validateClientReqId(input?.clientReqId);
  const { db } = ctx;

  await db.runTransaction(async (t: Transaction) => {
    const [callerSnap, targetSnap] = await Promise.all([
      t.get(db.doc(`users/${callerUid}`)),
      t.get(db.doc(`users/${targetUid}`)),
    ]);
    const caller = callerSnap.exists ? (callerSnap.data() as Record<string, unknown>) : null;
    const target = targetSnap.exists ? (targetSnap.data() as Record<string, unknown>) : null;

    if (!caller || typeof caller.familyId !== 'string') {
      throw new HttpsError('permission-denied', 'NOT_AUTHORIZED');
    }
    const familyId: string = caller.familyId;
    const callerIsOwner = isOwnerRole(caller.role);
    const callerIsParent = isParentRole(caller.role);
    if (!callerIsOwner && !callerIsParent) {
      throw new HttpsError('permission-denied', 'NOT_AUTHORIZED');
    }

    if (!target || typeof target.familyId !== 'string' || target.familyId !== familyId) {
      throw new HttpsError('not-found', 'TARGET_NOT_IN_FAMILY');
    }
    if (isOwnerRole(target.role)) throw new HttpsError('failed-precondition', 'CANNOT_RESTORE_OWNER');
    if (!callerIsOwner && !isChildRole(target.role)) {
      throw new HttpsError('permission-denied', 'NOT_AUTHORIZED');
    }
    if (target.lifecycle !== 'archived') {
      // Idempotent: already active is not an error.
      if (target.lifecycle === 'active' || target.lifecycle === undefined) return;
      throw new HttpsError('failed-precondition', 'TARGET_NOT_ARCHIVED');
    }

    t.update(db.doc(`users/${targetUid}`), {
      lifecycle: 'active',
      archivedAt: FieldValue.delete(),
      archivedBy: FieldValue.delete(),
    });
    t.set(db.doc(`families/${familyId}/users/${targetUid}`), {
      uid: targetUid,
      displayName: target.displayName,
      avatarUrl: target.avatarUrl ?? '',
      avatarConfig: target.avatarConfig ?? null,
      role: target.role,
      lifecycle: 'active',
    }, { merge: true });
  });

  return { targetUid, lifecycle: 'active' };
}

// ---------------------------------------------------------------------------
// Remove from family (non-destructive membership separation)
// ---------------------------------------------------------------------------

export async function removeMemberFromFamilyImpl(
  ctx: MemberLifecycleContext,
  callerUid: string,
  input: LifecycleTargetInput,
): Promise<LifecycleResult> {
  const targetUid = validateTargetUid(input?.targetUid);
  validateClientReqId(input?.clientReqId);
  const { db } = ctx;

  await db.runTransaction(async (t: Transaction) => {
    const [callerSnap, targetSnap] = await Promise.all([
      t.get(db.doc(`users/${callerUid}`)),
      t.get(db.doc(`users/${targetUid}`)),
    ]);
    const caller = callerSnap.exists ? (callerSnap.data() as Record<string, unknown>) : null;
    const target = targetSnap.exists ? (targetSnap.data() as Record<string, unknown>) : null;

    if (!caller || !isOwnerRole(caller.role) || typeof caller.familyId !== 'string') {
      throw new HttpsError('permission-denied', 'NOT_AUTHORIZED');
    }
    const familyId: string = caller.familyId;

    if (!target || typeof target.familyId !== 'string' || target.familyId !== familyId) {
      throw new HttpsError('not-found', 'TARGET_NOT_IN_FAMILY');
    }
    if (targetUid === callerUid) throw new HttpsError('failed-precondition', 'CANNOT_REMOVE_SELF');
    if (isOwnerRole(target.role)) throw new HttpsError('failed-precondition', 'CANNOT_REMOVE_OWNER');
    // Children are NEVER detached via Remove From Family. A child is either
    // archived/restored (parent or owner) or permanently deleted via the
    // dedicated Danger Zone child-deletion flow. Removing a child — managed or
    // self-registered — would leave an ambiguous account state (an account no
    // longer in a family yet still carrying child-specific identity, login,
    // and history), so it is intentionally unsupported for every caller.
    if (isChildRole(target.role)) {
      throw new HttpsError('failed-precondition', 'CHILD_REMOVE_NOT_SUPPORTED');
    }

    // Preserve identity (displayName/avatar) on the user doc; only strip the
    // family-scoped fields so the account can later join/create another family.
    t.update(db.doc(`users/${targetUid}`), {
      ...familyScopedProfileClearUpdate(),
      lifecycle: 'removed',
      removedAt: FieldValue.serverTimestamp(),
      removedBy: callerUid,
    });
    // Retain a historical-identity projection so former-family history can still
    // resolve the member's name/avatar. Never deleted.
    t.set(db.doc(`families/${familyId}/users/${targetUid}`), {
      uid: targetUid,
      displayName: target.displayName,
      avatarUrl: target.avatarUrl ?? '',
      role: target.role,
      lifecycle: 'removed',
      removedAt: FieldValue.serverTimestamp(),
      removedBy: callerUid,
    }, { merge: true });
  });

  return { targetUid, lifecycle: 'removed' };
}

// ---------------------------------------------------------------------------
// Change role (owner only; adult <-> parent; never owner/child; no self-esc)
// ---------------------------------------------------------------------------

export async function changeMemberRoleImpl(
  ctx: MemberLifecycleContext,
  callerUid: string,
  input: ChangeRoleInput,
): Promise<{ targetUid: string; role: string }> {
  const targetUid = validateTargetUid(input?.targetUid);
  const newRole = input?.newRole;
  if (newRole !== 'adult' && newRole !== 'parent') {
    throw new HttpsError('invalid-argument', 'INVALID_ROLE');
  }
  validateClientReqId(input?.clientReqId);
  const { db } = ctx;

  await db.runTransaction(async (t: Transaction) => {
    const [callerSnap, targetSnap] = await Promise.all([
      t.get(db.doc(`users/${callerUid}`)),
      t.get(db.doc(`users/${targetUid}`)),
    ]);
    const caller = callerSnap.exists ? (callerSnap.data() as Record<string, unknown>) : null;
    const target = targetSnap.exists ? (targetSnap.data() as Record<string, unknown>) : null;

    if (!caller || !isOwnerRole(caller.role) || typeof caller.familyId !== 'string') {
      throw new HttpsError('permission-denied', 'NOT_AUTHORIZED');
    }
    const familyId: string = caller.familyId;
    if (!target || typeof target.familyId !== 'string' || target.familyId !== familyId) {
      throw new HttpsError('not-found', 'TARGET_NOT_IN_FAMILY');
    }
    if (targetUid === callerUid) throw new HttpsError('failed-precondition', 'CANNOT_CHANGE_OWN_ROLE');
    if (isOwnerRole(target.role)) throw new HttpsError('failed-precondition', 'CANNOT_CHANGE_OWNER');
    if (isChildRole(target.role)) throw new HttpsError('failed-precondition', 'CANNOT_CHANGE_CHILD');
    if (isInactiveMember(target)) throw new HttpsError('failed-precondition', 'TARGET_INACTIVE');

    t.update(db.doc(`users/${targetUid}`), { role: newRole });
    t.set(db.doc(`families/${familyId}/users/${targetUid}`), {
      uid: targetUid,
      displayName: target.displayName,
      avatarUrl: target.avatarUrl ?? '',
      role: newRole,
      lifecycle: target.lifecycle ?? 'active',
    }, { merge: true });
  });

  return { targetUid, role: newRole };
}

// ---------------------------------------------------------------------------
// Transfer ownership (owner only; to eligible adult/parent; never ownerless)
// ---------------------------------------------------------------------------

export async function transferOwnershipImpl(
  ctx: MemberLifecycleContext,
  callerUid: string,
  input: TransferOwnershipInput,
): Promise<{ targetUid: string; previousOwnerUid: string }> {
  const targetUid = validateTargetUid(input?.targetUid);
  validateClientReqId(input?.clientReqId);
  const { db } = ctx;

  await db.runTransaction(async (t: Transaction) => {
    const [callerSnap, targetSnap] = await Promise.all([
      t.get(db.doc(`users/${callerUid}`)),
      t.get(db.doc(`users/${targetUid}`)),
    ]);
    const caller = callerSnap.exists ? (callerSnap.data() as Record<string, unknown>) : null;
    const target = targetSnap.exists ? (targetSnap.data() as Record<string, unknown>) : null;

    if (!caller || !isOwnerRole(caller.role) || typeof caller.familyId !== 'string') {
      throw new HttpsError('permission-denied', 'NOT_AUTHORIZED');
    }
    const familyId: string = caller.familyId;
    if (!target || typeof target.familyId !== 'string' || target.familyId !== familyId) {
      throw new HttpsError('not-found', 'TARGET_NOT_IN_FAMILY');
    }
    if (targetUid === callerUid) throw new HttpsError('failed-precondition', 'ALREADY_OWNER');
    // Eligible successors: an active adult or parent. Never a child, never inactive.
    if (isChildRole(target.role)) throw new HttpsError('failed-precondition', 'TARGET_NOT_ELIGIBLE');
    if (target.role !== 'adult' && target.role !== 'parent') {
      throw new HttpsError('failed-precondition', 'TARGET_NOT_ELIGIBLE');
    }
    if (isInactiveMember(target)) throw new HttpsError('failed-precondition', 'TARGET_INACTIVE');

    // New owner promoted; previous owner demoted to parent so the family is
    // never left ownerless and retains a managing adult.
    t.update(db.doc(`users/${targetUid}`), { role: 'owner' });
    t.update(db.doc(`users/${callerUid}`), { role: 'parent' });
    t.set(db.doc(`families/${familyId}/users/${targetUid}`), {
      uid: targetUid,
      displayName: target.displayName,
      avatarUrl: target.avatarUrl ?? '',
      role: 'owner',
      lifecycle: target.lifecycle ?? 'active',
    }, { merge: true });
    t.set(db.doc(`families/${familyId}/users/${callerUid}`), {
      uid: callerUid,
      displayName: caller.displayName,
      avatarUrl: caller.avatarUrl ?? '',
      role: 'parent',
      lifecycle: caller.lifecycle ?? 'active',
    }, { merge: true });
  });

  return { targetUid, previousOwnerUid: callerUid };
}

// ---------------------------------------------------------------------------
// Deployment wiring
// ---------------------------------------------------------------------------

const productionContext = (): MemberLifecycleContext => ({ db: getFirestore() });

export const archiveMember = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  (request: CallableRequest<LifecycleTargetInput>) =>
    archiveMemberImpl(productionContext(), requireUid(request), request.data),
);

export const restoreMember = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  (request: CallableRequest<LifecycleTargetInput>) =>
    restoreMemberImpl(productionContext(), requireUid(request), request.data),
);

export const removeMemberFromFamily = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  (request: CallableRequest<LifecycleTargetInput>) =>
    removeMemberFromFamilyImpl(productionContext(), requireUid(request), request.data),
);

export const changeMemberRole = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  (request: CallableRequest<ChangeRoleInput>) =>
    changeMemberRoleImpl(productionContext(), requireUid(request), request.data),
);

export const transferOwnership = onCall(
  { region: 'europe-west1', enforceAppCheck: false },
  (request: CallableRequest<TransferOwnershipInput>) =>
    transferOwnershipImpl(productionContext(), requireUid(request), request.data),
);
