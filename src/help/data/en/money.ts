import type { HelpArticle } from '../../types';
import { info, p, section, soon, steps, tip, ul, warn } from './_shared';

export const wallet: HelpArticle = {
  id: 'wallet',
  title: 'Wallet',
  description:
    'Real-money balances: adding and withdrawing money, money insights, pending transfers, and transaction history.',
  category: 'money',
  keywords: [
    'wallet',
    'money',
    'balance',
    'transactions',
    'history',
    'add money',
    'withdraw',
    'insights',
    'pending',
  ],
  readingTimeMinutes: 6,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  popular: true,
  sections: [
    section('what', [
      p(
        'Every child has a wallet holding a real-money balance in your family currency. The wallet screen shows the available balance, money insights, pending transfers, and a full transaction list.'
      ),
    ]),
    section('why', [
      p(
        'Cash disappears into pockets and memory. A wallet gives a child a balance they can check themselves and a history that settles any “but you already gave me that” argument.'
      ),
    ]),
    section('who', [
      p(
        'Children see their own wallet. Parents see every child wallet from the Child Wallets screen and are the only ones who can add or withdraw money.'
      ),
    ]),
    section('how', [
      p('The wallet screen is built from a few blocks:'),
      ul([
        'Available balance — spendable money right now.',
        'Money insights — money in, money out, and pending totals.',
        'Quick actions — Send Money and Request Money for children.',
        'Pending transfers — anything waiting for parent approval.',
        'Recent transactions — searchable and filterable by income, expense, rewards, allowances, goals, adjustments, and by status.',
      ]),
      info(
        'The balance changes only when a transaction completes. Money in a pending transfer still shows in your balance until it is approved.'
      ),
    ]),
    section('steps', [
      p('Parent — add or withdraw money:'),
      steps([
        { title: 'Open Family, then the child', detail: 'Or go to the Child Wallets screen.' },
        { title: 'Tap Manage Wallet', detail: 'It has Add Money and Withdraw tabs.' },
        { title: 'Enter the amount and a note', detail: 'For example “Pocket money”.' },
        { title: 'Confirm', detail: 'The balance and history update immediately.' },
      ]),
      p('Anyone — inspect a transaction: open the wallet, tap a row, and read the details, including who acted, the note, the reference, and the balance after.'),
    ]),
    section('tips', [
      tip('Always write a note. Six weeks later the note is the only thing that explains the number.'),
      p('Use the search box and filters on the history screen instead of scrolling.'),
    ]),
    section('mistakes', [
      ul([
        'Reading “Pending” as “gone”. Pending money is still yours until approval.',
        'Withdrawing money instead of logging a penalty when there was a behaviour reason — the history then hides why.',
        'Expecting the wallet to connect to a real bank account. Balances in Queki are a record your family keeps, not a bank.',
      ]),
      soon('Bank or card integration. Queki tracks the money; it does not move it in the real world.'),
    ]),
  ],
  related: ['child-transfers', 'weekly-allowance', 'savings-goals', 'approval-center'],
};

export const childTransfers: HelpArticle = {
  id: 'child-transfers',
  title: 'Child transfers',
  description:
    'How children send money to a sibling or request money from a parent — and why a parent always approves.',
  category: 'money',
  keywords: [
    'transfer',
    'send money',
    'request money',
    'sibling',
    'brother',
    'sister',
    'pending transfer',
    'approval',
  ],
  readingTimeMinutes: 5,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  sections: [
    section('what', [
      p(
        'Two child-initiated money actions. Send Money moves money from one child to another child in the family. Request Money asks a parent — or a sibling — to send money to you.'
      ),
    ]),
    section('why', [
      p(
        'Children lend each other money constantly. Routing it through the app makes the debt visible and gives parents a veto before anything moves, which prevents the classic “they owe me” standoff.'
      ),
    ]),
    section('who', [
      p(
        'Transfers can only be sent between children in the same family — a child cannot send money to a parent, or to themselves. Requests can be aimed at a parent or a sibling. Parents approve both.'
      ),
    ]),
    section('how', [
      p(
        'When a child sends money, nothing leaves their balance yet: the transfer appears under Pending transfers as “Waiting for parent approval”. A parent sees it in the Approval Center as a Transfer Request and approves or rejects it. Only on approval does the money move.'
      ),
      p(
        'A money request to a sibling goes to that sibling first. If they accept, it then still needs a parent’s approval before the money moves.'
      ),
      warn('You cannot send more than your available balance, and amounts are limited to two decimal places.'),
    ]),
    section('steps', [
      p('Send money to a sibling:'),
      steps([
        { title: 'Open your wallet', detail: 'Tap Send Money under Quick actions.' },
        { title: 'Choose the sibling', detail: 'Only children in your family are listed.' },
        { title: 'Enter the amount', detail: 'Your balance stays the same until a parent approves.' },
        { title: 'Add a note', detail: 'For example “Thanks for the book!”.' },
        { title: 'Tap Send Request', detail: 'It now appears under Pending transfers.' },
      ]),
      p('Request money: open your wallet, tap Request Money, choose a parent or sibling, enter the amount and a note, then send.'),
    ]),
    section('tips', [
      tip('Notes are the whole point. “For the cinema on Saturday” gets approved far faster than a bare amount.'),
      p('If a transfer sits pending, check the Approval Center rather than sending a second one.'),
    ]),
    section('mistakes', [
      ul([
        'Sending twice because the balance did not change. It does not change until approval.',
        'Trying to send money to a parent — transfers are child-to-child only.',
        'Requesting a round number with no reason and assuming it will be approved.',
      ]),
    ]),
  ],
  related: ['wallet', 'approval-center', 'child-guide', 'notifications'],
};

