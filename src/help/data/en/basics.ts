import type { HelpArticle } from '../../types';
import { info, p, section, soon, steps, tip, ul } from './_shared';

export const welcome: HelpArticle = {
  id: 'welcome',
  title: 'Welcome to Queki',
  description:
    'A one-page tour of what Queki does: tasks, points, rewards, wallets, and a shared family view.',
  category: 'basics',
  keywords: ['welcome', 'intro', 'overview', 'about', 'tour', 'what is queki', 'start'],
  readingTimeMinutes: 3,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  popular: true,
  gettingStartedOrder: 1,
  sections: [
    section('what', [
      p(
        'Queki is a shared app for one family. Parents set up tasks, behaviours, rewards, and money; children complete tasks, earn points, and spend or save what they earn. Everyone signs in to the same family and sees the parts that belong to them.'
      ),
      ul([
        'Tasks — chores and routines that pay out points.',
        'Behaviours — one-off positive or negative events logged by a parent.',
        'Rewards — a catalogue children buy with the points they earned.',
        'Wallets — real money balances for each child, managed by parents.',
        'Savings goals, the Pet Box, and the Family Bulletin — shared, family-level features.',
      ]),
    ]),
    section('why', [
      p(
        'Pocket money conversations usually happen in fragments: a reminder here, a promise there, cash in a drawer. Queki puts the agreement in one place, so effort and payout are visible to everybody and nothing depends on memory.'
      ),
    ]),
    section('who', [
      p(
        'Everyone in the family. Parents get the setup and approval tools; children get their own view with tasks, points, wallet, and goals. Both roles use exactly the same four tabs: Home, Tasks, Rewards, and Family.'
      ),
    ]),
    section('how', [
      p(
        'One adult creates the family and gets an invite code. Other parents and children join with that code. From then on, everything belongs to the family: tasks, rewards, balances, and history are shared, and parents approve anything that moves points or money.'
      ),
      info(
        'Queki is a web app that installs to your home screen. There is no separate download to manage, and every device shows the same live data.'
      ),
    ]),
    section('steps', [
      steps([
        { title: 'Create your family', detail: 'Sign up as a parent and name the family.' },
        { title: 'Invite everyone', detail: 'Share the invite code from Settings → Family.' },
        { title: 'Add a few tasks', detail: 'Three or four is plenty for week one.' },
        { title: 'Add two rewards', detail: 'One cheap, one aspirational.' },
        { title: 'Run one week', detail: 'Approve completions and see what sticks.' },
      ]),
    ]),
    section('tips', [
      tip('Start smaller than feels right. Families that add 20 tasks on day one abandon them by day four.'),
      p('Agree on the points-to-money ratio out loud before you add rewards. It prevents arguments later.'),
    ]),
    section('mistakes', [
      ul([
        'Creating a second family by signing up twice instead of joining with the invite code.',
        'Setting every task to “Requires parent approval”, which turns the app into a queue of chores for you.',
        'Adding rewards nobody wants, then wondering why points are never spent.',
      ]),
      soon('A guided in-app setup wizard that creates a starter task and reward set for you.'),
    ]),
  ],
  related: ['getting-started', 'parent-guide', 'child-guide', 'dashboard'],
};

export const gettingStarted: HelpArticle = {
  id: 'getting-started',
  title: 'Getting started',
  description:
    'Create your family, invite parents and children, and get through your first week without confusion.',
  category: 'basics',
  keywords: [
    'setup',
    'sign up',
    'signup',
    'invite code',
    'join family',
    'onboarding',
    'first week',
    'create family',
  ],
  readingTimeMinutes: 5,
  updatedAt: '2026-07-31',
  audience: ['parent'],
  popular: true,
  gettingStartedOrder: 2,
  sections: [
    section('what', [
      p(
        'The setup path that takes you from an empty account to a working family: one parent signs up, names the family, and invites everybody else with a single code.'
      ),
    ]),
    section('why', [
      p(
        'Everything in Queki hangs off the family record — tasks, wallets, approvals, and history. If members end up in different families they cannot see each other’s data, so getting this step right matters more than any other.'
      ),
    ]),
    section('who', [
      p(
        'The first parent to sign up creates the family and becomes its owner. Any other adult can join as a parent. Children either join with their own sign-in or are created and managed by a parent.'
      ),
    ]),
    section('how', [
      p(
        'Signing up creates your account, then onboarding creates the family and puts you in it. Settings → Family shows the invite code; anyone who enters it during signup joins your existing family instead of starting a new one.'
      ),
      info(
        'A person belongs to exactly one family. If someone signs up without the code, they must be removed and re-invited — there is no “move to another family” action.'
      ),
    ]),
    section('steps', [
      steps([
        {
          title: 'Sign up',
          detail: 'Use email and password or Google sign-in on the signup screen.',
        },
        {
          title: 'Complete onboarding',
          detail: 'Give the family a name and set the currency your family uses.',
        },
        {
          title: 'Copy the invite code',
          detail: 'Settings → Family → Invite code has a copy button.',
        },
        {
          title: 'Invite the second parent',
          detail: 'They sign up and enter the code so they land in your family.',
        },
        {
          title: 'Add your children',
          detail: 'Add them from the Family page, or have them sign up with the invite code.',
        },
        {
          title: 'Create three tasks and two rewards',
          detail: 'Use the templates in the task and reward forms to move quickly.',
        },
        {
          title: 'Explain the loop to your children',
          detail: 'Do a task → mark it done → a parent approves → points arrive → spend on a reward.',
        },
      ]),
    ]),
    section('tips', [
      tip('Do the first week with approval switched on for everything, then relax it for tasks you trust.'),
      p('Set the family currency during onboarding. Every amount in the app is displayed in it.'),
    ]),
    section('mistakes', [
      ul([
        'A second parent signing up without the invite code — they end up alone in an empty family.',
        'Forgetting to tell children that completed tasks need approval before points arrive.',
        'Pricing rewards before you know how many points a week a child can realistically earn.',
      ]),
      info(
        'Regenerating the invite code is not available yet, so treat the code as semi-permanent and share it privately.'
      ),
    ]),
  ],
  related: ['welcome', 'parent-guide', 'family-management', 'tasks'],
};

export default [welcome, gettingStarted];
