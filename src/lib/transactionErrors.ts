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
/* -------------------------------------------------------------------------- */
/* THEME SHOP purchase failures                                               */
/* -------------------------------------------------------------------------- */
//
// The Theme Shop is a child-facing surface, so raw Firestore/Firebase codes
// must never reach it — but the REASON a purchase was refused is exactly what
// the child needs in order to act ("you need 13 more points" vs "you already
// own this"). `ThemePurchaseError` carries a machine-readable `kind` from the
// transaction; this section is the single translation point to child copy.

export type ThemePurchaseFailure =
  /** Balance is below the authoritative price. */
  | 'insufficient-points'
  /** An immutable purchase record already exists for this child + item. */
  | 'already-owned'
  /** Nothing sells this item (no catalogue row and not a compiled-in item). */
  | 'unavailable'
  /** The item exists but is not currently sellable (inactive / price 0). */
  | 'not-purchasable'
  /** A parent turned theme shopping off for the family. */
  | 'shopping-disabled'
  /** Only child profiles own themes. */
  | 'not-a-child'
  /** The profile's family does not match the family being written to. */
  | 'family-mismatch'
  /** Managed-child identities have no wallet of their own. */
  | 'managed-profile'
  /** Anything else, including a rules denial. Retryable, no internals. */
  | 'unknown';

/** A purchase refusal with a machine-readable reason. */
export class ThemePurchaseError extends Error {
  readonly kind: ThemePurchaseFailure;

  constructor(kind: ThemePurchaseFailure, message: string) {
    super(message);
    this.name = 'ThemePurchaseError';
    this.kind = kind;
  }
}

/** The generic, retryable purchase failure. */
export const THEME_PURCHASE_FRIENDLY_ERROR = 'Purchase failed — try again.';

/** Child-facing copy for reasons with fixed wording. */
const THEME_FAILURE_COPY: Record<ThemePurchaseFailure, string> = {
  'insufficient-points': THEME_PURCHASE_FRIENDLY_ERROR,
  'already-owned': 'You already own this theme.',
  unavailable: 'This theme isn’t available right now.',
  'not-purchasable': 'This theme isn’t available right now.',
  'shopping-disabled': 'Theme shopping is turned off right now.',
  'not-a-child': 'Only children can unlock themes.',
  'family-mismatch': 'We couldn’t check your family. Try again.',
  'managed-profile': 'This profile can’t buy themes.',
  unknown: THEME_PURCHASE_FRIENDLY_ERROR,
};

/** Firebase codes that map onto a known purchase reason. */
const THEME_FAILURE_CODE_KINDS: Record<string, ThemePurchaseFailure> = {
  'permission-denied': 'unknown',
  unavailable: 'unknown',
  'deadline-exceeded': 'unknown',
  'network-request-failed': 'unknown',
  aborted: 'unknown',
  'failed-precondition': 'unknown',
  'not-found': 'unavailable',
};

function firebaseCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code !== 'string') return undefined;
  // Firebase namespaces codes (`firestore/permission-denied`).
  return code.includes('/') ? code.split('/').pop() : code;
}

/** The most useful raw string we can extract, for logging only. */
export function themePurchaseTechnicalDetail(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Classify a failed theme purchase into a reason + the copy to show.
 *
 * A `ThemePurchaseError` carries its own reason and always wins; the
 * `more points` message check is a bridge for a plain `Error` raised by an
 * older cached bundle (the SW can serve a previous deploy).
 */
export function classifyThemePurchaseFailure(error: unknown): {
  readonly kind: ThemePurchaseFailure;
  readonly message: string;
  readonly technical: string;
} {
  const technical = themePurchaseTechnicalDetail(error);

  if (error instanceof ThemePurchaseError) {
    return {
      kind: error.kind,
      // The shortfall message ("You need 13 more points to buy this theme.")
      // is dynamic and already child-ready, so it is passed through.
      message: error.kind === 'insufficient-points'
        ? error.message
        : THEME_FAILURE_COPY[error.kind],
      technical,
    };
  }

  if (error instanceof Error && /more points/i.test(error.message)) {
    return { kind: 'insufficient-points', message: error.message, technical };
  }

  const kind = THEME_FAILURE_CODE_KINDS[firebaseCode(error) ?? ''] ?? 'unknown';
  return { kind, message: THEME_FAILURE_COPY[kind], technical };
}

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

  // A theme purchase refusal carries its own reason; its copy is centralised
  // above so the shop never string-matches an error message.
  if (error instanceof ThemePurchaseError) {
    return classifyThemePurchaseFailure(error).message;
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
