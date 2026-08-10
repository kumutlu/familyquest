import { describe, it, expect } from 'vitest';
import {
  attributeFeedItem,
  attributeHistorySource,
  completionIdFromFeedItem,
  pointsFromText,
  toDateValue,
} from './activityAttribution';

const pools = {
  familyMembers: [
    { id: 'child-1', displayName: 'Osman' },
    { id: 'child-2', displayName: 'Alisya' },
    { id: 'parent-1', displayName: 'Kemal' },
  ],
  tasks: [{ id: 'task-1', title: 'House Vacuum', pointsReward: 40 }],
  taskCompletions: [
    { id: 'c1', taskId: 'task-1', assigneeId: 'child-1', awardedPoints: 40 },
    { id: 'c2', taskId: 'task-1', assigneeId: 'child-2' },
  ],
};

describe('activity attribution', () => {
  it('extracts the completion id from an approval feed document id', () => {
    expect(completionIdFromFeedItem({ id: 'task_approval_c1' })).toBe('c1');
    expect(completionIdFromFeedItem({ id: 'random' })).toBeNull();
    expect(completionIdFromFeedItem({ entityType: 'task_completion', entityId: 'c2' })).toBe('c2');
  });

  it('names the child who completed the task and the parent who approved it', () => {
    const attribution = attributeFeedItem(
      { id: 'task_approval_c1', actorId: 'parent-1', actorName: 'Kemal', text: 'Task approved: House Vacuum (+40 pts)' },
      pools,
    );
    expect(attribution).toMatchObject({
      subjectId: 'child-1',
      subjectName: 'Osman',
      approverName: 'Kemal',
      taskTitle: 'House Vacuum',
      points: 40,
    });
  });

  it('distinguishes two children completing the same task', () => {
    const first = attributeFeedItem({ id: 'task_approval_c1', actorName: 'Kemal' }, pools);
    const second = attributeFeedItem({ id: 'task_approval_c2', actorName: 'Kemal' }, pools);
    expect(first.subjectName).toBe('Osman');
    expect(second.subjectName).toBe('Alisya');
    expect(second.points).toBe(40); // falls back to the task reward
  });

  it('never claims the actor approved their own activity', () => {
    const attribution = attributeFeedItem({ actorId: 'child-1', actorName: 'Osman', childId: 'child-1' }, pools);
    expect(attribution.approverName).toBeUndefined();
    expect(attribution.subjectName).toBe('Osman');
  });

  it('degrades gracefully for legacy feed rows', () => {
    expect(attributeFeedItem({ id: 'legacy', text: 'Something happened' }, pools)).toEqual({});
  });

  it('parses points out of legacy activity text', () => {
    expect(pointsFromText('Task approved: X (+40 pts)')).toBe(40);
    expect(pointsFromText('Logged behaviour (-15 pts)')).toBe(-15);
    expect(pointsFromText('no numbers here')).toBeUndefined();
  });

  it('attributes a reversible history source to its member and task', () => {
    const attribution = attributeHistorySource(
      'task_completion',
      { id: 'c2', taskId: 'task-1', assigneeId: 'child-2', reviewedByName: 'Kemal' },
      pools,
    );
    expect(attribution).toMatchObject({
      subjectName: 'Alisya',
      taskTitle: 'House Vacuum',
      approverName: 'Kemal',
      points: 40,
    });
  });

  it('normalises timestamp shapes', () => {
    const date = new Date('2026-07-13T10:00:00Z');
    expect(toDateValue({ toDate: () => date })).toEqual(date);
    expect(toDateValue(date)).toEqual(date);
    expect(toDateValue(undefined)).toBeNull();
    expect(toDateValue('not-a-date')).toBeNull();
  });
});
