import type { HelpArticle } from '../../types';
import { info, p, section, soon, steps, tip, ul, warn } from './_shared';

export const familyBulletin: HelpArticle = {
  id: 'family-bulletin',
  title: 'Family Bulletin',
  description:
    'Publish announcements to the whole family or to selected members, with priority, scheduling, and pinning.',
  category: 'family',
  keywords: [
    'bulletin',
    'announcement',
    'notice',
    'news',
    'rule change',
    'pinned',
    'urgent',
    'message',
  ],
  readingTimeMinutes: 4,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  sections: [
    section('what', [
      p(
        'A noticeboard inside the app. Parents publish announcements — a rule change, a reminder, an event, an urgent notice — and they appear for the audience you chose until they expire or are archived.'
      ),
    ]),
    section('why', [
      p(
        'Shouting up the stairs does not scale, and messages in a chat app scroll away. An announcement stays visible, shows who has read it, and can be pinned when it really matters.'
      ),
    ]),
    section('who', [
      p(
        'Parents create, edit, archive, and delete announcements. Everyone reads the ones addressed to them and can mark them as read. Audiences are the entire family, all children, parents/adults only, or selected members.'
      ),
    ]),
    section('how', [
      p('Each announcement has a title, a message, and a few controls:'),
      ul([
        'Type — General, Rule change, Consequence/reminder, New task, Reward update, Event, or Urgent notice.',
        'Priority — Normal, Important, or Urgent.',
        'Audience — family, children, adults, or a hand-picked list.',
        'Start and expiry times — schedule it now or for later.',
        'Pin to top — keeps it above everything else.',
        'Link an existing task, or create a one-time task straight from the announcement.',
      ]),
      info('Unread announcements are badged, and the Active and History tabs separate what is current from what has passed.'),
    ]),
    section('steps', [
      steps([
        { title: 'Open the bulletin', detail: 'It appears on the dashboard.' },
        { title: 'Tap Create announcement', detail: 'Parents only.' },
        { title: 'Write a title and message', detail: 'Both are required.' },
        { title: 'Pick a type and priority', detail: 'Reserve Urgent for genuinely urgent things.' },
        { title: 'Choose the audience', detail: 'Selected members requires at least one person.' },
        { title: 'Set start and expiry', detail: 'The expiry must be after the start.' },
        { title: 'Publish', detail: 'Pin it if it must stay at the top.' },
      ]),
    ]),
    section('tips', [
      tip('Link the announcement to a task when you are announcing work. One tap takes the child from “we agreed this” to “here it is”.'),
      p('Set an expiry on time-bound notices so the board cleans itself up.'),
    ]),
    section('mistakes', [
      ul([
        'Marking everything Urgent, which trains everyone to ignore urgent.',
        'Pinning an announcement and never unpinning it.',
        'Using the bulletin for a rule change without discussing it first — the app is a record, not a substitute for the conversation.',
      ]),
    ]),
  ],
  related: ['dashboard', 'tasks', 'notifications', 'family-management'],
};

