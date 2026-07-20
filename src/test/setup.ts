import '@testing-library/jest-dom/vitest'
import i18n from '../i18n/config';
import enCommon from '../i18n/locales/en/common.json';
import trCommon from '../i18n/locales/tr/common.json';
import enDashboard from '../i18n/locales/en/dashboard.json';
import trDashboard from '../i18n/locales/tr/dashboard.json';
import enFamily from '../i18n/locales/en/family.json';
import trFamily from '../i18n/locales/tr/family.json';
import enTasks from '../i18n/locales/en/tasks.json';
import trTasks from '../i18n/locales/tr/tasks.json';
import enRewards from '../i18n/locales/en/rewards.json';
import trRewards from '../i18n/locales/tr/rewards.json';
import enApprovals from '../i18n/locales/en/approvals.json';
import trApprovals from '../i18n/locales/tr/approvals.json';
import enErrors from '../i18n/locales/en/errors.json';
import trErrors from '../i18n/locales/tr/errors.json';
import enWallet from '../i18n/locales/en/wallet.json';
import trWallet from '../i18n/locales/tr/wallet.json';
import enGoals from '../i18n/locales/en/goals.json';
import trGoals from '../i18n/locales/tr/goals.json';

// Preload the UI namespaces used by the Parent Core experience so that
// components render with real translations synchronously in tests (the
// production app loads these lazily via ViteI18nBackend). This keeps tests
// deterministic without relying on async dynamic imports.
const UI_BUNDLES: Record<string, { en: unknown; tr: unknown }> = {
  common: { en: enCommon, tr: trCommon },
  dashboard: { en: enDashboard, tr: trDashboard },
  family: { en: enFamily, tr: trFamily },
  tasks: { en: enTasks, tr: trTasks },
  rewards: { en: enRewards, tr: trRewards },
  approvals: { en: enApprovals, tr: trApprovals },
  errors: { en: enErrors, tr: trErrors },
  wallet: { en: enWallet, tr: trWallet },
  goals: { en: enGoals, tr: trGoals },
};

for (const [ns, { en, tr }] of Object.entries(UI_BUNDLES)) {
  i18n.addResourceBundle('en', ns, en as object, true, true);
  i18n.addResourceBundle('tr', ns, tr as object, true, true);
}
