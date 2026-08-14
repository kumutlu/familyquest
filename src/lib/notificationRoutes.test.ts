import { describe, it, expect } from 'vitest';
import { getNotificationRoute, isKnownNotificationType, NOTIFICATION_ROUTES } from './notificationRoutes';
import type { NotificationType } from './notifications';

const ALL_TYPES: NotificationType[] = [
  'task_submitted', 'task_approved', 'task_rejected', 'reward_requested', 'reward_approved',
  'reward_rejected', 'transfer_requested', 'transfer_approved', 'transfer_rejected',
  'wallet_deposit', 'wallet_withdrawal', 'behaviour_positive', 'behaviour_negative',
  'petbox_contribution', 'petbox_expense', 'goal_created',
];

describe('getNotificationRoute', () => {
  it('maps every known notification type to a valid current route', () => {
    for (const type of ALL_TYPES) {
      const route = getNotificationRoute(type);
      expect(route.startsWith('/')).toBe(true);
    }
  });

  it('uses the central mapping for approval/result types', () => {
    expect(getNotificationRoute('task_submitted')).toBe('/');
    expect(getNotificationRoute('reward_requested')).toBe('/');
    expect(getNotificationRoute('transfer_requested')).toBe('/');
    expect(getNotificationRoute('task_approved')).toBe('/tasks');
    expect(getNotificationRoute('task_rejected')).toBe('/tasks');
    expect(getNotificationRoute('wallet_deposit')).toBe('/wallet');
    expect(getNotificationRoute('wallet_withdrawal')).toBe('/wallet');
    expect(getNotificationRoute('transfer_approved')).toBe('/wallet');
    expect(getNotificationRoute('transfer_rejected')).toBe('/wallet');
    expect(getNotificationRoute('petbox_contribution')).toBe('/pet-box');
    expect(getNotificationRoute('petbox_expense')).toBe('/pet-box');
  });

  it('prefers the member-profile actionUrl for behaviour notifications', () => {
    expect(getNotificationRoute('behaviour_positive', '/family/child-1')).toBe('/family/child-1');
    expect(getNotificationRoute('behaviour_negative', '/family/child-2')).toBe('/family/child-2');
  });

  it('falls back to the dashboard for behaviour notifications without an actionUrl', () => {
    expect(getNotificationRoute('behaviour_positive')).toBe('/');
  });

  it('falls back to the stored actionUrl for an unknown type', () => {
    expect(getNotificationRoute('future_type', '/somewhere')).toBe('/somewhere');
  });

  it('falls back to home for an unknown type with no actionUrl', () => {
    expect(getNotificationRoute('future_type')).toBe('/');
    expect(getNotificationRoute(undefined)).toBe('/');
  });

  // reward_approved / reward_rejected are part of the type union for forward
  // compatibility but are intentionally NOT routed yet (no reward-approval
  // workflow exists). Every other known type must have a central route entry.
  const ROUTED_TYPES = ALL_TYPES.filter(t => t !== 'reward_approved' && t !== 'reward_rejected');
  it('every routed known type has a central route entry', () => {
    for (const type of ROUTED_TYPES) {
      expect(NOTIFICATION_ROUTES[type]).toBeDefined();
    }
  });
});

describe('isKnownNotificationType', () => {
  it('recognises known types and rejects unknown ones', () => {
    expect(isKnownNotificationType('task_approved')).toBe(true);
    expect(isKnownNotificationType('mystery')).toBe(false);
    expect(isKnownNotificationType(undefined)).toBe(false);
  });
});
