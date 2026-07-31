import type { HelpArticle } from '../../types';
import { faq, info, p, section, soon, steps, tip, ul } from './_shared';

export const faqArticle: HelpArticle = {
  id: 'faq',
  title: 'Frequently asked questions',
  description: 'Short answers to the questions most new families ask in their first fortnight.',
  category: 'support',
  keywords: ['faq', 'questions', 'answers', 'common', 'help', 'quick answers'],
  readingTimeMinutes: 5,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  popular: true,
  sections: [
    section('what', [
      p('A quick-answer page. If your question needs more than a paragraph, the answer links you to the full article.'),
    ]),
    section('why', [
      p('Most questions repeat. Answering them in one place is faster than reading five feature articles.'),
    ]),
    section('who', [p('Parents and children alike.')]),
    section('how', [
      faq([
        {
          q: 'What is the difference between points and money?',
          a: 'Points are earned from tasks and positive behaviours and are spent on rewards. Money is a real balance in a child’s wallet, added by a parent. They are separate — points never convert into money automatically.',
        },
        {
          q: 'Why haven’t my points arrived?',
          a: 'The task probably requires parent approval. It stays as “Waiting for Approval” until a parent approves it in the Approval Center.',
        },
        {
          q: 'Can a child send money to a parent?',
          a: 'No. Transfers are between children in the same family. A child can, however, request money from a parent.',
        },
        {
          q: 'Why did my balance not change after sending money?',
          a: 'That is deliberate. Your balance stays the same until a parent approves the transfer.',
        },
        {
          q: 'Can two parents use the app?',
          a: 'Yes. The second parent signs up and enters the family invite code. Both parents have the same rights.',
        },
        {
          q: 'How do I add another child?',
          a: 'Share the invite code so they can sign up with it, or add them from the Family page as a managed child.',
        },
        {
          q: 'Does Queki pay allowance automatically?',
          a: 'Not yet. Today a parent adds the money manually and writes “Allowance” in the note so it is categorised correctly.',
        },
        {
          q: 'Is my money really in Queki?',
          a: 'No. Queki records the balances your family agrees on. It is not a bank and does not move real funds.',
        },
        {
          q: 'Can I change the app language?',
          a: 'Yes — Settings → Language. English and Turkish are supported and the change applies everywhere, including this Help Center.',
        },
        {
          q: 'How do I undo a reward redemption?',
          a: 'There is no self-service undo. A parent can compensate with a positive behaviour entry or a wallet adjustment.',
        },
        {
          q: 'Does Queki work offline?',
          a: 'No. It needs a connection to keep every family member’s view in sync.',
        },
        {
          q: 'Is there an app to download?',
          a: 'Queki is a web app you can install to your home screen from your browser’s share or menu button.',
        },
      ]),
    ]),
    section('steps', [
      steps([
        { title: 'Search first', detail: 'The Help Center search covers titles, keywords, and article text.' },
        { title: 'Use the ? button', detail: 'Every major page opens its own article.' },
        { title: 'Still stuck?', detail: 'Read Troubleshooting for fixes to specific problems.' },
      ]),
    ]),
    section('tips', [
      tip('Read the Parent guide and Child guide together in week one. Most confusion comes from the two roles expecting different things.'),
    ]),
    section('mistakes', [
      ul([
        'Assuming points and money are the same currency.',
        'Expecting anything money-related to happen without a parent approving it.',
      ]),
    ]),
  ],
  related: ['troubleshooting', 'welcome', 'parent-guide', 'child-guide'],
};

export const troubleshooting: HelpArticle = {
  id: 'troubleshooting',
  title: 'Troubleshooting',
  description:
    'Fixes for the problems families actually hit: missing points, stuck transfers, sign-in trouble, and notifications that never arrive.',
  category: 'support',
  keywords: [
    'troubleshooting',
    'problem',
    'error',
    'not working',
    'stuck',
    'missing',
    'fix',
    'bug',
    'cannot sign in',
  ],
  readingTimeMinutes: 6,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  sections: [
    section('what', [
      p('A symptom-by-symptom list of what to check when something in Queki is not behaving as expected.'),
    ]),
    section('why', [
      p(
        'Almost every report turns out to be one of a handful of causes: something waiting for approval, someone in the wrong family, or a stale browser tab. Checking those first saves a lot of time.'
      ),
    ]),
    section('who', [p('Anyone. Some fixes need a parent, and each one says so.')]),
    section('how', [
      p('Points did not arrive after completing a task:'),
      ul([
        'The task requires approval and is still pending — check the Approval Center.',
        'The task was rejected. Ask the parent who reviewed it.',
        'The task was not scheduled for today, so it could not be completed.',
      ]),
      p('A transfer is stuck as pending:'),
      ul([
        'It is waiting for a parent. Pending transfers never expire on their own.',
        'A request to a sibling needs the sibling to accept before a parent can approve it.',
        'Do not send a second transfer — cancel the confusion by asking the parent to decide.',
      ]),
      p('A family member cannot see the family data:'),
      ul([
        'They signed up without the invite code and are in their own empty family.',
        'A parent should remove that account and re-invite them with the code.',
      ]),
      p('Push notifications never arrive:'),
      ul([
        'Check Settings → Notifications for “Blocked in browser settings”.',
        'Enable notifications for the site in the browser or device settings, then return and enable again.',
        'Some browsers do not support push at all; the status will say so.',
        'Push is registered per device — enabling it on a laptop does nothing for a phone.',
      ]),
      p('Balances or lists look out of date:'),
      ul([
        'Reload the page. A tab left open for days can hold a stale session.',
        'Check the notification centre status; if it is stuck connecting, use Retry connection.',
        'Confirm the device is online.',
      ]),
      p('Cannot sign in:'),
      ul([
        'Use the password reset email rather than guessing.',
        'If you originally signed in with Google, use Google again — there is no separate Queki password.',
        'Confirm you are using the same email address you signed up with.',
      ]),
      info('An app update may be waiting. Closing and reopening the app applies the newest version.'),
    ]),
    section('steps', [
      p('When something is wrong, work down this list:'),
      steps([
        { title: 'Reload the app', detail: 'It resolves stale data more often than anything else.' },
        { title: 'Check the Approval Center', detail: 'Most “missing” points and money are simply pending.' },
        { title: 'Confirm the family', detail: 'Settings → Family should show the same family name for everyone.' },
        { title: 'Check the date and schedule', detail: 'Tasks only appear on the days they are scheduled for.' },
        { title: 'Sign out and back in', detail: 'This refreshes your session cleanly.' },
        { title: 'Note what you did', detail: 'Exact steps and the time make any problem far easier to diagnose.' },
      ]),
    ]),
    section('tips', [
      tip('Check the app version under Settings → About before reporting anything, so you know which build you are on.'),
    ]),
    section('mistakes', [
      ul([
        'Deleting an account or a family to fix a display problem.',
        'Repeating an action that appeared to fail, creating duplicate requests.',
        'Assuming a rejected item was a bug. Rejections are silent about the reason — ask the parent.',
      ]),
      soon('An in-app way to contact support and attach diagnostics.'),
    ]),
  ],
  related: ['faq', 'account-security', 'notifications', 'approval-center'],
};

export default [faqArticle, troubleshooting];
