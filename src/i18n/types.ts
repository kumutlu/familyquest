import 'i18next';
import type enCommon from './locales/en/common.json';
import type enAuth from './locales/en/auth.json';
import type enFamily from './locales/en/family.json';
import type enTasks from './locales/en/tasks.json';
import type enWallet from './locales/en/wallet.json';
import type enGoals from './locales/en/goals.json';
import type enRewards from './locales/en/rewards.json';
import type enDashboard from './locales/en/dashboard.json';
import type enSettings from './locales/en/settings.json';
import type enNotifications from './locales/en/notifications.json';
import type enErrors from './locales/en/errors.json';

/**
 * Strongly-typed resource shape. `en` is the source of truth; `tr` is typed
 * with the same shape so `t('namespace:key')` is checked against real keys for
 * both languages. When Turkish strings diverge, update the corresponding
 * `tr` entry below to its own `typeof` import.
 */
interface Resources {
  en: {
    common: typeof enCommon;
    auth: typeof enAuth;
    family: typeof enFamily;
    tasks: typeof enTasks;
    wallet: typeof enWallet;
    goals: typeof enGoals;
    rewards: typeof enRewards;
    dashboard: typeof enDashboard;
    settings: typeof enSettings;
    notifications: typeof enNotifications;
    errors: typeof enErrors;
  };
  tr: {
    common: typeof enCommon;
    auth: typeof enAuth;
    family: typeof enFamily;
    tasks: typeof enTasks;
    wallet: typeof enWallet;
    goals: typeof enGoals;
    rewards: typeof enRewards;
    dashboard: typeof enDashboard;
    settings: typeof enSettings;
    notifications: typeof enNotifications;
    errors: typeof enErrors;
  };
}

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: Resources;
  }
}
