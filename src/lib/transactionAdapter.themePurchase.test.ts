/**
 * Theme purchase → transaction history tests (spec §6 / §A-History).
 *
 * Pins the human-readable entry contract:
 *     Neon Arcade / Theme purchase / -500 points
 * No developer-facing labels, no raw source kinds.
 */

import { describe, expect, it } from 'vitest';
import { adaptAllTransactions } from './transactionAdapter';
import { isReversibleType } from './transactionModel';

const THEME_PURCHASE = {
  id: 'purchases/child-1',
  shopItemId: 'space',
  childId: 'child-1',
  themeId: 'theme.shop.space',
  costPoints: 500,
  source: 'points',
  purchasedAt: 1_759_000_000_000,
  actorId: 'child-1',
};

const opts = {
  currency: '£',
} as unknown as Parameters<typeof adaptAllTransactions>[0]['opts'];

describe('theme purchase history entry', () => {
  it('renders a human-readable points row with the theme name as subtitle', () => {
    const [tx] = adaptAllTransactions({
      themePurchases: [THEME_PURCHASE],
      opts,
    });
    expect(tx).toBeDefined();
    expect(tx!.type).toBe('theme_purchase');
    expect(tx!.unit).toBe('points');
    expect(tx!.amountPence).toBe(-500);
    expect(tx!.direction).toBe('out');
    expect(tx!.status).toBe('completed');
    expect(tx!.title).toBe('Theme purchase');
    expect(tx!.subtitle).toBe('Space');
    expect(tx!.childId).toBe('child-1');
  });

  it('is excluded from reversible types (ownership is permanent)', () => {
    expect(isReversibleType('theme_purchase' as never)).toBe(false);
  });

  it('drops malformed purchase records instead of crashing the ledger', () => {
    const txs = adaptAllTransactions({
      themePurchases: [
        { id: 'x' }, // missing childId/costPoints/shopItemId
        null,
        'garbage',
        THEME_PURCHASE,
      ],
      opts,
    });
    expect(txs).toHaveLength(1);
    expect(txs[0]!.type).toBe('theme_purchase');
  });

  it('sorts together with the rest of the ledger newest-first', () => {
    const txs = adaptAllTransactions({
      redemptions: [{
        id: 'red-1', rewardId: 'r1', userId: 'child-1', costPaid: 100,
        status: 'completed', createdAt: 1_759_000_000_000 - 5_000,
        redeemedAt: 1_759_000_000_000 - 5_000,
        sourceId: 'red-1', familyId: 'family-1', actorId: 'child-1',
      }],
      themePurchases: [THEME_PURCHASE],
      opts,
    });
    expect(txs).toHaveLength(2);
    expect(txs[0]!.timestamp).toBeGreaterThanOrEqual(txs[1]!.timestamp);
  });
});
