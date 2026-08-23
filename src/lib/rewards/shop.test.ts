import { describe, expect, it } from 'vitest';
import {
  buildRewardShop,
  childVisibleShop,
  isOutOfStock,
  orderShopRewards,
  type ShopReward,
} from './shop';

const reward = (overrides: Partial<ShopReward> & { id: string }): ShopReward => ({
  title: `Reward ${overrides.id}`,
  cost: 100,
  icon: 'Gift',
  inventory: null,
  availability: 'available',
  affordable: true,
  missingPoints: 0,
  ...overrides,
});

describe('reward shop ordering', () => {
  it('is deterministic across repeated calls', () => {
    const input = [
      reward({ id: 'b', cost: 200 }),
      reward({ id: 'a', cost: 100 }),
      reward({ id: 'c', cost: 50, availability: 'out_of_stock' }),
    ];
    const first = orderShopRewards(input).map(r => r.id);
    const second = orderShopRewards(input).map(r => r.id);
    expect(first).toEqual(['a', 'b', 'c']);
    expect(first).toEqual(second);
  });

  it('ranks available before out-of-stock before inactive', () => {
    const ordered = orderShopRewards([
      reward({ id: 'inactive', availability: 'inactive', cost: 90 }),
      reward({ id: 'oos', availability: 'out_of_stock', cost: 50 }),
      reward({ id: 'ok', availability: 'available' }),
    ]).map(r => r.id);
    expect(ordered).toEqual(['ok', 'oos', 'inactive']);
  });

  it('ranks affordable before unaffordable within available rewards', () => {
    const ordered = orderShopRewards([
      reward({ id: 'expensive', cost: 500, affordable: false, missingPoints: 400 }),
      reward({ id: 'cheap', cost: 10, affordable: true }),
    ]).map(r => r.id);
    expect(ordered).toEqual(['cheap', 'expensive']);
  });

  it('breaks cost ties by title then id', () => {
    const ordered = orderShopRewards([
      reward({ id: 'z', title: 'Same', cost: 100 }),
      reward({ id: 'y', title: 'Same', cost: 100 }),
      reward({ id: 'x', title: 'Aardvark', cost: 100 }),
    ]).map(r => r.id);
    expect(ordered).toEqual(['x', 'y', 'z']);
  });
});

describe('buildRewardShop affordability + stock states', () => {
  it('marks affordable rewards with no missing points', () => {
    const [item] = buildRewardShop([{ id: 'r1', title: 'Pizza Night', cost: 250 }], 340);
    expect(item.affordable).toBe(true);
    expect(item.missingPoints).toBe(0);
    expect(item.availability).toBe('available');
  });

  it('computes missing points for unaffordable rewards without faking deduction', () => {
    const [item] = buildRewardShop([{ id: 'r1', title: 'Big Prize', cost: 500 }], 120);
    expect(item.affordable).toBe(false);
    expect(item.missingPoints).toBe(380);
  });

  it('treats finite inventory ≤ 0 as out of stock and unlimited as available', () => {
    expect(isOutOfStock({ id: 'a', inventory: 0 })).toBe(true);
    expect(isOutOfStock({ id: 'b', inventory: 3 })).toBe(false);
    expect(isOutOfStock({ id: 'c', inventory: null })).toBe(false);
    expect(isOutOfStock({ id: 'd', inventory: undefined })).toBe(false);
  });

  it('flags archived rewards inactive but keeps them for parent context', () => {
    const shop = buildRewardShop([{ id: 'old', title: 'Old', cost: 10, isActive: false }], 999);
    expect(shop[0].availability).toBe('inactive');
    expect(childVisibleShop(shop)).toHaveLength(0);
  });
});
