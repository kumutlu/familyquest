import { describe, expect, it } from 'vitest';
import {
  countPendingApprovals,
  selectParentPriorities,
  selectChildFocus,
  type ParentPrioritiesInput,
} from './priorities';

const NOW = new Date('2026-08-22T12:00:00Z');
const HOUR_AGO = new Date(NOW.getTime() - 60 * 60 * 1000);

describe('countPendingApprovals', () => {
  it('counts pending items across every request family', () => {
    const input: ParentPrioritiesInput = {
      taskCompletions: [{ id: 'c1', status: 'pending_approval' }],
      transferRequests: [{ id: 't1', status: 'pending' }, { id: 't2', status: 'approved' }],
      moneyRequests: [{ id: 'm1', status: 'pending' }],
      profileUpdateRequests: [],
      goalRequests: [{ id: 'g1', status: 'pending' }],
      childJoinRequests: [{ id: 'j1', status: 'pending' }],
    };
    expect(countPendingApprovals(input)).toBe(5);
  });

  it('excludes petbox requests while the feature is disabled', () => {
    const input: ParentPrioritiesInput = {
      petboxRequests: [{ id: 'p1', status: 'pending' }],
      petBoxEnabled: false,
    };
    expect(countPendingApprovals(input)).toBe(0);
  });

  it('includes petbox requests while the feature is enabled', () => {
    const input: ParentPrioritiesInput = {
      petboxRequests: [{ id: 'p1', status: 'pending' }],
      petBoxEnabled: true,
    };
    expect(countPendingApprovals(input)).toBe(1);
  });
});

