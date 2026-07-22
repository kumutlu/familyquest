/**
 * Transaction History v2 - Transaction Adapter Tests
 * ====================================================
 */

import { afterEach, describe, it, expect } from 'vitest';
import {
  adaptAllTransactions,
  filterTransactions,
  searchTransactions,
  groupTransactionsByDate,
  groupTransactionsByWeek,
  groupTransactionsByMonth,
} from './transactionAdapter';
import { getTransactionDisplayAmount, type NormalizedTransaction } from './transactionModel';
import i18n from '../i18n/config';

const NOW = new Date(2026, 6, 16, 12).getTime();
const timestamp = (daysAgo: number) => ({
  toMillis: () => NOW - daysAgo * 86_400_000,
});

afterEach(async () => {
  await i18n.changeLanguage('en');
});

// Fixtures mirror the records written by src/lib/api.ts and goalContracts.ts.
const mockWalletTransactions = [
  {
    id: 'tx1',
    type: 'deposit',
    amount: 1000,
    status: 'completed',
    childId: 'child1',
    timestamp: timestamp(2),
    createdAt: timestamp(2),
    parentRef: 'parent1',
    note: 'Allowance',
  },
  {
    id: 'tx2',
    type: 'transfer_out',
    amountPence: -500,
    status: 'completed',
    timestamp: timestamp(1),
    createdAt: timestamp(1),
    childId: 'child1',
    counterpartyChildId: 'child2',
    transferRequestId: 'transfer1',
    note: 'Gift for sibling',
  },
  {
    id: 'tx3',
    type: 'transfer_in',
    amountPence: 500,
    status: 'completed',
    timestamp: timestamp(3),
    createdAt: timestamp(3),
    childId: 'child1',
    counterpartyChildId: 'child2',
    transferRequestId: 'transfer2',
  },
];

const mockGoalLedger = [
  {
    entryId: 'goal1',
    goalId: 'goal123',
    type: 'child_contribution',
    amountPence: 500,
    ownerId: 'child1',
    createdAt: timestamp(5),
    note: 'Saved for toy',
  },
];

const mockRedemptions = [
  {
    id: 'red1',
    rewardId: 'reward1',
    userId: 'child1',
    costPaid: 100,
    status: 'completed',
    familyId: 'family1',
    sourceId: 'red1',
    actorId: 'child1',
    createdAt: timestamp(2),
    redeemedAt: timestamp(2),
  },
];

const mockReversals = [
  {
    id: 'rev1',
    sourceKind: 'wallet_transaction',
    sourceId: 'tx1',
    reason: 'Parent reversed',
    status: 'completed',
    actorId: 'parent1',
    actorName: 'Parent',
    completedAt: timestamp(1),
  },
];

