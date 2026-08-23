import { describe, it, expect } from 'vitest';
import {
  deriveQuestView,
  selectQuestBoard,
  computeTodayProgress,
  type TaskLike,
  type CompletionLike,
} from './board';

const TODAY = new Date(2026, 7, 21, 15, 0, 0); // Friday 2026-08-21, local noon-ish
const SATURDAY = new Date(2026, 7, 22, 15, 0, 0);

function task(overrides: Partial<TaskLike> & { id: string }): TaskLike {
  return { title: overrides.id, pointsReward: 10, type: 'daily', isActive: true, ...overrides };
}

function completion(overrides: Partial<CompletionLike> & { id: string }): CompletionLike {
  return {
    taskId: 't1',
    assigneeId: 'child-1',
    status: 'pending_approval',
    periodKey: '2026-08-21',
    completedAt: TODAY,
    ...overrides,
  } as CompletionLike;
}

describe('deriveQuestView', () => {
  it('treats an inactive task as unavailable', () => {
    const view = deriveQuestView(task({ id: 'a', isActive: false }), [], TODAY, 'child-1');
    expect(view.state).toBe('unavailable');
  });

  it('treats an eligible-day task without completions as available', () => {
    const view = deriveQuestView(task({ id: 'a' }), [], TODAY, 'child-1');
    expect(view.state).toBe('available');
    expect(view.completionId).toBeUndefined();
  });

  it('marks weekday tasks not eligible on weekends', () => {
    const view = deriveQuestView(task({ id: 'a', type: 'weekdays' }), [], SATURDAY, 'child-1');
    expect(view.state).toBe('not_eligible_today');
  });

  it('derives pending approval from the in-period completion record', () => {
    const completions = [completion({ id: 'c1', status: 'pending_approval' })];
    const view = deriveQuestView(task({ id: 't1' }), completions, TODAY, 'child-1');
    expect(view.state).toBe('pending');
    expect(view.completionId).toBe('c1');
  });

  it('derives approved for the current period', () => {
    const completions = [completion({ id: 'c1', status: 'approved' })];
    const view = deriveQuestView(task({ id: 't1' }), completions, TODAY, 'child-1');
    expect(view.state).toBe('approved');
  });

  it('lets a rejected quest be retried and exposes the parent comment', () => {
    const completions = [completion({ id: 'c1', status: 'rejected', parentComment: 'Redo it' })];
    const view = deriveQuestView(task({ id: 't1' }), completions, TODAY, 'child-1');
    expect(view.state).toBe('retry');
    expect(view.parentComment).toBe('Redo it');
  });

  it('ignores completions from a previous period for recurring tasks', () => {
    const completions = [completion({ id: 'c1', status: 'approved', periodKey: '2026-08-20' })];
    const view = deriveQuestView(task({ id: 't1' }), completions, TODAY, 'child-1');
    expect(view.state).toBe('available');
  });

  it('uses explicit periodKey over derived date for weekly tasks', () => {
    const completions = [
      completion({ id: 'c1', status: 'approved', periodKey: 'week:2026-08-17' }),
    ];
    const view = deriveQuestView(task({ id: 't1', type: 'weekly' }), completions, TODAY, 'child-1');
    expect(view.state).toBe('approved');
  });

  it('only considers the current child’s completions for shared tasks', () => {
    const completions = [completion({ id: 'c1', assigneeId: 'child-2', status: 'approved' })];
    const view = deriveQuestView(
      task({ id: 't1', assigneeId: null }),
      completions,
      TODAY,
      'child-1',
    );
    expect(view.state).toBe('available');
  });
});

