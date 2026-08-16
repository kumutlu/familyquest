import type { HelpArticle } from '../../types';
import { info, p, section, soon, steps, tip, ul, warn } from './_shared';

export const accountSecurity: HelpArticle = {
  id: 'account-security',
  title: 'Account & security',
  description:
    'Sign-in methods, changing your password, language, signing out, and deleting your account or family.',
  category: 'account',
  keywords: [
    'account',
    'security',
    'password',
    'sign in',
    'sign out',
    'google',
    'delete account',
    'privacy',
    'language',
    'settings',
  ],
  readingTimeMinutes: 5,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  sections: [
    section('what', [
      p(
        'Everything about your access to Queki, all on the Settings page: your profile, the family’s details, language, security, and account deletion.'
      ),
    ]),
    section('why', [
      p(
        'The app holds your children’s names, avatars, and money records. Access controls and a real deletion path are not optional extras for that kind of data.'
      ),
    ]),
    section('who', [
      p(
        'Everyone manages their own account. Children cannot delete their own account when it is managed by a parent — a parent archives them from Family Settings instead, or permanently deletes the managed child through the Danger Zone.'
      ),
    ]),
    section('how', [
      p('Settings groups the controls:'),
      ul([
        'Profile — your name and avatar. For children, changes need parent approval.',
        'Family — family name, member count, and the invite code.',
        'Language — English or Turkish, applied across the whole app.',
        'Security — password reset by email, and Sign Out.',
        'Delete account — a multi-step, irreversible flow.',
        'About — app version, build, and links to the Privacy Policy and Terms.',
      ]),
      p(
        'If you sign in with Google, there is no password to change inside Queki — manage it in your Google account. Password reset sends a secure link to your email address.'
      ),
      warn(
        'Deleting your account erases your profile, your family membership, and your sign-in credentials, and it cannot be undone. If you are the only owner and there is nobody to hand ownership to, deleting your account deletes the whole family and all of its data.'
      ),
    ]),
    section('steps', [
      p('Change your password:'),
      steps([
        { title: 'Open Settings → Security', detail: 'Find “Change password”.' },
        { title: 'Send the reset email', detail: 'It goes to the address on your account.' },
        { title: 'Follow the link', detail: 'Set the new password, then sign in again.' },
      ]),
      p('Delete your account: Settings → Delete account, then work through the warnings. As the owner you must either nominate another parent as the new owner, or confirm the family deletion by typing the family name. You may be asked to confirm your password first.'),
    ]),
    section('tips', [
      tip('Two parents on the account means one of you can always take ownership if the other leaves.'),
      p('Signing out is not deleting. If you just want off this device, use Sign Out.'),
    ]),
    section('mistakes', [
      ul([
        'Deleting an account to fix a login problem. Try a password reset first.',
        'A child signing up again instead of using the invite code, creating a second, empty family.',
        'Assuming an account deletion is reversible. It is not.',
      ]),
      soon('Two-factor authentication and per-device session management.'),
    ]),
  ],
  related: ['family-management', 'notifications', 'troubleshooting', 'getting-started'],
};

export const notifications: HelpArticle = {
  id: 'notifications',
  title: 'Notifications',
  description:
    'In-app notifications, the notification centre, and enabling push notifications on a device.',
  category: 'account',
  keywords: [
    'notifications',
    'alerts',
    'push',
    'notification center',
    'blocked',
    'permission',
    'reminders',
  ],
  readingTimeMinutes: 4,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  sections: [
    section('what', [
      p(
        'Queki tells you when something happens: a task needs approving, money arrived, a transfer was approved, a behaviour was logged. These appear in the in-app notification centre, and optionally as push notifications on your device.'
      ),
    ]),
    section('why', [
      p(
        'The whole approve-and-earn loop depends on somebody noticing. Notifications are what keep a child’s completed task from sitting unapproved for three days.'
      ),
    ]),
    section('who', [
      p(
        'Everyone. Parents mainly receive approval requests; children receive task results, wallet changes, transfers, and behaviour updates.'
      ),
    ]),
    section('how', [
      p('Notification categories currently delivered in-app are:'),
      ul([
        'Task updates',
        'Reward requests',
        'Wallet updates',
        'Transfer updates',
        'Behaviour updates',
        'Pet Box updates',
      ]),
      p(
        'Push notifications are per device and off until you enable them. Settings shows the current state: enabled on this device, not enabled, blocked in browser settings, or not supported on this browser.'
      ),
      info(
        'The notification centre is realtime and shows a connection status. If it says “Connecting…” for a long time, use Retry connection.'
      ),
      soon('Per-category notification preferences — today the categories are informational and cannot be switched off individually.'),
    ]),
    section('steps', [
      steps([
        { title: 'Open Settings → Notifications', detail: 'Check the push notification status.' },
        { title: 'Tap “Enable push notifications”', detail: 'Your browser will ask for permission.' },
        { title: 'Allow the permission prompt', detail: 'If you dismiss it, the status shows Blocked.' },
        { title: 'If blocked, fix it in the browser', detail: 'Enable notifications for the site, then return.' },
        { title: 'Repeat on each device', detail: 'Push is registered per device, not per account.' },
      ]),
    ]),
    section('tips', [
      tip('Install Queki to your home screen before enabling push. Mobile browsers are far more reliable that way.'),
      p('Parents: enabling push on one device you actually carry beats enabling it everywhere.'),
    ]),
    section('mistakes', [
      ul([
        'Blocking the permission prompt by accident, then assuming push is broken.',
        'Enabling push on a shared computer and receiving family notifications in front of others.',
        'Waiting for an email. Queki does not send activity emails.',
      ]),
    ]),
  ],
  related: ['account-security', 'approval-center', 'dashboard', 'troubleshooting'],
};

export default [accountSecurity, notifications];
