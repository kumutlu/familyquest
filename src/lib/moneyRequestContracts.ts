/**
 * Canonical Money Request authorization contract
 * ----------------------------------------------
 * Single source of truth for who may manage a Money Request and in which
 * states. Both the Firestore security rules (firestore.rules) and the client
 * UI (ApprovalCenter, RequestDetailContent) must agree with this contract so a
 * request is never shown as actionable when the underlying mutation would be
 * denied by the rules.
 *
 * Lifecycle
 * ---------
 *  - create:  child -> { requestedFrom is parent/owner ? 'pending'
 *                         : 'pending_acceptance' }
 *  - pending_acceptance: the requested-from person must Accept (-> 'pending')
 *                        or Decline (-> 'rejected'). A parent/owner may also
 *                        Reject a pending_acceptance request, but may only
 *                        APPROVE once it has transitioned to 'pending' (the
 *                        acceptance step sets up the payer wallet ledger that
 *                        isValidMoneyRequestApproval requires).
 *  - pending: an active parent/owner in the same family may Approve
 *             (atomic wallet transfer) or Reject (no money moves).
 *
 * Immutable identity fields (never change after create):
 *   familyId, requesterId, requestedFromId, amountPence
 */

import { isParentRole } from './roles';
import { isPendingApprovalStatus } from './requestStatus';

export type MoneyRequestStatus = 'pending' | 'pending_acceptance' | 'approved' | 'rejected' | 'cancelled';

export interface MoneyRequestIdentity {
  familyId?: string;
  requesterId?: string;
  requestedFromId?: string;
  amountPence?: number;
  status?: string;
}

/**
 * Whether `currentUser` is authorized to APPROVE or REJECT the given money
 * request. This mirrors the Firestore rule branch exactly:
 *   - must be an active parent/owner in the request's family,
 *   - the request must be in a state the parent is allowed to decide.
 *
 * A parent may decide a `pending` request. A parent may REJECT a
 * `pending_acceptance` request, but may NOT approve one (the acceptance step
 * is required first). This prevents the "permission-denied" that occurs when a
 * parent tries to approve a request whose payer ledger has not been set up.
 */
export function canParentManageMoneyRequest(
  identity: MoneyRequestIdentity | undefined,
  currentUser: { id?: string; role?: string; familyId?: string } | null | undefined,
): boolean {
  if (!identity || !currentUser) return false;
  if (!isParentRole(currentUser.role)) return false;
  if (!currentUser.familyId || currentUser.familyId !== identity.familyId) return false;
  if (identity.status === 'pending') return true;
  if (identity.status === 'pending_acceptance') {
    // A parent may reject a pending_acceptance request, but only the
    // requested-from person (or a parent, for reject) may act. Approve is not
    // permitted until the request reaches 'pending'.
    return true;
  }
  return false;
}

/**
 * Whether the current user may APPROVE the request. Approve is only allowed
 * once the request is in `pending` (post-acceptance) state.
 */
export function canApproveMoneyRequest(
  identity: MoneyRequestIdentity | undefined,
  currentUser: { id?: string; role?: string; familyId?: string } | null | undefined,
): boolean {
  if (!canParentManageMoneyRequest(identity, currentUser)) return false;
  return identity?.status === 'pending';
}

/**
 * Whether the current user may REJECT the request. A parent may reject both
 * `pending` and `pending_acceptance` requests.
 */
export function canRejectMoneyRequest(
  identity: MoneyRequestIdentity | undefined,
  currentUser: { id?: string; role?: string; familyId?: string } | null | undefined,
): boolean {
  if (!canParentManageMoneyRequest(identity, currentUser)) return false;
  return identity?.status === 'pending' || identity?.status === 'pending_acceptance';
}

/**
 * Whether the requested-from person may Accept/Decline a `pending_acceptance`
 * request.
 */
export function canAcceptMoneyRequest(
  identity: MoneyRequestIdentity | undefined,
  currentUser: { id?: string; role?: string; familyId?: string } | null | undefined,
): boolean {
  if (!identity || !currentUser) return false;
  if (!currentUser.id) return false;
  if (currentUser.familyId !== identity.familyId) return false;
  if (identity.status !== 'pending_acceptance') return false;
  return identity.requestedFromId === currentUser.id;
}

/** True when the request is still awaiting a decision (any pending state). */
export function isMoneyRequestPending(status: string | undefined): boolean {
  return isPendingApprovalStatus(status);
}
