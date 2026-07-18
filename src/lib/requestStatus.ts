/**
 * Central request status classification
 * -------------------------------------
 * Every approval-based workflow (money, transfer, reward, profile update, task
 * completion, …) uses a small, finite set of status strings. UI and business
 * logic must never scatter raw string comparisons across components — they
 * should always go through the helpers below so a new status can be supported
 * in exactly one place.
 *
 * Only statuses that genuinely exist in this codebase are classified here:
 *   - pending            (transfer / money / petbox / profile-update requests)
 *   - pending_acceptance (money request awaiting the requested-from person)
 *   - pending_approval   (task completions awaiting a parent)
 *   - approved           (resolved — approved)
 *   - completed          (resolved — reward redemption fulfilled)
 *   - rejected           (resolved — rejected)
 *   - cancelled          (resolved — cancelled by requester/parent)
 */

// Unresolved statuses that an outgoing child transfer request can legitimately
// hold while it is still awaiting a decision. Transfer requests are created
// with `pending` (see firestore.rules + api.createTransferRequest) and only
// that status is produced by the current production workflow, so it is the
// single source of truth here. We keep the list explicit (rather than reusing
// the broader PENDING_STATUSES set) so the Pending-transfers query/filter never
// accidentally pulls in money-request-only states such as `pending_acceptance`.
export const PENDING_TRANSFER_STATUSES: readonly string[] = ['pending'];

/** True for a transfer request that is still awaiting parent approval. */
export function isPendingTransferStatus(status: string | undefined | null): boolean {
  return !!status && PENDING_TRANSFER_STATUSES.includes(status);
}

const PENDING_STATUSES = new Set(['pending', 'pending_acceptance', 'pending_approval']);
const APPROVED_STATUSES = new Set(['approved', 'completed']);
const REJECTED_STATUSES = new Set(['rejected']);
const CANCELLED_STATUSES = new Set(['cancelled']);
const RESOLVED_STATUSES = new Set([
  ...APPROVED_STATUSES,
  ...REJECTED_STATUSES,
  ...CANCELLED_STATUSES,
]);

/** True for every unresolved, actionable request state. */
export function isPendingApprovalStatus(status: string | undefined | null): boolean {
  return !!status && PENDING_STATUSES.has(status);
}

/** True once a request has been approved (or fulfilled). */
export function isApprovedStatus(status: string | undefined | null): boolean {
  return !!status && APPROVED_STATUSES.has(status);
}

/** True once a request has been rejected. */
export function isRejectedStatus(status: string | undefined | null): boolean {
  return !!status && REJECTED_STATUSES.has(status);
}

/** True once a request has been cancelled. */
export function isCancelledStatus(status: string | undefined | null): boolean {
  return !!status && CANCELLED_STATUSES.has(status);
}

/** True for any terminal state (approved, rejected, cancelled, …). */
export function isResolvedStatus(status: string | undefined | null): boolean {
  return !!status && RESOLVED_STATUSES.has(status);
}
