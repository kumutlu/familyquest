// ---------------------------------------------------------------------------
// FAMILYQUEST — regional Cloud Tasks enqueue boundary (P0 root fix)
// ---------------------------------------------------------------------------
// The family-deletion worker processFamilyDeletion is deployed in
// europe-west1. An UNQUALIFIED taskQueue('processFamilyDeletion') resolves to
// the project's default region (us-central1), so every enqueue silently
// targeted a nonexistent queue and left familyDeletionJobs queued forever.
//
// This module is the single injectable boundary for enqueueing that worker.
// It pins the fully-qualified target and replaces silent failure with a
// sanitized structured log: operation, familyId, error code, target only.
// Never log emails, display names, auth tokens, or payload contents.
// ---------------------------------------------------------------------------

import { getFunctions } from 'firebase-admin/functions';

export const FAMILY_DELETION_QUEUE_TARGET =
  'locations/europe-west1/functions/processFamilyDeletion';

/** Redact an identifier to its first 6 chars for safe correlation in logs. */
export function redactId(id: string): string {
  return id ? `${id.slice(0, 6)}…` : '';
}

export async function enqueueFamilyDeletionTask(
  familyId: string,
  delaySeconds = 0,
): Promise<void> {
  const queue = getFunctions().taskQueue(FAMILY_DELETION_QUEUE_TARGET);
  try {
    await queue.enqueue(
      { familyId },
      delaySeconds > 0 ? { scheduleDelaySeconds: delaySeconds } : undefined,
    );
  } catch (err: unknown) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'UNKNOWN';
    // Sanitized structured logging — safe fields only. The durable job stays
    // queued for recoverFamilyDeletionJobs regardless of this failure.
    console.error(
      JSON.stringify({
        severity: 'ERROR',
        operation: 'FAMILY_DELETION_ENQUEUE_FAILED',
        familyId: redactId(familyId),
        errorCode: code,
        target: FAMILY_DELETION_QUEUE_TARGET,
      }),
    );
  }
}
