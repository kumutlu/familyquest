import type { HelpArticle } from '../../types';
import { info, p, section, soon, steps, tip, ul } from './_shared';

export const parentGuide: HelpArticle = {
  id: 'parent-guide',
  title: 'Parent guide',
  description:
    'Everything a parent can do: create tasks and rewards, log behaviours, approve requests, and manage wallets.',
  category: 'roles',
  keywords: ['parent', 'adult', 'admin', 'permissions', 'approve', 'manage', 'owner'],
  readingTimeMinutes: 6,
  updatedAt: '2026-07-31',
  audience: ['parent'],
  popular: true,
  gettingStartedOrder: 3,
  sections: [
    section('what', [
      p(
        'The parent role is the administrative side of Queki. Parents define what earns points, what points buy, and how real money moves. Nothing that changes a balance happens without a parent.'
      ),
    ]),
    section('why', [
      p(
        'Children need autonomy inside safe limits. Giving parents create-and-approve rights means a child can act freely — request, complete, spend — while the family keeps a final check on anything with consequences.'
      ),
    ]),
    section('who', [
      p(
        'Any adult member of the family. The parent who created the family is additionally the owner, which matters only when deleting an account: the owner must hand ownership to another parent first.'
      ),
    ]),
    section('how', [
      p('Parents have these powers that children do not:'),
      ul([
        'Create, edit, and archive tasks and rewards.',
        'Log behaviour events — positive points, negative points, or a money penalty.',
        'Add money to, and withdraw money from, any child wallet.',
        'Approve or reject everything in the Approval Center.',
        'Publish announcements to the Family Bulletin.',
        'Add pets and record Pet Box expenses.',
        'Add and remove family members.',
      ]),
      info(
        'Parents see the same four tabs as children. The extra tools appear inside those pages — for example the Approval Center sits on the parent dashboard, and “Manage Wallet” appears on the Child Wallets screen.'
      ),
    ]),
    section('steps', [
      p('A typical parent week:'),
      steps([
        { title: 'Monday: check the board', detail: 'Open Home and glance at each child’s progress.' },
        {
          title: 'Daily: clear approvals',
          detail: 'The Approval Center shows completed tasks and money requests waiting on you.',
        },
        {
          title: 'As it happens: log behaviours',
          detail: 'Record the unusually helpful or the genuinely unacceptable while it is fresh.',
        },
        {
          title: 'Payday: top up wallets',
          detail: 'Family → child → Manage Wallet → Add Money.',
        },
        {
          title: 'Sunday: adjust',
          detail: 'Archive tasks nobody does; reprice rewards nobody can afford.',
        },
      ]),
    ]),
    section('tips', [
      tip('Approve in one sitting rather than all day. Children learn the rhythm and stop asking.'),
      p('Use archive, not delete. Archiving keeps the history intact so past points still make sense.'),
      p('Two parents should agree on penalty sizes before using them; inconsistency is what children notice.'),
    ]),
    section('mistakes', [
      ul([
        'Leaving approvals for days — children stop trusting that effort pays.',
        'Using money penalties for small things, which turns the wallet into a punishment tool.',
        'Editing a task’s point value mid-week without telling anyone.',
      ]),
      soon('Per-parent permission levels. Today every parent has the same rights.'),
    ]),
  ],
  related: ['approval-center', 'tasks', 'behaviours', 'wallet'],
};

export const childGuide: HelpArticle = {
  id: 'child-guide',
  title: 'Child guide',
  description:
    'How to earn points, spend them on rewards, use your wallet, and ask a parent for money.',
  category: 'roles',
  keywords: ['child', 'kid', 'points', 'earn', 'spend', 'my wallet', 'level', 'streak'],
  readingTimeMinutes: 4,
  updatedAt: '2026-07-31',
  audience: ['child'],
  popular: true,
  gettingStartedOrder: 4,
  sections: [
    section('what', [
      p(
        'Your side of Queki: a list of tasks to do, points you collect for doing them, rewards you can buy with those points, and a wallet with your real money in it.'
      ),
    ]),
    section('why', [
      p(
        'It makes the deal clear. You can see exactly what a job is worth before you do it, and you can see your balance without asking anyone.'
      ),
    ]),
    section('who', [
      p(
        'Every child in the family has their own account and their own points, wallet, and goals. Some tasks are assigned to you; others are shared and anyone can take them.'
      ),
    ]),
    section('how', [
      p(
        'You mark a task done. If it needs approval it says “Waiting for approval” until a parent taps Approve — then the points land. Points buy rewards. Money in your wallet is separate from points, and moving money always needs a parent to say yes.'
      ),
      info('Points are for rewards. Money in your wallet is real money your parents added.'),
    ]),
    section('steps', [
      steps([
        { title: 'Open Tasks', detail: 'Use the filters to see what is due today.' },
        { title: 'Do the job, then tap the task', detail: 'Choose “Mark as Done”.' },
        { title: 'Wait if it says so', detail: '“Waiting for Approval” means a parent must confirm it.' },
        { title: 'Check your points on Home', detail: 'Your level and streak update as you go.' },
        { title: 'Spend on Rewards', detail: 'Open Rewards, pick something you can afford, tap Redeem.' },
        {
          title: 'Need money instead?',
          detail: 'Open your wallet and use Request Money to ask a parent or a sibling.',
        },
      ]),
    ]),
    section('tips', [
      tip('Daily tasks are worth fewer points but add up faster than the big one-off jobs.'),
      p('Saving for something big? Create a savings goal so the money is set aside and harder to spend.'),
    ]),
    section('mistakes', [
      ul([
        'Marking a task done before actually finishing it — a parent can reject it.',
        'Expecting a transfer to arrive instantly. Money you send stays in your balance until a parent approves.',
        'Redeeming a reward by accident. Ask a parent to sort it out; there is no self-service undo.',
      ]),
    ]),
  ],
  related: ['tasks', 'rewards', 'wallet', 'savings-goals'],
};

export default [parentGuide, childGuide];
