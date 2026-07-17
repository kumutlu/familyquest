import { ApprovalCenter } from '../ApprovalCenter';

/**
 * Pending Approvals section for the parent dashboard.
 *
 * Reuses the existing Approval Center component (data, business logic, and
 * approval card) so we do not duplicate approval handling. The Approval Center
 * already surfaces the pending count, latest pending items, type badges, member
 * names, amounts, timestamps, and Approve/Reject actions, and provides a
 * History tab for the full list (so we avoid a dead "View all" button).
 */
export function PendingApprovalsSection() {
  return <ApprovalCenter />;
}
