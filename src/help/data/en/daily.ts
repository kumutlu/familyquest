import type { HelpArticle } from '../../types';
import { info, p, section, soon, steps, tip, ul, warn } from './_shared';

export const dashboard: HelpArticle = {
  id: 'dashboard',
  title: 'Dashboard',
  description:
    'The home screen: today’s progress, points, levels, streaks, and — for parents — the approval queue.',
  category: 'daily',
  keywords: ['home', 'dashboard', 'progress', 'level', 'xp', 'streak', 'perfect day', 'today'],
  readingTimeMinutes: 4,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  popular: true,
  gettingStartedOrder: 5,
  sections: [
    section('what', [
      p(
        'Home is the first screen after signing in. Children see their own progress for today; parents see the family at a glance plus anything waiting for a decision.'
      ),
    ]),
    section('why', [
      p(
        'A family app fails when you have to hunt for the state of things. The dashboard answers “what still needs doing today?” and “what needs me?” without a single tap.'
      ),
    ]),
    section('who', [
      p('Everyone, with a different layout per role — the child dashboard and the parent dashboard.'),
    ]),
    section('how', [
      p('The child view is built from the gamification engine:'),
      ul([
        'Daily progress — how many of today’s tasks are complete.',
        'Points and XP — points earned from tasks and positive behaviours.',
        'Level — your XP total mapped onto a level.',
        'Streak — consecutive days with completed tasks.',
        'Perfect day — every task scheduled for today finished.',
      ]),
      p(
        'The parent view adds the Approval Center and a per-child summary, so you can approve and spot a child who has stalled from the same screen.'
      ),
      info('The Family Bulletin also appears here, so announcements are impossible to miss.'),
    ]),
    section('steps', [
      steps([
        { title: 'Open the app', detail: 'Home is the default tab.' },
        { title: 'Read today’s progress ring', detail: 'It only counts tasks scheduled for today.' },
        { title: 'Parents: clear the approval list', detail: 'Approve or reject each pending item.' },
        { title: 'Tap into a child', detail: 'Opens their profile with tasks, wallet, and history.' },
      ]),
    ]),
    section('tips', [
      tip('Streaks are the most motivating number on the screen for most children. Protect them: one very easy daily task keeps a streak alive on bad days.'),
      p('Install Queki to the home screen so Home is one tap away.'),
    ]),
    section('mistakes', [
      ul([
        'Assuming the progress ring includes weekly tasks. It shows today only.',
        'Waiting for a nightly summary — the dashboard is live, there is no digest email.',
      ]),
      soon('A configurable dashboard where you choose which cards appear.'),
    ]),
  ],
  related: ['tasks', 'approval-center', 'family-bulletin', 'child-guide'],
};

export const tasks: HelpArticle = {
  id: 'tasks',
  title: 'Tasks',
  description:
    'Create chores and routines, schedule them, set their point value, and decide whether they need approval.',
  category: 'daily',
  keywords: [
    'tasks',
    'chores',
    'jobs',
    'schedule',
    'daily',
    'weekly',
    'points',
    'approval',
    'recurring',
    'template',
  ],
  readingTimeMinutes: 6,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  popular: true,
  sections: [
    section('what', [
      p(
        'Tasks are the jobs that earn points. Each task has a title, an optional description, a point value, a schedule, an assignee, and an approval setting.'
      ),
    ]),
    section('why', [
      p(
        'Written-down expectations stop the daily negotiation. A task states the job and its price once, so “that’s not worth it” becomes a conversation you have when creating the task, not every evening.'
      ),
    ]),
    section('who', [
      p(
        'Parents create, edit, and archive tasks. Children complete them. A task can be assigned to one child or left as “Anyone (Shared)” so whoever gets there first can claim it.'
      ),
    ]),
    section('how', [
      p('Schedules control when a task appears:'),
      ul([
        'Daily — every day.',
        'Weekdays (Mon–Fri) or Weekends (Sat–Sun).',
        'Weekly — once a week.',
        'Custom days — pick the exact days.',
        'One-time — appears until it is done.',
      ]),
      p(
        'If “Requires Parent Approval” is on, marking the task done sets it to “Waiting for Approval” and the points arrive only after a parent approves it in the Approval Center. If it is off, the points land immediately.'
      ),
      info('The Tasks page filters — All, Daily, Weekdays, Weekends, Weekly, One Time — match those schedules.'),
    ]),
    section('steps', [
      p('Creating a task (parent):'),
      steps([
        { title: 'Open Tasks and tap Add Task', detail: 'Or pick one of the built-in templates.' },
        { title: 'Name it plainly', detail: '“Empty the dishwasher” beats “Kitchen help”.' },
        { title: 'Set the points reward', detail: 'Keep everyday jobs in a similar range.' },
        { title: 'Choose the assigned child', detail: 'Or “Anyone (Shared)”.' },
        { title: 'Choose the schedule', detail: 'Custom days let you pick individual weekdays.' },
        { title: 'Decide on approval', detail: 'Turn it on for anything you want to inspect.' },
        { title: 'Save', detail: 'It appears immediately for the assigned child.' },
      ]),
      p('Completing a task (child): open Tasks, tap the task, then “Mark as Done”.'),
    ]),
    section('tips', [
      tip('Use templates for the first batch, then edit the wording to match how your family actually talks.'),
      p('Turn approval off for boring, verifiable daily jobs. Keep it on for anything expensive in points.'),
      p('Set “Active Status” to off instead of archiving if you only want to pause a task for a week.'),
    ]),
    section('mistakes', [
      ul([
        'Every task requiring approval, which creates a backlog and delays every payout.',
        'Point values that drift — a five-minute job worth more than a thirty-minute one.',
        'Deleting tasks to tidy up. Archive instead so old completions still make sense.',
        'Forgetting that a task set to “Not available today” simply is not scheduled for today.',
      ]),
    ]),
  ],
  related: ['approval-center', 'rewards', 'behaviours', 'dashboard'],
};

