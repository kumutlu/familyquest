import { describe, expect, it } from 'vitest';
import { isReversedStatus, type TransactionStatus } from './transactionModel';

describe('transaction status helpers', () => {
  it.each([
    ['reversed', true],
    ['rejected', false],
    ['cancelled', false],
  ] satisfies ReadonlyArray<readonly [TransactionStatus, boolean]>)('classifies %s reversal status', (status, expected) => {
    expect(isReversedStatus(status)).toBe(expected);
  });
});
