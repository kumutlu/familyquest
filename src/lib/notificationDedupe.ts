// ---------------------------------------------------------------------------
// CENTRAL DETERMINISTIC DE-DUPLICATION KEYS
// ---------------------------------------------------------------------------
//
// Every notification de-duplication key is built here from stable business
// identifiers only. The keys are:
//
//  - deterministic: built purely from business ids, never timestamps/random;
//  - unique per business event;
//  - stable across retries (so the idempotent write in
//    `queueNotificationInTransaction` skips duplicates);
//  - distinct between separate recipients where the message wording differs
//    (transfer approval sender vs recipient);
//  - distinct between approval and rejection;
//  - distinct between sender and recipient transfer notifications.
//
// These replace the inline string literals previously scattered across api.ts.

export function taskSubmittedKey(completionId: string): string {
  return `task_submit_${completionId}`;
}
export function taskApprovedKey(completionId: string): string {
  return `task_approve_${completionId}`;
}
export function taskRejectedKey(completionId: string): string {
  return `task_reject_${completionId}`;
}
export function rewardRequestedKey(redemptionId: string): string {
  return `reward_request_${redemptionId}`;
}
export function behaviourKey(eventId: string): string {
  return `behaviour_${eventId}`;
}
export function walletDepositKey(txId: string): string {
  return `deposit_${txId}`;
}
export function walletWithdrawalKey(txId: string): string {
  return `withdraw_${txId}`;
}
export function petboxContributionKey(requestId: string): string {
  return `petbox_contrib_${requestId}`;
}
export function petboxExpenseKey(txId: string): string {
  return `petbox_expense_${txId}`;
}
export function transferRequestedKey(requestId: string): string {
  return `transfer_request_${requestId}`;
}
export function transferApprovedSenderKey(requestId: string): string {
  return `transfer_approve_sender_${requestId}`;
}
export function transferApprovedRecipientKey(requestId: string): string {
  return `transfer_approve_recipient_${requestId}`;
}
export function transferRejectedKey(requestId: string): string {
  return `transfer_reject_${requestId}`;
}

/**
 * One notification per claimed challenge (all rewarded children are recipients,
 * each with independent read state). Deterministic so a retried claim can never
 * create a second celebration row.
 */
export function challengeCompletedKey(challengeId: string): string {
  return `challenge_completed_${challengeId}`;
}

export function profileUpdateRequestedKey(requestId: string): string {
  return `profile_update_request_${requestId}`;
}
export function profileUpdateApprovedKey(requestId: string): string {
  return `profile_update_approve_${requestId}`;
}
export function profileUpdateRejectedKey(requestId: string): string {
  return `profile_update_reject_${requestId}`;
}

/**
 * One notification per created goal. Deterministic on the goal id so a retried
 * (idempotent) goal creation can never create a second notification row, and the
 * existing notification de-duplication read in `loadNotificationRecipientsInTransaction`
 * skips the write when the doc already exists.
 */
export function goalCreatedKey(goalId: string): string {
  return `goal_created_${goalId}`;
}
