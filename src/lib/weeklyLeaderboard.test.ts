import { describe, expect, it } from 'vitest';
import { buildWeeklyLeaderboardHistory } from './weeklyLeaderboard';

const members = [
  { id: 'child-a', displayName: 'Ada', role: 'child' },
  { id: 'child-b', displayName: 'Ben', role: 'child' },
];

const tasks = [
  { id: 'task-10', pointsReward: 10 },
  { id: 'task-25', pointsReward: 25 },
];

const timestamp = (value: Date) => ({ toDate: () => value });
const completion = (id: string, assigneeId: string, taskId: string, approvedAt: Date) => ({
  id,
  assigneeId,
  taskId,
  status: 'approved',
  approvedAt: timestamp(approvedAt),
});

describe('buildWeeklyLeaderboardHistory', () => {
  it('builds one previous week using the existing task-point ranking', () => {
    const history = buildWeeklyLeaderboardHistory({
      members,
      tasks,
      taskCompletions: [completion('c1', 'child-a', 'task-25', new Date(2026, 7, 5, 12))],
      currentWeekKey: '2026-08-10',
    });

    expect(history).toHaveLength(1);
    expect(history[0].weekKey).toBe('2026-08-03');
    expect(history[0].rankings.map(member => [member.id, member.weeklyXP])).toEqual([
      ['child-a', 25],
      ['child-b', 0],
    ]);
  });

  it('returns multiple previous weeks newest first', () => {
    const history = buildWeeklyLeaderboardHistory({
      members,
      tasks,
      taskCompletions: [
        completion('old', 'child-a', 'task-10', new Date(2026, 6, 20, 12)),
        completion('new', 'child-b', 'task-25', new Date(2026, 7, 4, 12)),
      ],
      currentWeekKey: '2026-08-10',
    });

    expect(history.map(week => week.weekKey)).toEqual(['2026-08-03', '2026-07-20']);
  });

  it('excludes the current week from History', () => {
    const history = buildWeeklyLeaderboardHistory({
      members,
      tasks,
      taskCompletions: [
        completion('past', 'child-a', 'task-10', new Date(2026, 7, 9, 12)),
        completion('current', 'child-b', 'task-25', new Date(2026, 7, 10, 12)),
      ],
      currentWeekKey: '2026-08-10',
    });

    expect(history.map(week => week.weekKey)).toEqual(['2026-08-03']);
  });

  it('separates Sunday and Monday at the local timezone boundary', () => {
    const history = buildWeeklyLeaderboardHistory({
      members,
      tasks,
      taskCompletions: [
        completion('sunday', 'child-a', 'task-10', new Date(2026, 7, 16, 23, 59, 59)),
        completion('monday', 'child-b', 'task-25', new Date(2026, 7, 17, 0, 0, 0)),
      ],
      currentWeekKey: '2026-08-24',
    });

    expect(history.map(week => week.weekKey)).toEqual(['2026-08-17', '2026-08-10']);
    expect(history[0].rankings[0]).toMatchObject({ id: 'child-b', weeklyXP: 25 });
    expect(history[1].rankings[0]).toMatchObject({ id: 'child-a', weeklyXP: 10 });
  });

  it('returns empty history when there are no approved past completions', () => {
    const history = buildWeeklyLeaderboardHistory({
      members,
      tasks,
      taskCompletions: [],
      currentWeekKey: '2026-08-10',
    });

    expect(history).toEqual([]);
  });
});
