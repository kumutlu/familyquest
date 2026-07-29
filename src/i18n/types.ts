import 'i18next';
import type enCommon from './locales/en/common.json';
import type enAuth from './locales/en/auth.json';
import type enFamily from './locales/en/family.json';
import type enTasks from './locales/en/tasks.json';
import type enWallet from './locales/en/wallet.json';
import type enGoals from './locales/en/goals.json';
import type enRewards from './locales/en/rewards.json';
import type enDashboard from './locales/en/dashboard.json';
import type enApprovals from './locales/en/approvals.json';
import type enSettings from './locales/en/settings.json';
import type enNotifications from './locales/en/notifications.json';
import type enErrors from './locales/en/errors.json';
import type enBehaviour from './locales/en/behaviour.json';
import type enProfile from './locales/en/profile.json';
import type enFunds from './locales/en/funds.json';
import type enRequests from './locales/en/requests.json';
import type enReversals from './locales/en/reversals.json';
import type enBulletin from './locales/en/bulletin.json';

/**
 * Strongly-typed resource shape, keyed by NAMESPACE (not language). `en` is the
 * source of truth for key names; `tr` is typed with the same shape so
 * `t('namespace:key')` is checked against real keys for both languages. When
 * Turkish strings diverge, update the corresponding `tr` entry below to its own
 * `typeof` import.
 */
interface Resources {
  common: typeof enCommon;
  auth: typeof enAuth;
  family: typeof enFamily;
  tasks: typeof enTasks;
  wallet: typeof enWallet;
  goals: typeof enGoals;
  rewards: typeof enRewards;
  dashboard: typeof enDashboard;
  approvals: typeof enApprovals;
  settings: typeof enSettings;
  notifications: typeof enNotifications;
  errors: typeof enErrors;
  behaviour: typeof enBehaviour;
  profile: typeof enProfile;
  funds: typeof enFunds;
  requests: typeof enRequests;
  reversals: typeof enReversals;
  bulletin: typeof enBulletin;
}

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: Resources;
  }
}