describe('transactionAdapter', () => {
  describe('adaptAllTransactions', () => {
    it('should adapt wallet transactions', () => {
      const result = adaptAllTransactions({
        walletTransactions: mockWalletTransactions,
        opts: {
          currency: '£',
          nameResolver: (id) => id === 'parent1' ? 'Parent' : 'Child',
        },
      });

      expect(result).toHaveLength(3);
      // Transactions are sorted by timestamp (newest first)
      // tx2 (transfer_out, 1 day ago) is most recent
      expect(result[0].type).toBe('transfer_out');
      expect(result[0].amountPence).toBe(-500);
      expect(result[0].direction).toBe('out');
      expect(result.find(tx => tx.id === 'tx1')?.category).toBe('allowance');
    });

    it('should adapt goal ledger entries', () => {
      const result = adaptAllTransactions({
        goalLedger: mockGoalLedger,
        opts: {
          currency: '£',
          nameResolver: (_id) => 'Child',
          goalResolver: (_id) => ({ title: 'New Toy', targetAmountPence: 1000, currentAmountPence: 500 }),
        },
      });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('child_contribution');
      expect(result[0].category).toBe('goal');
    });

    it('should adapt redemptions', () => {
      const result = adaptAllTransactions({
        redemptions: mockRedemptions,
        opts: {
          currency: '£',
          nameResolver: (_id) => 'Child',
          rewardResolver: (_id) => ({ title: 'Toy' }),
        },
      });

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('reward_redemption');
      expect(result[0].direction).toBe('out');
      expect(result[0].unit).toBe('points');
    });

    it('normalizes a goal withdrawal as money returning to the child', () => {
      const result = adaptAllTransactions({
        goalLedger: [{
          entryId: 'withdrawal1',
          goalId: 'goal123',
          type: 'child_withdrawal',
          amountPence: -200,
          ownerId: 'child1',
          createdAt: timestamp(1),
        }],
        opts: {},
      });

      expect(result[0]).toMatchObject({ amountPence: 200, direction: 'in', category: 'goal' });
    });

    it('should mark reversed transactions', () => {
      const result = adaptAllTransactions({
        walletTransactions: mockWalletTransactions,
        reversals: mockReversals,
        opts: {
          currency: '£',
          nameResolver: (id) => id === 'parent1' ? 'Parent' : 'Child',
        },
      });

      const reversedTx = result.find(tx => tx.id === 'tx1');
      expect(reversedTx).toMatchObject({
        status: 'reversed',
        isReversed: true,
        isCompleted: false,
        reversible: false,
      });
      expect(filterTransactions(result, ['completed']).some(tx => tx.id === 'tx1')).toBe(false);
    });

    it('should sort transactions by timestamp (newest first)', () => {
      const result = adaptAllTransactions({
        walletTransactions: mockWalletTransactions,
        opts: {
          currency: '£',
          nameResolver: (id) => id === 'parent1' ? 'Parent' : 'Child',
        },
      });

      // First transaction should be the most recent (1 day ago)
      expect(result[0].id).toBe('tx2');
    });

    it('adapts financial behaviour and current request schemas', () => {
      const result = adaptAllTransactions({
        behaviourEvents: [{
          id: 'behaviour1',
          familyId: 'family1',
          childId: 'child1',
          type: 'financial',
          reason: 'Broken item',
          pointsDelta: 0,
          walletDelta: -250,
          createdBy: 'parent1',
          createdByName: 'Parent',
          createdAt: timestamp(4),
        }],
        petboxRequests: [{
          id: 'petbox1',
          familyId: 'family1',
          fundId: 'fund1',
          fundName: 'Pet Box',
          childId: 'child1',
          childName: 'Child',
          amountPence: 300,
          status: 'pending',
          createdAt: timestamp(3),
        }],
        transferRequests: [{
          id: 'transfer1',
          familyId: 'family1',
          fromChildId: 'child1',
          fromChildName: 'Child',
          toChildId: 'child2',
          toChildName: 'Sibling',
          amountPence: 400,
          message: 'Shared book',
          status: 'pending',
          createdAt: timestamp(2),
        }],
        moneyRequests: [{
          id: 'money1',
          familyId: 'family1',
          requesterId: 'child1',
          requesterName: 'Child',
          requestedFromId: 'parent1',
          requestedFromName: 'Parent',
          amountPence: 500,
          message: 'School trip',
          status: 'pending',
          createdAt: timestamp(1),
        }],
        opts: {
          currency: '£',
          currentUserId: 'child1',
          nameResolver: id => ({ child1: 'Child', child2: 'Sibling', parent1: 'Parent' })[id],
          fundResolver: id => id === 'fund1' ? { name: 'Pet Box' } : undefined,
        },
      });

      expect(result.map(tx => tx.id)).toEqual(['money1', 'transfer1', 'petbox1', 'behaviour1']);
      expect(result.map(tx => tx.source)).toEqual([
        'money_request',
        'transfer_request',
        'petbox_request',
        'behaviour_event',
      ]);
      expect(result.map(tx => tx.amountPence)).toEqual([500, -400, -300, -250]);
      expect(result.slice(0, 3).every(tx => tx.isPending)).toBe(true);
    });

    it('localizes generated wallet, behaviour, and request subtitles in Turkish', async () => {
      await i18n.loadNamespaces(['wallet', 'goals', 'rewards', 'reversals']);
      await i18n.changeLanguage('tr');
      const t = i18n.getFixedT('tr', ['wallet', 'goals', 'rewards', 'reversals']);

      const result = adaptAllTransactions({
        walletTransactions: [{
          id: 'deposit-tr',
          type: 'deposit',
          amountPence: 500,
          childId: 'child1',
          parentRef: 'parent1',
          status: 'completed',
          createdAt: timestamp(4),
        }],
        behaviourEvents: [{
          id: 'behaviour-tr',
          childId: 'child1',
          type: 'financial',
          walletDelta: -100,
          createdBy: 'parent1',
          createdAt: timestamp(3),
        }],
        transferRequests: [{
          id: 'transfer-tr',
          fromChildId: 'child1',
          toChildId: 'child2',
          amountPence: 200,
          status: 'pending',
          createdAt: timestamp(2),
        }],
        moneyRequests: [{
          id: 'money-tr',
          requesterId: 'child1',
          requestedFromId: 'parent1',
          amountPence: 300,
          status: 'pending',
          createdAt: timestamp(1),
        }],
        opts: {
          t,
          currentUserId: 'child1',
          nameResolver: id => ({
            child1: 'Alex', child2: 'Sam', parent1: 'Taylor',
          })[id],
        },
      });

      expect(Object.fromEntries(result.map(item => [item.id, item.subtitle]))).toEqual({
        'deposit-tr': 'Taylor tarafından',
        'behaviour-tr': 'Alex · Taylor tarafından',
        'transfer-tr': 'Alex → Sam',
        'money-tr': 'Alex ← Taylor',
      });
    });

    it('keeps source order stable when timestamps are equal', () => {
      const sameTime = timestamp(1);
      const result = adaptAllTransactions({
        walletTransactions: [
          { id: 'first', type: 'deposit', childId: 'child1', amount: 100, status: 'completed', createdAt: sameTime },
          { id: 'second', type: 'deposit', childId: 'child1', amount: 200, status: 'completed', createdAt: sameTime },
        ],
        opts: {},
      });

      expect(result.map(tx => tx.id)).toEqual(['first', 'second']);
    });

    it('ignores records that do not match a current source schema', () => {
      const result = adaptAllTransactions({
        walletTransactions: [
          { type: 'deposit', amount: 100 },
          { id: 'zero', type: 'deposit', amount: 0 },
          { id: 'fractional', type: 'deposit', amount: 1.5 },
        ],
        goalLedger: [{ entryId: 'goal1', goalId: 'goal1', type: 'child_contribution', amountPence: -100 }],
        redemptions: [
          { id: 'red1', rewardId: 'reward1' },
          { id: 'red2', rewardId: 'reward1', userId: 'child1', costPaid: -100 },
        ],
        behaviourEvents: [{ id: 'behaviour1', childId: 'child1', type: 'financial', walletDelta: 100 }],
        petboxRequests: [{ id: 'petbox1', fundId: 'fund1', childId: 'child1', amountPence: -100 }],
        transferRequests: [{ id: 'transfer1', fromChildId: 'child1', toChildId: 'child2', amountPence: 0 }],
        moneyRequests: [{ id: 'money1', requesterId: 'child1', requestedFromId: 'parent1', amountPence: 10.5 }],
        opts: {},
      });

      expect(result).toEqual([]);
    });

    it('does not classify rejected or cancelled requests as reversals', () => {
      const result = adaptAllTransactions({
        petboxRequests: [{
          id: 'petbox-rejected',
          fundId: 'fund1',
          childId: 'child1',
          amountPence: 100,
          status: 'rejected',
          createdAt: timestamp(3),
        }],
        transferRequests: [{
          id: 'rejected1',
          fromChildId: 'child1',
          toChildId: 'child2',
          amountPence: 100,
          status: 'rejected',
          createdAt: timestamp(1),
        }],
        moneyRequests: [{
          id: 'cancelled1',
          requesterId: 'child1',
          requestedFromId: 'parent1',
          amountPence: 100,
          status: 'cancelled',
          createdAt: timestamp(2),
        }],
        opts: {},
      });

      expect(result.every(tx => !tx.isReversed && !tx.reversible)).toBe(true);
    });

    it('prefers canonical wallet rows over linked duplicate source records', () => {
      const createdAt = timestamp(1);
      const result = adaptAllTransactions({
        walletTransactions: [
          { id: 'wallet-behaviour', type: 'financial_penalty', amount: 250, sourceId: 'behaviour1', createdAt },
          { id: 'wallet-goal', type: 'goal_contribution', amount: -500, childId: 'child1', goalId: 'goal1', createdAt },
          { id: 'wallet-petbox', type: 'petbox_donation', amountPence: -300, sourceId: 'petbox1', createdAt },
          { id: 'wallet-transfer', type: 'transfer_out', amountPence: -400, transferRequestId: 'transfer1', createdAt },
          { id: 'wallet-money', type: 'request_payment', amountPence: 500, moneyRequestId: 'money1', createdAt },
        ],
        goalLedger: [{
          entryId: 'goal-entry1', goalId: 'goal1', type: 'child_contribution', amountPence: 500,
          ownerId: 'child1', createdAt,
        }],
        behaviourEvents: [{
          id: 'behaviour1', childId: 'child1', type: 'financial', walletDelta: -250, createdAt,
        }],
        petboxRequests: [{
          id: 'petbox1', fundId: 'fund1', childId: 'child1', amountPence: 300, status: 'approved', createdAt,
        }],
        transferRequests: [{
          id: 'transfer1', fromChildId: 'child1', toChildId: 'child2', amountPence: 400, status: 'approved', createdAt,
        }],
        moneyRequests: [{
          id: 'money1', requesterId: 'child1', requestedFromId: 'parent1', amountPence: 500, status: 'approved', createdAt,
        }],
        opts: { currentUserId: 'child1' },
      });

      expect(result.map(tx => tx.id)).toEqual([
        'wallet-behaviour',
        'wallet-goal',
        'wallet-petbox',
        'wallet-transfer',
        'wallet-money',
      ]);
    });

    it('merges reversals from every deduplicated source into its canonical wallet row', () => {
      const createdAt = timestamp(1);
      const result = adaptAllTransactions({
        walletTransactions: [
          { id: 'wallet-behaviour', type: 'financial_penalty', amount: 250, sourceId: 'behaviour1', createdAt },
          { id: 'wallet-petbox', type: 'petbox_donation', amountPence: -300, sourceId: 'petbox1', createdAt },
          { id: 'wallet-transfer', type: 'transfer_out', amountPence: -400, transferRequestId: 'transfer1', createdAt },
          { id: 'wallet-money', type: 'request_payment', amountPence: 500, moneyRequestId: 'money1', createdAt },
        ],
        behaviourEvents: [{ id: 'behaviour1', childId: 'child1', type: 'financial', walletDelta: -250, createdAt }],
        petboxRequests: [{ id: 'petbox1', fundId: 'fund1', childId: 'child1', amountPence: 300, status: 'approved', createdAt }],
        transferRequests: [{ id: 'transfer1', fromChildId: 'child1', toChildId: 'child2', amountPence: 400, status: 'approved', createdAt }],
        moneyRequests: [{ id: 'money1', requesterId: 'child1', requestedFromId: 'parent1', amountPence: 500, status: 'approved', createdAt }],
        reversals: [
          { id: 'reversal-behaviour', sourceKind: 'behaviour_event', sourceId: 'behaviour1', reason: 'Undo behaviour', completedAt: createdAt },
          { id: 'reversal-petbox', sourceKind: 'petbox_request', sourceId: 'petbox1', reason: 'Undo donation', completedAt: createdAt },
          { id: 'reversal-transfer', sourceKind: 'transfer_request', sourceId: 'transfer1', reason: 'Undo transfer', completedAt: createdAt },
          { id: 'reversal-money', sourceKind: 'money_request', sourceId: 'money1', reason: 'Undo payment', completedAt: createdAt },
        ],
        opts: { currentUserId: 'child1' },
      });

      expect(result.map(tx => tx.id)).toEqual([
        'wallet-behaviour',
        'wallet-petbox',
        'wallet-transfer',
        'wallet-money',
      ]);
      expect(result.map(tx => tx.reversalId)).toEqual([
        'reversal-behaviour',
        'reversal-petbox',
        'reversal-transfer',
        'reversal-money',
      ]);
      expect(result.every(tx => tx.status === 'reversed' && tx.isReversed && !tx.isCompleted && !tx.reversible)).toBe(true);
    });

    it('shows a legacy wallet transfer as neutral to a parent or unrelated viewer', () => {
      const result = adaptAllTransactions({
        walletTransactions: [{
          id: 'legacy-transfer',
          type: 'transfer',
          fromChildId: 'child1',
          childId: 'child2',
          amount: 500,
          status: 'completed',
          createdAt: timestamp(1),
        }],
        opts: { currentUserId: 'parent1' },
      });

      expect(result[0]).toMatchObject({ amountPence: 500, direction: 'neutral', category: 'adjustment' });
    });

    it('formats money as currency and reward costs as whole points', () => {
      const result = adaptAllTransactions({
        walletTransactions: [{ id: 'deposit1', type: 'deposit', amount: 1000, status: 'completed', createdAt: timestamp(1) }],
        redemptions: mockRedemptions,
        opts: { currency: '£' },
      });
      const deposit = result.find(tx => tx.id === 'deposit1');
      const redemption = result.find(tx => tx.id === 'red1');

      expect(deposit && getTransactionDisplayAmount(deposit)).toBe('£10.00');
      expect(redemption && getTransactionDisplayAmount(
        redemption,
        points => `${points} points`,
      )).toBe('100 points');
    });
  });

  describe('filterTransactions', () => {
    const transactions: NormalizedTransaction[] = [
      {
        id: '1',
        timestamp: Date.now(),
        type: 'deposit',
        amountPence: 1000,
        currency: '£',
        unit: 'money',
        direction: 'in',
        status: 'completed',
        title: 'Deposit',
        subtitle: 'From Parent',
        icon: 'ArrowDownRight',
        iconBg: 'bg-success-50',
        iconColor: 'text-success-600',
        reversible: true,
        searchText: 'deposit parent',
        category: 'income',
        isPending: false,
        isCompleted: true,
        isReversed: false,
      },
      {
        id: '2',
        timestamp: Date.now() - 86400000,
        type: 'withdrawal',
        amountPence: -500,
        currency: '£',
        unit: 'money',
        direction: 'out',
        status: 'completed',
        title: 'Withdrawal',
        subtitle: 'To Parent',
        icon: 'ArrowUpRight',
        iconBg: 'bg-gray-100',
        iconColor: 'text-gray-900',
        reversible: true,
        searchText: 'withdrawal parent',
        category: 'expense',
        isPending: false,
        isCompleted: true,
        isReversed: false,
      },
      {
        id: '3',
        timestamp: Date.now() - 86400000 * 2,
        type: 'reward_redemption',
        amountPence: -200,
        currency: '£',
        unit: 'points',
        direction: 'out',
        status: 'completed',
        title: 'Reward Redeemed',
        subtitle: 'For Toy',
        icon: 'Gift',
        iconBg: 'bg-reward-50',
        iconColor: 'text-reward-600',
        reversible: true,
        searchText: 'reward toy',
        category: 'reward',
        isPending: false,
        isCompleted: true,
        isReversed: false,
      },
      {
        id: '4',
        timestamp: Date.now() - 86400000 * 3,
        type: 'transfer_out',
        amountPence: -300,
        currency: '£',
        unit: 'money',
        direction: 'out',
        status: 'pending',
        title: 'Transfer',
        subtitle: 'To Sibling',
        icon: 'ArrowRightLeft',
        iconBg: 'bg-gray-100',
        iconColor: 'text-gray-900',
        reversible: true,
        searchText: 'transfer sibling',
        category: 'expense',
        isPending: true,
        isCompleted: false,
        isReversed: false,
      },
    ];

    it('should filter by income', () => {
      const result = filterTransactions(transactions, ['income']);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('should filter by expense', () => {
      const result = filterTransactions(transactions, ['expense']);
      expect(result).toHaveLength(2);
      expect(result.map(t => t.id)).toContain('2');
      expect(result.map(t => t.id)).toContain('4');
    });

    it('should filter by reward', () => {
      const result = filterTransactions(transactions, ['reward']);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('3');
    });

    it('should filter by pending', () => {
      const result = filterTransactions(transactions, ['pending']);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('4');
    });

    it('should filter by completed', () => {
      const result = filterTransactions(transactions, ['completed']);
      expect(result).toHaveLength(3);
    });

    it('should filter by reversed', () => {
      const reversedTx = { ...transactions[0], isReversed: true };
      const all = [...transactions, reversedTx];
      const result = filterTransactions(all, ['reversed']);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('should return all when filter is "all"', () => {
      const result = filterTransactions(transactions, ['all']);
      expect(result).toHaveLength(4);
    });

    it('should combine multiple filters with OR logic', () => {
      // When combining income and expense, we expect transactions that are either income OR expense
      const result = filterTransactions(transactions, ['income', 'expense']);
      expect(result).toHaveLength(3); // 1 income + 2 expenses
    });
  });

  describe('searchTransactions', () => {
    const transactions: NormalizedTransaction[] = [
      {
        id: '1',
        timestamp: Date.now(),
        type: 'deposit',
        amountPence: 1000,
        currency: '£',
        unit: 'money',
        direction: 'in',
        status: 'completed',
        title: 'Allowance Payment',
        subtitle: 'From Parent',
        icon: 'ArrowDownRight',
        iconBg: 'bg-success-50',
        iconColor: 'text-success-600',
        reversible: true,
        searchText: 'allowance payment from parent',
        category: 'income',
        isPending: false,
        isCompleted: true,
        isReversed: false,
      },
      {
        id: '2',
        timestamp: Date.now() - 86400000,
        type: 'transfer_out',
        amountPence: -500,
        currency: '£',
        unit: 'money',
        direction: 'out',
        status: 'completed',
        title: 'Transfer to Sibling',
        subtitle: 'Gift for Alex',
        icon: 'ArrowRightLeft',
        iconBg: 'bg-gray-100',
        iconColor: 'text-gray-900',
        reversible: true,
        searchText: 'transfer to sibling gift for alex',
        category: 'expense',
        isPending: false,
        isCompleted: true,
        isReversed: false,
      },
    ];

    it('should search by title', () => {
      const result = searchTransactions(transactions, 'allowance');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('should search by subtitle', () => {
      const result = searchTransactions(transactions, 'sibling');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });

    it('should return all when query is empty', () => {
      const result = searchTransactions(transactions, '');
      expect(result).toHaveLength(2);
    });

    it('should return empty when no match', () => {
      const result = searchTransactions(transactions, 'nonexistent');
      expect(result).toHaveLength(0);
    });

    it('should be case-insensitive', () => {
      const result = searchTransactions(transactions, 'ALLOWANCE');
      expect(result).toHaveLength(1);
    });
  });

  describe('groupTransactionsByDate', () => {
    const referenceDate = new Date(2026, 6, 16, 12);

    const createTx = (id: string, daysAgo: number): NormalizedTransaction => ({
      id,
      timestamp: referenceDate.getTime() - daysAgo * 86400000,
      type: 'deposit',
      amountPence: 1000,
      currency: '£',
      unit: 'money',
      direction: 'in',
      status: 'completed',
      title: `Transaction ${id}`,
      subtitle: '',
      icon: 'ArrowDownRight',
      iconBg: 'bg-success-50',
      iconColor: 'text-success-600',
      reversible: true,
      searchText: id,
      category: 'income',
      isPending: false,
      isCompleted: true,
      isReversed: false,
    });

    it('should group transactions by Today', () => {
      const transactions = [createTx('1', 0), createTx('2', 0)];
      const result = groupTransactionsByDate(transactions, referenceDate);

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('today');
      expect(result[0].items).toHaveLength(2);
    });

    it('should group transactions by Yesterday', () => {
      const transactions = [createTx('1', 1), createTx('2', 1)];
      const result = groupTransactionsByDate(transactions, referenceDate);

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('yesterday');
    });

    it('should group transactions by Earlier this week', () => {
      const transactions = [createTx('1', 2), createTx('2', 3)];
      const result = groupTransactionsByDate(transactions, referenceDate);

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('earlierThisWeek');
    });

    it('uses Monday as the earlier-this-week boundary', () => {
      const result = groupTransactionsByDate([createTx('previous-saturday', 5)], referenceDate);

      expect(result[0].key).toBe('older');
    });

    it('should group transactions by Older', () => {
      const transactions = [createTx('1', 10), createTx('2', 14)];
      const result = groupTransactionsByDate(transactions, referenceDate);

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('older');
    });

    it('should handle empty transactions', () => {
      const result = groupTransactionsByDate([], referenceDate);
      expect(result).toHaveLength(0);
    });

    it('should order groups correctly (today first)', () => {
      const transactions = [
        createTx('1', 10),
        createTx('2', 0),
        createTx('3', 1),
        createTx('4', 3),
      ];
      const result = groupTransactionsByDate(transactions, referenceDate);

      expect(result[0].key).toBe('today');
      expect(result[1].key).toBe('yesterday');
      expect(result[2].key).toBe('earlierThisWeek');
      expect(result[3].key).toBe('older');
    });
  });

  describe('groupTransactionsByWeek', () => {
    // Use a fixed Thursday reference date for deterministic tests.
    const thursdayRef = new Date(2026, 6, 16, 12);

    const createTx = (id: string, daysAgo: number): NormalizedTransaction => ({
      id,
      timestamp: thursdayRef.getTime() - daysAgo * 86400000,
      type: 'deposit',
      amountPence: 1000,
      currency: '£',
      unit: 'money',
      direction: 'in',
      status: 'completed',
      title: `Transaction ${id}`,
      subtitle: '',
      icon: 'ArrowDownRight',
      iconBg: 'bg-success-50',
      iconColor: 'text-success-600',
      reversible: true,
      searchText: id,
      category: 'income',
      isPending: false,
      isCompleted: true,
      isReversed: false,
    });

    it('should group transactions by This Week', () => {
      // Thursday reference: transactions 0 and 3 days ago are both in this week.
      const transactions = [createTx('1', 0), createTx('2', 3)];
      const result = groupTransactionsByWeek(transactions, thursdayRef);

      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('This Week');
    });

    it('should group transactions by Last Week', () => {
      // Thursday reference: transactions 8 and 10 days ago are both in last week.
      const transactions = [createTx('1', 8), createTx('2', 10)];
      const result = groupTransactionsByWeek(transactions, thursdayRef);

      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Last Week');
    });

    it('should group transactions by Older', () => {
      // Thursday reference: transactions 14 and 21 days ago are both older.
      const transactions = [createTx('1', 14), createTx('2', 21)];
      const result = groupTransactionsByWeek(transactions, thursdayRef);

      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Older');
    });
  });

  describe('groupTransactionsByMonth', () => {
    const createTx = (id: string, year: number, month: number, day: number): NormalizedTransaction => ({
      id,
      timestamp: new Date(year, month, day, 12).getTime(),
      type: 'deposit',
      amountPence: 1000,
      currency: '£',
      unit: 'money',
      direction: 'in',
      status: 'completed',
      title: `Transaction ${id}`,
      subtitle: '',
      icon: 'ArrowDownRight',
      iconBg: 'bg-success-50',
      iconColor: 'text-success-600',
      reversible: true,
      searchText: id,
      category: 'income',
      isPending: false,
      isCompleted: true,
      isReversed: false,
    });

    it('groups calendar months newest first with deterministic labels', () => {
      const result = groupTransactionsByMonth([
        createTx('june', 2026, 5, 30),
        createTx('july-late', 2026, 6, 20),
        createTx('july-early', 2026, 6, 2),
      ]);

      expect(result.map(group => group.label)).toEqual(['July 2026', 'June 2026']);
      expect(result[0].items.map(tx => tx.id)).toEqual(['july-late', 'july-early']);
    });

    it('handles an empty list', () => {
      expect(groupTransactionsByMonth([])).toEqual([]);
    });
  });
});
