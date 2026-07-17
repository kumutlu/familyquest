// ---------------------------------------------------------------------------
// Transaction / Firestore error mapping
// ---------------------------------------------------------------------------
//
// Production must NEVER surface internal Firestore errors such as:
//   "Firestore transactions require all reads to be executed before all writes."
//
// This module maps those (and similar) internal errors to a single friendly,
// non-technical message. In development only, it logs the diagnostic details
// (Firebase code, operation name, request id, failing stage, stack) so the
// failure can be reproduced without leaking internals to users.

export const PROFILE_UPDATE_FRIENDLY_ERROR =
  "We couldn't submit your profile changes. Please try again.";

export const GENERIC_TRANSACTION_FRIENDLY_ERROR =
  "Something went wrong while saving. Please try again.";

/** Internal substrings that must never reach the user. */
const INTERNAL_ERROR_PATTERNS = [
  'transactions require all reads',
  'all reads to be executed before all writes',
  'transaction',
  'firestore',
  'internal',
];

/** Known Firebase error codes that must never be surfaced verbatim. */
const INTERNAL_ERROR_CODES = new Set([
  'permission-denied',
  'unavailable',
  'deadline-exceeded',
  'cancelled',
  'data-loss',
  'internal',
  'resource-exhausted',
  'aborted',
]);

export interface TransactionErrorContext {
  /** Logical operation, e.g. 'submitProfileUpdateRequest'. */
  operation?: string;
  /** Stable request id when available (e.g. generated request document id). */
  requestId?: string;
  /** Which phase failed: 'read' | 'validate' | 'write'. */
  stage?: 'read' | 'validate' | 'write';
}

function isInternalError(code: string | undefined, message: string): boolean {
  if (code && INTERNAL_ERROR_CODES.has(code)) return true;
  const lower = message.toLowerCase();
  return INTERNAL_ERROR_PATTERNS.some(p => lower.includes(p));
}

/**
 * Maps a raw error to a user-safe message. Internal Firestore / transaction
 * errors are replaced with operation-specific friendly copy. In development,
 * the real diagnostic (code, operation, stage, message, stack) is logged so
 * the failure can be reproduced without leaking internals to users.
 *
 * Specific Firebase codes are mapped to useful, non-technical guidance:
 *  - permission-denied  -> the request was blocked by security rules
 *  - failed-precondition -> e.g. a transaction was aborted / retried too often
 *  - unavailable        -> transient backend outage, safe to retry
 *  - validation         -> our own thrown, user-facing messages pass through
 */
export function mapTransactionError(
  error: unknown,
  context: TransactionErrorContext = {},
): string {
  const raw = error as { code?: string; message?: string; stack?: string } | null | undefined;
  const code = raw?.code;
  const message = raw?.message || (typeof error === 'string' ? error : '') || 'Unknown error';

  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.error('[transaction-error]', {
      code,
      operation: context.operation,
      requestId: context.requestId,
      stage: context.stage,
      message,
      stack: raw?.stack,
    });
  }

  // Surface domain/business errors (our own thrown messages, no Firebase code
  // and not an internal pattern) exactly as-is so specific validation copy such
  // as "Display name cannot be empty." reaches the user.
  if (!code && !isInternalError(code, message)) {
    return message;
  }

  // Operation-specific, child-safe friendly messages. Raw Firebase internals
  // are NEVER surfaced to the user.
  if (context.operation === 'submitProfileUpdateRequest') {
    switch (code) {
      case 'permission-denied':
        return 'Your profile change could not be submitted. Please ask a parent to check the approval settings and try again.';
      case 'failed-precondition':
        return 'This change could not be saved right now. Please wait a moment and try again.';
      case 'unavailable':
        return 'The service is temporarily unavailable. Please check your connection and try again.';
      default:
        return PROFILE_UPDATE_FRIENDLY_ERROR;
    }
  }
  return GENERIC_TRANSACTION_FRIENDLY_ERROR;
}
