import { describe, expect, it } from 'vitest';
import { selectFeaturedChildGoal } from './childFamilyTools';

describe('selectFeaturedChildGoal', () => {
  it('selects the closest active family goal from the child-visible goal set', () => {
    const result = selectFeaturedChildGoal([
      { id: 'family-low', title: 'Holiday', kind: 'family', status: 'active', currentAmountPence: 200, targetAmountPence: 1_000 },
      { id: 'family-high', title: 'Robin Hood card', kind: 'family', status: 'active', currentAmountPence: 750, targetAmountPence: 1_000 },
    ]);

    expect(result?.id).toBe('family-high');
    expect(result?.progressPercent).toBe(75);
  });

  it('allows the current child own goal and excludes a sibling-private goal defensively', () => {
    const result = selectFeaturedChildGoal([
      { id: 'mine', title: 'My bike', kind: 'child', childId: 'child-1', status: 'active', currentAmountPence: 600, targetAmountPence: 1_000 },
      { id: 'sibling', title: 'Sibling console', kind: 'child', childId: 'child-2', status: 'active', currentAmountPence: 950, targetAmountPence: 1_000 },
    ], 'child-1');

    expect(result?.id).toBe('mine');
    expect(result?.context).toBe('mine');
  });

  it('ignores completed and cancelled goals', () => {
    expect(selectFeaturedChildGoal([
      { id: 'done', title: 'Done', kind: 'family', status: 'completed_purchased', currentAmountPence: 1_000, targetAmountPence: 1_000 },
      { id: 'cancelled', title: 'Cancelled', kind: 'family', status: 'cancelled', currentAmountPence: 900, targetAmountPence: 1_000 },
    ])).toBeNull();
  });
});
