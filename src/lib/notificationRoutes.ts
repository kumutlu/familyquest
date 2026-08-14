import type { NotificationType } from './notifications';

// ---------------------------------------------------------------------------
// CENTRAL NOTIFICATION ROUTE MAPPING
// ---------------------------------------------------------------------------
//
// Previously the navigation target for a notification was scattered as a string
// literal inside every api.ts call site (the `actionUrl` field written at
// creation time). That made route changes error-prone and allowed stale routes
// from older navigation structures to persist in production records.
//
// This module is now the single source of truth. `getNotificationRoute` is the
// only place that decides where a notification row navigates. Every known
// notification type maps to a valid current route.
//
// Approval-related types point at the parent dashboard ("/") which renders the
// Approval Center. If the app cannot scroll directly to the Approval Center it
// still lands on a valid, safe route. Behaviour notifications carry the
// specific member profile in `actionUrl` (e.g. "/family/<childId>"); the static
// fallback is the dashboard.
export const NOTIFICATION_ROUTES: Partial<Record<NotificationType, string>> = {
  task_submitted: '/',
  reward_requested: '/',
  transfer_requested: '/',
  task_approved: '/tasks',
  task_rejected: '/tasks',
  wallet_deposit: '/wallet',
  wallet_withdrawal: '/wallet',
  transfer_approved: '/wallet',
  transfer_rejected: '/wallet',
  petbox_contribution: '/pet-box',
  petbox_expense: '/pet-box',
  profile_update_requested: '/',
  profile_update_approved: '/',
  profile_update_rejected: '/',
  // A newly created goal lands on the Goals page (the app also supports the
  // deep-link destination /goals/:goalId, but the central route keeps the
  // navigation stable and always valid).
  goal_created: '/goals',
  // Behaviour notifications prefer the member-profile `actionUrl` (see resolver).
  behaviour_positive: '/',
  behaviour_negative: '/',
};

function isSafePath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && value.length > 1;
}

/**
 * Resolves the navigation target for a notification row.
 *
 * 1. Behaviour types prefer the member-profile `actionUrl` when present.
 * 2. Known types use the central static mapping.
 * 3. Unknown types fall back to the stored `actionUrl` when it is a valid path.
 * 4. Anything else falls back to the home route so a click never crashes.
 */
export function getNotificationRoute(
  type: NotificationType | string | undefined,
  actionUrl?: string,
  petBoxEnabled = true,
): string {
  if (!petBoxEnabled && (type === 'petbox_contribution' || type === 'petbox_expense')) {
    return '/';
  }
  if (
    (type === 'behaviour_positive' || type === 'behaviour_negative') &&
    isSafePath(actionUrl)
  ) {
    return actionUrl;
  }
  if (type && type in NOTIFICATION_ROUTES) {
    return NOTIFICATION_ROUTES[type as NotificationType] as string;
  }
  if (isSafePath(actionUrl)) return actionUrl;
  return '/';
}

/** Returns true when the given type is one of the known notification types. */
export function isKnownNotificationType(type: unknown): type is NotificationType {
  return typeof type === 'string' && type in NOTIFICATION_ROUTES;
}
