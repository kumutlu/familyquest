import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, type AchievementInput } from './achievements';

const badge = (id: string) => {
  const found = ACHIEVEMENTS.find(b => b.id === id);
  if (!found) throw new Error(`missing badge ${id}`);
  return found;
};

const input = (overrides: Partial<AchievementInput> = {}): AchievementInput => ({
  xpTotal: 0,
  rewardPoints: 0,
  longestStreak: 0,
  ...overrides,
});

describe('achievement evaluation uses authoritative XP', () => {
  it('unlocks XP badges from projection xpTotal even when users.lifetimeXP is stale', () => {
    const stale = { xpTotal: 5200, rewardPoints: 0, longestStreak: 0, lifetimeXP: 0 } as AchievementInput;
    expect(badge('first_steps').checkUnlocked(stale)).toBe(true);
    expect(badge('centurion').checkUnlocked(stale)).toBe(true);
    expect(badge('champion').checkUnlocked(stale)).toBe(true);
  });

  it('does not unlock XP badges from stale users.lifetimeXP alone', () => {
    const legacyOnly = { xpTotal: 0, rewardPoints: 0, longestStreak: 0, lifetimeXP: 9999 } as AchievementInput;
    expect(badge('first_steps').checkUnlocked(legacyOnly)).toBe(false);
    expect(badge('centurion').checkUnlocked(legacyOnly)).toBe(false);
    expect(badge('champion').checkUnlocked(legacyOnly)).toBe(false);
  });

  it('keeps the reward-points badge on spendable rewardPoints', () => {
    expect(badge('wealthy').checkUnlocked(input({ rewardPoints: 500, xpTotal: 0 }))).toBe(true);
    expect(badge('wealthy').checkUnlocked(input({ rewardPoints: 499, xpTotal: 99999 }))).toBe(false);
  });

  it('evaluates the viewed member only (no cross-member leakage)', () => {
    const parent = input({ xpTotal: 9000, rewardPoints: 999 });
    const child = input({ xpTotal: 100, rewardPoints: 10 });
    expect(badge('champion').checkUnlocked(parent)).toBe(true);
    expect(badge('champion').checkUnlocked(child)).toBe(false);
    expect(badge('first_steps').checkUnlocked(child)).toBe(true);
  });

  it('treats a missing projection as zero XP rather than unlocking from legacy data', () => {
    const missing = { xpTotal: 0, rewardPoints: 0, longestStreak: 0 } as AchievementInput;
    expect(badge('first_steps').checkUnlocked(missing)).toBe(false);
    expect(badge('champion').checkUnlocked(missing)).toBe(false);
  });

  it('leaves streak badges on longestStreak', () => {
    expect(badge('streak_starter').checkUnlocked(input({ longestStreak: 3 }))).toBe(true);
    expect(badge('streak_master').checkUnlocked(input({ longestStreak: 6 }))).toBe(false);
    expect(badge('streak_master').checkUnlocked(input({ longestStreak: 7 }))).toBe(true);
  });
});