describe('selectQuestBoard ordering', () => {
  it('never mutates the source arrays', () => {
    const tasks = [task({ id: 'b' }), task({ id: 'a' })];
    const completions = [completion({ id: 'c1' })];
    const frozenTasks = Object.freeze([...tasks]);
    const frozenCompletions = Object.freeze([...completions]);
    selectQuestBoard(frozenTasks as TaskLike[], frozenCompletions as CompletionLike[], TODAY, 'child-1');
    expect(tasks.map(t => t.id)).toEqual(['b', 'a']);
  });

  it('puts a rejected retry ahead of fresh quests', () => {
    const tasks = [task({ id: 'fresh' }), task({ id: 'redo' })];
    const completions = [
      completion({ id: 'c-redo', taskId: 'redo', status: 'rejected', parentComment: 'again' }),
    ];
    const board = selectQuestBoard(tasks, completions, TODAY, 'child-1');
    expect(board.featured?.task.id).toBe('redo');
    expect(board.featured?.state).toBe('retry');
  });

  it('puts assigned quests ahead of shared quests at equal priority', () => {
    const tasks = [task({ id: 'shared', assigneeId: null }), task({ id: 'mine' })];
    const board = selectQuestBoard(tasks, [], TODAY, 'child-1');
    expect(board.featured?.task.id).toBe('mine');
  });

  it('breaks remaining ties deterministically by id', () => {
    const tasks = [task({ id: 'zeta' }), task({ id: 'alpha' })];
    const board = selectQuestBoard(tasks, [], TODAY, 'child-1');
    expect(board.active.map(q => q.task.id)).toEqual(['alpha', 'zeta']);
  });

  it('excludes pending and approved quests from the active list', () => {
    const tasks = [task({ id: 'p' }), task({ id: 'd' }), task({ id: 'live' })];
    const completions = [
      completion({ id: 'cp', taskId: 'p', status: 'pending_approval' }),
      completion({ id: 'cd', taskId: 'd', status: 'approved' }),
    ];
    const board = selectQuestBoard(tasks, completions, TODAY, 'child-1');
    expect(board.active.map(q => q.task.id)).toEqual(['live']);
    expect(board.pending).toHaveLength(1);
    expect(board.done).toHaveLength(1);
  });

  it('excludes archived tasks entirely', () => {
    const tasks = [task({ id: 'gone', isActive: false })];
    const board = selectQuestBoard(tasks, [], TODAY, 'child-1');
    expect(board.active).toHaveLength(0);
  });

  it('caps the initially visible board at four quests', () => {
    const tasks = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => task({ id }));
    const board = selectQuestBoard(tasks, [], TODAY, 'child-1');
    expect(board.initiallyVisible).toHaveLength(4);
    expect(board.moreCount).toBe(2);
  });

  it('hides quests assigned to other children from a child viewer', () => {
    const tasks = [task({ id: 'theirs', assigneeId: 'child-2' })];
    const board = selectQuestBoard(tasks, [], TODAY, 'child-1');
    expect(board.active).toHaveLength(0);
  });

  it('shows every quest when no child scope is given (parent context)', () => {
    const tasks = [task({ id: 'theirs', assigneeId: 'child-2' })];
    const board = selectQuestBoard(tasks, [], TODAY);
    expect(board.active).toHaveLength(1);
  });
});

describe('computeTodayProgress', () => {
  it('counts only confirmed approvals in the numerator', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })];
    const completions = [
      completion({ id: 'ca', taskId: 'a', status: 'approved' }),
      completion({ id: 'cb', taskId: 'b', status: 'pending_approval' }),
    ];
    const progress = computeTodayProgress(tasks, completions, TODAY, 'child-1');
    expect(progress).toEqual({ confirmed: 1, submitted: 1, total: 3 });
  });

  it('includes rejected retries in the denominator but not the numerator', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })];
    const completions = [completion({ id: 'cb', taskId: 'b', status: 'rejected' })];
    const progress = computeTodayProgress(tasks, completions, TODAY, 'child-1');
    expect(progress).toEqual({ confirmed: 0, submitted: 0, total: 2 });
  });

  it('excludes quests that are not eligible today from the denominator', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'weekend-only', type: 'weekends' })];
    const progress = computeTodayProgress(tasks, [], TODAY, 'child-1');
    expect(progress.total).toBe(1);
  });

  it('counts a one-time quest as done forever once approved', () => {
    const tasks = [task({ id: 'once', type: 'one-time' })];
    const completions = [
      completion({ id: 'c1', taskId: 'once', status: 'approved', periodKey: 'one-time' }),
    ];
    const progress = computeTodayProgress(tasks, completions, TODAY, 'child-1');
    // Approved one-time quests leave today's board: 0 actionable remain.
    expect(progress).toEqual({ confirmed: 0, submitted: 0, total: 0 });
  });

  it('returns zero totals while there is nothing actionable', () => {
    const progress = computeTodayProgress([], [], TODAY, 'child-1');
    expect(progress).toEqual({ confirmed: 0, submitted: 0, total: 0 });
  });
});
