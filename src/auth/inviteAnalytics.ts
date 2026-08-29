import { FAMILYQUEST_BUILD } from '../buildInfo';

export const INVITE_EVENT_NAMES = [
  'invitation_created',
  'invitation_preview_failed',
  'invitation_accepted',
  'invitation_conflict',
  'invitation_expired',
  'invite_auth_resumed',
  'no_family_choice_rendered',
  'family_creation_explicitly_started',
] as const;

export type InviteEventName = (typeof INVITE_EVENT_NAMES)[number];
export type InviteEventFields = Record<string, unknown> & {
  authProvider?: unknown;
  role?: unknown;
  outcome?: unknown;
  buildSha?: unknown;
  source?: unknown;
};

type EventLogger = { info: (...args: unknown[]) => void };
const AUTH_PROVIDERS = new Set(['google', 'email', 'password', 'redirect', 'popup', 'unknown']);
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
const SOURCES = new Set(['adult_invite', 'no_family_choice', 'onboarding']);

function isInviteEventName(value: string): value is InviteEventName {
  return (INVITE_EVENT_NAMES as readonly string[]).includes(value);
}

/** Records only categorical invite telemetry. Input is untrusted. */
export function recordInviteEvent(
  name: InviteEventName,
  fields: InviteEventFields = {},
  logger: EventLogger = console,
): void {
  if (!isInviteEventName(name)) return;
  const event: Record<string, string> = { eventName: name };
  if (typeof fields.authProvider === 'string' && AUTH_PROVIDERS.has(fields.authProvider)) {
    event.authProvider = fields.authProvider;
  }
  if (typeof fields.role === 'string' && ROLES.has(fields.role)) event.role = fields.role;
  if (typeof fields.outcome === 'string' && OUTCOMES.has(fields.outcome)) event.outcome = fields.outcome;
  if (typeof fields.source === 'string' && SOURCES.has(fields.source)) event.source = fields.source;
  const buildSha = fields.buildSha === undefined ? FAMILYQUEST_BUILD.sha : fields.buildSha;
  if (typeof buildSha === 'string' && /^[a-f0-9]{7,64}$/.test(buildSha)) event.buildSha = buildSha;
  logger.info('invite_event', event);
}
