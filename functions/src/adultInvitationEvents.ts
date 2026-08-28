/**
 * The invitation telemetry boundary.  Keep this module deliberately boring:
 * callers may pass an error or a callable payload, but only the fields below
 * can cross into logs.  In particular, do not spread a caller-owned object.
 */

export const ADULT_INVITATION_EVENT_NAMES = [
  'invitation_created',
  'invitation_preview_failed',
  'invitation_accepted',
  'invitation_conflict',
  'invitation_expired',
  'invite_auth_resumed',
  'no_family_choice_rendered',
  'family_creation_explicitly_started',
] as const;

export type AdultInvitationEventName = (typeof ADULT_INVITATION_EVENT_NAMES)[number];
export type AdultInvitationEventFields = Record<string, unknown> & {
  version?: unknown;
  intendedRole?: unknown;
  outcome?: unknown;
  latencyBucket?: unknown;
  buildSha?: unknown;
  correlationId?: unknown;
};

type EventLogger = { info: (...args: unknown[]) => void };

const ROLES = new Set(['parent', 'adult']);
const OUTCOMES = new Set([
  'success',
  'invalid_invitation',
  'expired',
  'revoked',
  'already_used',
  'conflict',
  'rate_limited',
  'family_unavailable',
  'profile_required',
  'cancelled',
  'error',
]);
const LATENCY_BUCKETS = new Set([
  'lt_100ms',
  '100_500ms',
  '500_1000ms',
  'gte_1000ms',
  'fast',
  'medium',
  'slow',
]);

function safeString(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

function isAdultInvitationEventName(value: string): value is AdultInvitationEventName {
  return (ADULT_INVITATION_EVENT_NAMES as readonly string[]).includes(value);
}

/**
 * Writes a structured, PII-free event. The optional logger exists for unit
 * tests and for function hosts that provide a structured logger.
 */
export function recordAdultInvitationEvent(
  eventName: AdultInvitationEventName,
  fields: AdultInvitationEventFields = {},
  logger: EventLogger = console,
): void {
  if (!isAdultInvitationEventName(eventName)) return;

  const event: Record<string, string | number> = { eventName };
  if (fields.version === 2) event.version = 2;
  if (typeof fields.intendedRole === 'string' && ROLES.has(fields.intendedRole)) {
    event.intendedRole = fields.intendedRole;
  }
  if (typeof fields.outcome === 'string' && OUTCOMES.has(fields.outcome)) {
    event.outcome = fields.outcome;
  }
  if (typeof fields.latencyBucket === 'string' && LATENCY_BUCKETS.has(fields.latencyBucket)) {
    event.latencyBucket = fields.latencyBucket;
  }
  const buildSha = safeString(fields.buildSha, /^[a-f0-9]{7,64}$/);
  if (buildSha) event.buildSha = buildSha;
  // Correlation IDs must look generated. This prevents a UID or another
  // caller-controlled identifier from being smuggled into telemetry.
  const correlationId = safeString(
    fields.correlationId,
    /^(?:[a-f0-9]{16,64}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
  );
  if (correlationId) event.correlationId = correlationId;

  logger.info('adult_invitation_event', event);
}