export const weeklyAllowance: HelpArticle = {
  id: 'weekly-allowance',
  title: 'Weekly allowance',
  description:
    'How to run a regular allowance in Queki today, and what the allowance category means in the history.',
  category: 'money',
  keywords: ['allowance', 'pocket money', 'weekly', 'regular', 'payday', 'recurring money'],
  readingTimeMinutes: 4,
  updatedAt: '2026-07-31',
  audience: ['parent'],
  sections: [
    section('what', [
      p(
        'A regular payment into a child’s wallet — the classic pocket money arrangement. In Queki an allowance is a deposit a parent makes into the child’s wallet, and it is labelled as an allowance in the transaction history.'
      ),
    ]),
    section('why', [
      p(
        'Allowance and earnings do different jobs. Earnings reward effort; a baseline allowance teaches budgeting because it arrives whatever happens. Keeping the allowance label separate lets you see which is which in the history.'
      ),
    ]),
    section('who', [
      p('Parents pay allowances. Children receive them and see them in their wallet and money insights.'),
    ]),
    section('how', [
      p(
        'Open the child’s wallet, choose Manage Wallet → Add Money, enter the amount and use a note containing “Allowance”. The transaction is then categorised as an allowance, so you can filter the history by Allowances and see the running pattern separately from task earnings.'
      ),
      soon(
        'Automatic scheduled allowances. Queki does not yet pay an allowance on a timer — today every allowance is a deposit a parent makes.'
      ),
    ]),
    section('steps', [
      steps([
        { title: 'Pick a fixed day', detail: 'Same day every week; consistency is the whole benefit.' },
        { title: 'Open the child’s wallet', detail: 'Family → child → Manage Wallet.' },
        { title: 'Add Money', detail: 'Enter the weekly amount.' },
        { title: 'Write “Allowance” in the note', detail: 'This is what tags it as an allowance.' },
        { title: 'Confirm', detail: 'The child is notified and the balance updates.' },
        { title: 'Repeat weekly', detail: 'Set a reminder on your phone until scheduling ships.' },
      ]),
    ]),
    section('tips', [
      tip('Keep the allowance modest and let tasks provide the upside. If the allowance covers everything, tasks stop mattering.'),
      p('Filter the wallet history by Allowances to review a few months of payments in one view.'),
    ]),
    section('mistakes', [
      ul([
        'Skipping weeks quietly. An unreliable allowance teaches nothing except that adults forget.',
        'Docking the allowance as a punishment instead of logging a behaviour penalty, which loses the reason.',
        'Expecting the payment to happen automatically. It does not yet.',
      ]),
    ]),
  ],
  related: ['wallet', 'behaviours', 'savings-goals', 'parent-guide'],
};