export const behaviours: HelpArticle = {
  id: 'behaviours',
  title: 'Behaviours',
  description:
    'Log one-off positive or negative events: bonus points, deducted points, or a money penalty.',
  category: 'daily',
  keywords: ['behaviour', 'behavior', 'bonus', 'penalty', 'negative', 'positive', 'points', 'fine'],
  readingTimeMinutes: 4,
  updatedAt: '2026-07-31',
  audience: ['parent'],
  sections: [
    section('what', [
      p(
        'A behaviour is a one-off event a parent records against a child, with a reason. There are three types: Positive (adds points), Negative (removes points), and Penalty (takes an amount of money from the child’s wallet).'
      ),
    ]),
    section('why', [
      p(
        'Life does not fit into scheduled tasks. Behaviours capture the unplanned — unprompted help worth rewarding, or something that genuinely needs a consequence — without inventing a fake task.'
      ),
    ]),
    section('who', [
      p('Parents only. Children see the result in their points total, wallet, and notifications, along with the reason you typed.'),
    ]),
    section('how', [
      p(
        'You pick the type, the child, a reason, and either a number of points or, for a penalty, a money amount. It applies immediately — behaviours do not go through the Approval Center — and appears in the child’s history as “Behaviour penalty” or as a points change.'
      ),
      warn(
        'A money penalty moves real money out of a child’s wallet straight away. Use it sparingly and write a reason the child would recognise.'
      ),
    ]),
    section('steps', [
      steps([
        { title: 'Open the child’s profile or the parent dashboard', detail: 'Find “Log Behaviour”.' },
        { title: 'Choose the type', detail: 'Positive, Negative, or Penalty.' },
        { title: 'Select the child', detail: 'Behaviours always target one child.' },
        { title: 'Write the reason', detail: 'For example “Helped with groceries”.' },
        { title: 'Enter points or a penalty amount', detail: 'Penalties are in your family currency.' },
        { title: 'Tap Log Event', detail: 'The change is applied at once.' },
      ]),
    ]),
    section('tips', [
      tip('Log positives at least three times more often than negatives, or the feature becomes something children dread.'),
      p('Reasons are shown to the child. Write them as you would say them out loud.'),
    ]),
    section('mistakes', [
      ul([
        'Using a penalty when a negative points entry would do.',
        'Vague reasons like “attitude” that the child cannot learn from.',
        'Logging in anger. There is no undo on the child’s feelings, even if you fix the number.',
      ]),
      soon('Editing or reversing a behaviour entry from the behaviour log itself.'),
    ]),
  ],
  related: ['tasks', 'wallet', 'parent-guide', 'notifications'],
};

export const rewards: HelpArticle = {
  id: 'rewards',
  title: 'Rewards',
  description:
    'Build the catalogue children spend their points on, with costs, categories, and optional stock limits.',
  category: 'daily',
  keywords: ['rewards', 'redeem', 'prizes', 'points', 'shop', 'catalogue', 'stock', 'inventory'],
  readingTimeMinutes: 5,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  popular: true,
  sections: [
    section('what', [
      p(
        'Rewards are what points are for: screen time, a treat, an outing, an item. Each reward has a name, a cost in points, an icon category, and an optional inventory limit.'
      ),
    ]),
    section('why', [
      p(
        'Points with nothing to buy are worthless. The catalogue turns effort into something a child chose in advance, which is what makes the whole loop worth running.'
      ),
    ]),
    section('who', [
      p('Parents create, edit, and archive rewards. Children redeem them when they have enough points.'),
    ]),
    section('how', [
      p(
        'A child opens Rewards and taps a reward. If they have enough points and it is in stock, Redeem deducts the points and records the redemption in the history. If inventory was set, the remaining count drops by one; when it hits zero the reward shows as out of stock.'
      ),
      p('Icon categories are Gift/Item, Screen Time/Gaming, Food/Treat, and Experience/Outing.'),
      info('Redemption history lists who redeemed what, so nobody has to remember whether a reward was already used.'),
    ]),
    section('steps', [
      steps([
        { title: 'Open Rewards and tap Add Reward', detail: 'Templates are available in the form.' },
        { title: 'Name the reward', detail: 'Be specific: “30 minutes extra screen time”.' },
        { title: 'Set the cost in points', detail: 'Aim for one affordable reward per week of effort.' },
        { title: 'Set inventory if it is limited', detail: 'Leave blank for unlimited.' },
        { title: 'Pick an icon category', detail: 'It makes the list scannable for younger children.' },
        { title: 'Save', detail: 'Children can redeem it straight away.' },
      ]),
    ]),
    section('tips', [
      tip('Include one cheap reward children can buy after two or three days. Long-only catalogues kill motivation.'),
      p('Price against reality: work out the points a child can earn in a week, then set the top reward at two to three weeks of that.'),
    ]),
    section('mistakes', [
      ul([
        'Rewards that a parent then refuses to honour. It ends the system’s credibility instantly.',
        'Setting inventory to 1 by accident and wondering why a reward disappeared.',
        'Never repricing. If nothing has been redeemed in a month, your prices are wrong.',
      ]),
      soon('Approval before a redemption takes effect. Today, redeeming is immediate for the child.'),
    ]),
  ],
  related: ['tasks', 'child-guide', 'savings-goals', 'dashboard'],
};

export default [dashboard, tasks, behaviours, rewards];