describe('selectParentPriorities', () => {
  it('surfaces approvals first with their count', () => {
    const result = selectParentPriorities(
      {
        taskCompletions: [
          { id: 'c1', status: 'pending_approval' },
          { id: 'c2', status: 'pending_approval' },
          { id: 'c3', status: 'approved' },
        ],
      },
      NOW,
    );
    expect(result[0]).toMatchObject({ kind: 'approvals', count: 2 });
  });

  it('returns at most three deterministic items', () => {
    const result = selectParentPriorities(
      {
        taskCompletions: [{ id: 'c1', status: 'pending_approval' }],
        savingsGoals: [
          { goalId: 'g1', title: 'Bike', status: 'active', currentAmountPence: 900, targetAmountPence: 1000 },
        ],
        challenges: [{ id: 'ch1', title: 'Clean week', status: 'completed' }],
        walletTransactions: [
          { id: 'w1', type: 'deposit', amount: 500, timestamp: HOUR_AGO.toISOString(), childId: 'kid-1' },
        ],
      },
      NOW,
    );
    expect(result.map(item => item.kind)).toEqual([
      'approvals',
      'goal_milestone',
      'challenge_update',
    ]);
  });

  it('picks the highest-progress goal milestone', () => {
    const result = selectParentPriorities(
      {
        savingsGoals: [
          { goalId: 'g-low', title: 'Low', status: 'active', currentAmountPence: 800, targetAmountPence: 1000 },
          { goalId: 'g-high', title: 'High', status: 'active', currentAmountPence: 950, targetAmountPence: 1000 },
          { goalId: 'g-done', title: 'Done', status: 'completed', currentAmountPence: 1000, targetAmountPence: 1000 },
        ],
      },
      NOW,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'goal_milestone', goalId: 'g-high', progressPct: 95 });
  });

  it('ignores goals below the milestone threshold', () => {
    const result = selectParentPriorities(
      {
        savingsGoals: [
          { goalId: 'g1', title: 'Early days', status: 'active', currentAmountPence: 100, targetAmountPence: 1000 },
        ],
      },
      NOW,
    );
    expect(result).toHaveLength(0);
  });

  it('only counts recent deposits as wallet events', () => {
    const twoDaysAgo = new Date(NOW.getTime() - 48 * 60 * 60 * 1000);
    const result = selectParentPriorities(
      {
        walletTransactions: [
          { id: 'old', type: 'deposit', amount: 900, timestamp: twoDaysAgo.toISOString() },
        ],
      },
      NOW,
    );
    expect(result).toHaveLength(0);
  });

  it('never mutates its input arrays', () => {
    const input = {
      taskCompletions: [{ id: 'c1', status: 'pending_approval' }],
      savingsGoals: [{ goalId: 'g1', title: 'Bike', status: 'active', currentAmountPence: 900, targetAmountPence: 1000 }],
    };
    const snapshot = JSON.stringify(input);
    selectParentPriorities(input, NOW);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('is deterministic across repeated calls', () => {
    const input: ParentPrioritiesInput = {
      taskCompletions: [{ id: 'a', status: 'pending_approval' }, { id: 'b', status: 'pending_approval' }],
      challenges: [{ id: 'ch1', title: 'X', status: 'completed' }],
    };
    expect(selectParentPriorities(input, NOW)).toEqual(selectParentPriorities(input, NOW));
  });
});

describe('selectChildFocus', () => {
  const CHILD = { id: 'kid-1', rewardPoints: 120 };

  it('returns nothing without a current user', () => {
    expect(selectChildFocus({ currentUser: null }, NOW)).toEqual([]);
  });

  it('prioritises own pending approvals over everything else', () => {
    const result = selectChildFocus(
      {
        currentUser: CHILD,
        taskCompletions: [
          { id: 'c1', childId: 'kid-1', status: 'pending_approval', completedAt: HOUR_AGO },
          { id: 'c2', childId: 'kid-2', status: 'pending_approval', completedAt: HOUR_AGO },
        ],
        tasks: [{ id: 't1', assigneeId: 'kid-1', isActive: true, title: 'Dishes' }],
      },
      NOW,
    );
    expect(result[0]?.kind).toBe('approval_waiting');
    expect(result[0]?.count).toBe(1);
  });

  it('shows the next incomplete assigned quest', () => {
    const result = selectChildFocus(
      {
        currentUser: CHILD,
        tasks: [
          { id: 't-done', assigneeId: 'kid-1', isActive: true, title: 'Already done today' },
          { id: 't-next', assigneeId: 'kid-1', isActive: true, title: 'Brush teeth', pointsReward: 10 },
        ],
        taskCompletions: [
          {
            id: 'c1',
            childId: 'kid-1',
            taskId: 't-done',
            status: 'approved',
            completedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
          },
        ],
      },
      NOW,
    );
    expect(result.filter(item => item.kind === 'next_quest')).toEqual([
      expect.objectContaining({ kind: 'next_quest', taskId: 't-next', taskTitle: 'Brush teeth' }),
    ]);
  });

  it('flags a live streak that is at risk today', () => {
    const result = selectChildFocus(
      {
        currentUser: CHILD,
        gamificationSummary: { currentStreak: 6 },
        dailyProgress: { dailyGoalReached: false },
      },
      NOW,
    );
    expect(result.some(item => item.kind === 'streak_keep' && item.streakDays === 6)).toBe(true);
  });

  it('does not nag about the streak once today’s goal is reached', () => {
    const result = selectChildFocus(
      {
        currentUser: CHILD,
        gamificationSummary: { currentStreak: 6 },
        dailyProgress: { dailyGoalReached: true },
      },
      NOW,
    );
    expect(result.some(item => item.kind === 'streak_keep')).toBe(false);
  });

  it('surfaces an affordable reward', () => {
    const result = selectChildFocus(
      {
        currentUser: CHILD,
        rewards: [
          { id: 'r-cheap', title: 'Sticker', pointsCost: 50 },
          { id: 'r-best', title: 'Movie night', pointsCost: 120 },
          { id: 'r-rich', title: 'Bike', pointsCost: 5000 },
        ],
      },
      NOW,
    );
    expect(result.find(item => item.kind === 'reward_available')).toMatchObject({
      rewardId: 'r-best',
    });
  });

  it('caps at three items with approvals ranked first', () => {
    const result = selectChildFocus(
      {
        currentUser: CHILD,
        taskCompletions: [{ id: 'c1', childId: 'kid-1', status: 'pending_approval', completedAt: HOUR_AGO }],
        tasks: [{ id: 't1', assigneeId: 'kid-1', isActive: true, title: 'Dishes', pointsReward: 5 }],
        rewards: [{ id: 'r1', title: 'Sticker', pointsCost: 50 }],
        challenges: [{ id: 'ch1', title: 'Family quest', status: 'active' }],
        gamificationSummary: { currentStreak: 3 },
        dailyProgress: { dailyGoalReached: false },
      },
      NOW,
    );
    expect(result).toHaveLength(3);
    expect(result[0]?.kind).toBe('approval_waiting');
    expect(result.map(item => item.kind)).not.toContain('family_quest');
  });
});
