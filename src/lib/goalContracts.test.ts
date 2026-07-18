import { describe, it, expect } from 'vitest';
import {
  computeNetChild,
  computeMatchPence,
  normalizeGoalDoc,
  requestHashOf,
  goalContributionKey,
  goalWithdrawalKey,
  goalMatchKey,
  type ContributionLeg,
  type MatchingPolicy,
} from './goalContracts';

const applied = (over: Partial<ContributionLeg>): ContributionLeg => ({
  type: 'child_contribution',
  ownerType: 'child',
  ownerId: 'child1',
  amountPence: 0,
  status: 'applied',
  ...over,
});

describe('computeNetChild', () => {
  it('sums only child_contribution for the owner', () => {
    const legs: ContributionLeg[] = [
      applied({ type: 'child_contribution', ownerId: 'child1', amountPence: 500 }),
      applied({ type: 'child_contribution', ownerId: 'child1', amountPence: 250 }),
      applied({ type: 'child_contribution', ownerId: 'child2', amountPence: 999 }),
    ];
    expect(computeNetChild(legs, 'child1')).toBe(750);
  });

  it('subtracts child_withdrawal and completion_refund for the owner', () => {
    const legs: ContributionLeg[] = [
      applied({ type: 'child_contribution', ownerId: 'child1', amountPence: 1000 }),
      applied({ type: 'child_withdrawal', ownerId: 'child1', amountPence: -300 }),
      applied({ type: 'completion_refund', ownerId: 'child1', amountPence: -200 }),
    ];
    expect(computeNetChild(legs, 'child1')).toBe(500);
  });

  it('ignores parent and match contributions and external_closure', () => {
    const legs: ContributionLeg[] = [
      applied({ type: 'child_contribution', ownerId: 'child1', amountPence: 1000 }),
      applied({ type: 'parent_contribution', ownerType: 'parent', ownerId: 'parent1', amountPence: 400 }),
      applied({ type: 'auto_match', ownerType: 'parent', ownerId: 'parent1', amountPence: 200 }),
      applied({ type: 'manual_match', ownerType: 'parent', ownerId: 'parent1', amountPence: 100 }),
      applied({ type: 'external_closure', ownerType: 'parent', ownerId: 'parent1', amountPence: -700 }),
    ];
    expect(computeNetChild(legs, 'child1')).toBe(1000);
  });

  it('excludes non-applied legs', () => {
    const legs: ContributionLeg[] = [
      applied({ type: 'child_contribution', ownerId: 'child1', amountPence: 1000, status: 'pending' }),
      applied({ type: 'child_contribution', ownerId: 'child1', amountPence: 1000, status: 'reversed' }),
    ];
    expect(computeNetChild(legs, 'child1')).toBe(0);
  });
});

describe('computeMatchPence', () => {
  const auto: MatchingPolicy = { mode: 'auto', perX: 100, matchY: 50 };

  it('computes floor(childAmount/perX)*matchY', () => {
    expect(computeMatchPence(100, auto)).toBe(50);
    expect(computeMatchPence(250, auto)).toBe(100);
    expect(computeMatchPence(99, auto)).toBe(0);
  });

  it('respects capPence', () => {
    const capped: MatchingPolicy = { mode: 'auto', perX: 100, matchY: 50, capPence: 80 };
    expect(computeMatchPence(500, capped)).toBe(80);
  });

  it('returns 0 for none and manual modes', () => {
    expect(computeMatchPence(100, { mode: 'none', perX: 100, matchY: 50 })).toBe(0);
    expect(computeMatchPence(100, { mode: 'manual', perX: 100, matchY: 50 })).toBe(0);
  });
});

describe('normalizeGoalDoc', () => {
  it('maps legacy major-unit fields to pence and applies defaults', () => {
    const norm = normalizeGoalDoc({
      childId: 'c1',
      title: 'Bike',
      targetAmount: 10,
      currentAmount: 5,
    });
    expect(norm.targetAmountPence).toBe(1000);
    expect(norm.currentAmountPence).toBe(500);
    expect(norm.kind).toBe('child');
    expect(norm.status).toBe('active');
    expect(norm.currency).toBe('GBP');
    expect(norm.version).toBe(1);
  });

  it('prefers v1 pence fields when present', () => {
    const norm = normalizeGoalDoc({
      title: 'Trip',
      kind: 'family',
      targetAmountPence: 2000,
      currentAmountPence: 0,
      status: 'reached',
      currency: 'GBP',
      version: 1,
    });
    expect(norm.targetAmountPence).toBe(2000);
    expect(norm.kind).toBe('family');
    expect(norm.status).toBe('reached');
  });

  it('does not mutate the source document', () => {
    const src = { childId: 'c1', title: 'X', targetAmount: 1, currentAmount: 0 } as Record<string, unknown>;
    normalizeGoalDoc(src);
    expect(src).toEqual({ childId: 'c1', title: 'X', targetAmount: 1, currentAmount: 0 });
  });
});

describe('requestHashOf', () => {
  it('is deterministic for the same payload', () => {
    const a = requestHashOf({ goalId: 'g1', amountPence: 100, childId: 'c1' });
    const b = requestHashOf({ goalId: 'g1', amountPence: 100, childId: 'c1' });
    expect(a).toBe(b);
  });

  it('differs for different payloads regardless of key order', () => {
    const a = requestHashOf({ goalId: 'g1', amountPence: 100, childId: 'c1' });
    const b = requestHashOf({ childId: 'c1', amountPence: 100, goalId: 'g1' });
    const c = requestHashOf({ goalId: 'g1', amountPence: 200, childId: 'c1' });
    expect(a).toBe(b); // key order must not matter
    expect(a).not.toBe(c);
  });
});

describe('idempotency keys', () => {
  it('are deterministic and unique per id', () => {
    expect(goalContributionKey('g1', 'r1')).toBe('goalContribution:g1:r1');
    expect(goalWithdrawalKey('g1', 'r1')).toBe('goalWithdrawal:g1:r1');
    expect(goalMatchKey('p1', 'r1')).toBe('goalMatch:p1:r1');
    expect(goalContributionKey('g1', 'r1')).not.toBe(goalContributionKey('g1', 'r2'));
  });
});