export const savingsGoals: HelpArticle = {
  id: 'savings-goals',
  title: 'Savings goals',
  description:
    'Set a target, contribute towards it, add a parent match, and withdraw with approval when it is time.',
  category: 'money',
  keywords: ['goals', 'savings', 'saving', 'target', 'contribution', 'match', 'withdraw', 'family goal'],
  readingTimeMinutes: 5,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  popular: true,
  sections: [
    section('what', [
      p(
        'A savings goal is a named target with an amount — a bike, a game, a family trip. Money contributed to a goal is held against that goal instead of sitting loose in a wallet.'
      ),
      p('Goals come in two kinds: a family goal that everyone can contribute to, and a child goal that belongs to one child.'),
    ]),
    section('why', [
      p(
        'Saving is hard because money is fungible. Giving the target a name and a progress bar makes the trade-off concrete: this reward now, or the bike sooner.'
      ),
    ]),
    section('who', [
      p(
        'Parents create goals and can set a parent contribution — either a fixed amount or a percentage match of what the child puts in. Children contribute from their wallet and request withdrawals.'
      ),
    ]),
    section('how', [
      p(
        'Create a goal with a title, a target amount, and — for a child goal — the child it belongs to. Optionally add a parent contribution: a fixed amount, or a percentage that tops up every child contribution. Contributions and withdrawals from a child go through the Approval Center as Goal contribution and Goal withdrawal requests.'
      ),
      info('Cancelled goals can be deleted by a parent from the Goals page; completed history stays intact.'),
    ]),
    section('steps', [
      steps([
        { title: 'Open Goals', detail: 'Reach it from the child profile or a direct link.' },
        { title: 'Tap the add button', detail: 'Choose Family goal or Child goal.' },
        { title: 'Name the goal and set the target', detail: 'Use the real price, not a rounded guess.' },
        { title: 'Choose a parent contribution', detail: 'None, a fixed amount, or a percentage match.' },
        { title: 'Save', detail: 'The goal appears with a progress bar.' },
        { title: 'Contribute', detail: 'A child contributes from their wallet; a parent approves it.' },
        { title: 'Withdraw when ready', detail: 'The child requests; a parent approves the withdrawal.' },
      ]),
    ]),
    section('tips', [
      tip('A percentage match is the single most effective saving motivator: “every pound you save, I add fifty pence”.'),
      p('Keep one goal at a time per child. Three parallel goals means none of them ever finishes.'),
    ]),
    section('mistakes', [
      ul([
        'Targets so large the progress bar never visibly moves.',
        'Treating goal money as spendable — it needs an approved withdrawal to come back.',
        'Deleting a goal instead of cancelling it and losing the sense of the history.',
      ]),
    ]),
  ],
  related: ['wallet', 'approval-center', 'rewards', 'child-guide'],
};

export const petBox: HelpArticle = {
  id: 'pet-box',
  title: 'Pet Box',
  description:
    'A shared fund for each family pet: budgets, donations from children, expenses, and a helper leaderboard.',
  category: 'money',
  keywords: ['pet box', 'pet', 'fund', 'donation', 'expense', 'vet', 'budget', 'leaderboard', 'animal'],
  readingTimeMinutes: 5,
  updatedAt: '2026-07-31',
  audience: ['everyone'],
  sections: [
    section('what', [
      p(
        'The Pet Box holds a shared fund per pet. Each pet has a monthly budget, an optional emergency fund goal, a balance, a list of donations, and a list of recorded expenses such as food, litter, vet, insurance, toys, or grooming.'
      ),
    ]),
    section('why', [
      p(
        'Pets are the clearest lesson in shared responsibility a family has: they cost money every month whether or not anyone feels like paying. The Pet Box makes that cost visible and lets children take part in covering it.'
      ),
    ]),
    section('who', [
      p(
        'Parents add pets, set budgets, and record expenses. Children donate from their wallets — a donation is a request that needs parent approval, and their money is not deducted until it is approved. The Top Helpers leaderboard shows who has contributed.'
      ),
    ]),
    section('how', [
      p(
        'The fund card shows the balance, how much of the monthly budget has been spent, and progress towards the emergency goal. If expenses exceed the balance the card shows how much more is needed. Expenses are recorded by a parent with an amount, a category, and a description.'
      ),
      info('A child donation appears in the Approval Center as a Pet Box Donation until a parent approves it.'),
    ]),
    section('steps', [
      steps([
        { title: 'Open Pet Box', detail: 'Reachable from the dashboard and direct links.' },
        { title: 'Parent: Add Pet', detail: 'Name, species, monthly budget, optional emergency goal.' },
        { title: 'Child: Quick Donate', detail: 'Enter an amount and send it for approval.' },
        { title: 'Parent: approve the donation', detail: 'Only then is the child’s money deducted.' },
        { title: 'Parent: Add Expense', detail: 'Amount, category, and a short description.' },
        { title: 'Review Top Helpers', detail: 'It shows who has been contributing.' },
      ]),
    ]),
    section('tips', [
      tip('Record even small expenses. The whole point is showing children what the pet actually costs each month.'),
      p('Set an emergency goal early. Vet bills are exactly the surprise the fund exists for.'),
    ]),
    section('mistakes', [
      ul([
        'Pressuring children to donate. Voluntary contributions teach something; compulsory ones teach resentment.',
        'Forgetting to approve a donation, leaving the child unsure whether it counted.',
        'Setting a monthly budget nobody agreed on and then treating overspend as a failure.',
      ]),
    ]),
  ],
  related: ['wallet', 'approval-center', 'family-management', 'child-transfers'],
};

export default [wallet, childTransfers, weeklyAllowance, savingsGoals, petBox];