export const approvalCenter: HelpArticle = {
  id: 'approval-center',
  title: 'Approval Center',
  description:
    'One queue for everything waiting on a parent: task completions, transfers, money requests, donations, goals, and profile changes.',
  category: 'family',
  keywords: [
    'approval',
    'approve',
    'reject',
    'pending',
    'queue',
    'requests',
    'confirm',
    'parent approval',
  ],
  readingTimeMinutes: 5,
  updatedAt: '2026-07-31',
  audience: ['parent'],
  popular: true,
  sections: [
    section('what', [
      p(
        'A single list of everything a child has done or asked for that needs a parent decision. Each item can be approved or rejected, and a History tab records what you decided.'
      ),
    ]),
    section('why', [
      p(
        'Approvals scattered across screens get missed, and a missed approval feels to a child like being ignored. One queue means one habit: clear it, and nothing is outstanding.'
      ),
    ]),
    section('who', [
      p('Parents only. Children see the outcome in their notifications and their balances.'),
    ]),
    section('how', [
      p('These request types arrive in the queue:'),
      ul([
        'Task Completion — a child marked an approval-required task as done.',
        'Transfer Request — a child wants to send money to a sibling.',
        'Money Request — a child asked a parent for money.',
        'Sibling Money Request — a sibling accepted a request and it now needs your sign-off.',
        'Pet Box Donation — a child wants to donate to a pet fund.',
        'Goal Contribution and Goal Withdrawal — money into or out of a savings goal.',
        'Profile Update Request — a child wants to change their name or avatar.',
      ]),
      p('Approving applies the change immediately: points land, money moves, the profile updates. Rejecting leaves everything untouched.'),
      warn('Money only moves on approval. Until you decide, a child’s balance still shows the amount as theirs.'),
    ]),
    section('steps', [
      steps([
        { title: 'Open Home', detail: 'The Approval Center is on the parent dashboard.' },
        { title: 'Read the request line', detail: 'It names the child, the amount, and any note.' },
        { title: 'Approve or Reject', detail: 'One tap each; the list updates as you go.' },
        { title: 'Check History if challenged', detail: 'It shows what was decided and when.' },
      ]),
    ]),
    section('tips', [
      tip('Clear the queue at a fixed time each day. Predictability is worth more to children than speed.'),
      p('When rejecting something significant, say why in person. The app records the decision, not the reasoning.'),
    ]),
    section('mistakes', [
      ul([
        'Approving in bulk without reading — approvals move real money.',
        'Leaving the queue for a week, then approving a task the child no longer remembers doing.',
        'Assuming a rejection notifies the child with an explanation. It does not include one.',
      ]),
      soon('A note or reason attached to a rejection.'),
    ]),
  ],
  related: ['tasks', 'child-transfers', 'savings-goals', 'parent-guide'],
};

export const familyManagement: HelpArticle = {
  id: 'family-management',
  title: 'Family management',
  description:
    'Add and remove members, share the invite code, manage child profiles, and understand ownership.',
  category: 'family',
  keywords: [
    'family',
    'members',
    'invite code',
    'add child',
    'remove member',
    'profile',
    'avatar',
    'owner',
    'managed child',
  ],
  readingTimeMinutes: 5,
  updatedAt: '2026-07-31',
  audience: ['parent'],
  sections: [
    section('what', [
      p(
        'The Family page lists everyone in your family and links to each member’s profile. Settings → Family holds the family name, the member count, and the invite code.'
      ),
    ]),
    section('why', [
      p(
        'A family changes: a second parent joins, a child gets old enough for their own sign-in, someone leaves. Membership needs to be adjustable without rebuilding the whole family.'
      ),
    ]),
    section('who', [
      p(
        'Parents manage members. The parent who created the family is the owner; that only matters when deleting an account, because the owner must transfer ownership to another parent first.'
      ),
    ]),
    section('how', [
      p(
        'New members join by entering the invite code when they sign up. Children can also be created and managed by a parent — a managed child, shown with a “Managed” label on the wallets screen. Tapping a member opens their profile with their tasks, points, wallet, and history.'
      ),
      p(
        'Children can edit their own name and avatar, but the change is sent to a parent as a Profile Update Request and takes effect only once approved.'
      ),
      info('Regenerating the invite code is not available yet, so share it only with people you intend to add.'),
    ]),
    section('steps', [
      steps([
        { title: 'Open Settings → Family', detail: 'Find the invite code and copy it.' },
        { title: 'Send the code privately', detail: 'Anyone with it can join your family.' },
        { title: 'They sign up with the code', detail: 'They land in your family, not a new one.' },
        { title: 'Open Family to check', detail: 'The new member appears in the list.' },
        { title: 'Tap a member for their profile', detail: 'Tasks, points, wallet, and history in one place.' },
      ]),
    ]),
    section('tips', [
      tip('Give every child a distinct avatar and colour. Younger children navigate by colour long before they read names.'),
      p('Before deleting your own account as the owner, nominate the other parent as the new owner.'),
    ]),
    section('mistakes', [
      ul([
        'Posting the invite code in a group chat that outlives its purpose.',
        'Removing a member to “reset” them — history goes with them.',
        'Assuming a child profile change applied instantly. It waits for approval.',
      ]),
      soon('Regenerating the invite code to invalidate an old one.'),
    ]),
  ],
  related: ['getting-started', 'account-security', 'approval-center', 'parent-guide'],
};

export default [familyBulletin, approvalCenter, familyManagement];
