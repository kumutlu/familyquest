import { describe, expect, it } from 'vitest';
import {
  getTransactionDisplayAmount,
  isReversedStatus,
  type NormalizedTransaction,
  type TransactionStatus,
} from './transactionModel';

describe('transaction status helpers', () => {
  it.each([
    ['reversed', true],
    ['rejected', false],
    ['cancelled', false],
  ] satisfies ReadonlyArray<readonly [TransactionStatus, boolean]>)('classifies %s reversal status', (status, expected) => {
    expect(isReversedStatus(status)).toBe(expected);
  });
});

describe('transaction amount display', () => {
  it('preserves the one-argument points output', () => {
    const pointTransaction: NormalizedTransaction = {
      id: 'reward-1',
      timestamp: 1,
      type: 'reward_redemption',
      amountPence: -100,
      currency: '£',
      unit: 'points',
      direction: 'out',
      status: 'completed',
      title: 'Reward redeemed',
      subtitle: 'Bike',
      icon: 'Gift',
      iconBg: 'bg-reward-50',
      iconColor: 'text-reward-600',
      reversible: true,
      searchText: 'reward redeemed bike',
      category: 'reward',
      isPending: false,
      isCompleted: true,
      isReversed: false,
    };

    expect(getTransactionDisplayAmount(pointTransaction)).toBe('100 points');
  });
});
