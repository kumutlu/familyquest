import { describe, expect, it } from 'vitest'
import {
  authoritativePeriodKey,
  buildDailyEligibilitySnapshot,
  isTaskEligibleForDay,
  taskIsAwardableForChild,
  type RepositoryScheduledTask,
} from './dailyEligibilityAdapter'

const DAY = '2026-07-23'
const createdYesterday = Date.parse('2026-07-22T10:00:00Z')

function task(overrides: Partial<RepositoryScheduledTask> = {}): RepositoryScheduledTask {
  return {
    id: 'task-1', assigneeId: 'child-1', pointsReward: 20, requiresApproval: true,
    type: 'daily', isActive: true, createdAt: createdYesterday, ...overrides,
  }
}

describe('dailyEligibilityAdapter', () => {
  it('freezes only active assigned due positive-weight tasks in effective range', () => {
    const snapshot = buildDailyEligibilitySnapshot({
      familyId: 'family-1', childId: 'child-1', dayKey: DAY, timezone: 'Europe/London',
      dailyGoalPercentage: 80, effectiveAt: Date.parse('2026-07-23T00:00:00Z'), createdAt: Date.parse('2026-07-23T00:05:00Z'),
      tasks: [
        task(), task({ id: 'other-child', assigneeId: 'child-2' }), task({ id: 'inactive', isActive: false }),
        task({ id: 'archived', status: 'archived' }), task({ id: 'zero', pointsReward: 0 }),
        task({ id: 'future', effectiveFrom: '2026-07-24' }), task({ id: 'ended', effectiveTo: '2026-07-22' }),
      ],
    })
    expect(snapshot.taskWeights).toEqual({ 'task-1': 20 })
    expect(snapshot).toMatchObject({ eligibleTaskCount: 1, eligiblePoints: 20, transitionRank: 0 })
  })

  it('makes a daily task created today eligible the same day (P0 fix)', () => {
    const today = task({ createdAt: Date.parse('2026-07-23T09:00:00Z') })
    // A task created on the local creation day must be eligible that same day so a
    // parent-created task can be completed and approved immediately.
    expect(isTaskEligibleForDay(today, 'child-1', DAY, 'Europe/London')).toBe(true)
    expect(isTaskEligibleForDay(today, 'child-1', '2026-07-24', 'Europe/London')).toBe(true)
    // A task is still NOT eligible on a day before it existed.
    expect(isTaskEligibleForDay(today, 'child-1', '2026-07-22', 'Europe/London')).toBe(false)
  })

  it.each([
    ['weekdays', '2026-07-24', true], ['weekdays', '2026-07-25', false],
    ['weekends', '2026-07-25', true], ['weekends', '2026-07-24', false],
  ])('applies %s due-day semantics', (type, dayKey, expected) => {
    expect(isTaskEligibleForDay(task({ type }), 'child-1', dayKey, 'Europe/London')).toBe(expected)
  })

  it('uses one configured due weekday for weekly tasks and one due date for one-time tasks', () => {
    expect(isTaskEligibleForDay(task({ type: 'weekly', dueWeekday: 4 }), 'child-1', DAY, 'Europe/London')).toBe(true)
    expect(isTaskEligibleForDay(task({ type: 'weekly', dueWeekday: 1 }), 'child-1', DAY, 'Europe/London')).toBe(false)
    expect(isTaskEligibleForDay(task({ type: 'one-time', dueDate: DAY }), 'child-1', DAY, 'Europe/London')).toBe(true)
    expect(isTaskEligibleForDay(task({ type: 'one-time', dueDate: '2026-07-24' }), 'child-1', DAY, 'Europe/London')).toBe(false)
  })

  it('derives authoritative occurrence keys without trusting a client period key', () => {
    expect(authoritativePeriodKey(task({ type: 'daily' }), DAY)).toBe(DAY)
    expect(authoritativePeriodKey(task({ type: 'weekly' }), DAY)).toBe('week:2026-07-20')
    expect(authoritativePeriodKey(task({ type: 'one-time', dueDate: DAY }), DAY)).toBe(`one-time:${DAY}`)
  })

  it('rejects unsafe rewards rather than silently changing the denominator', () => {
    expect(() => buildDailyEligibilitySnapshot({
      familyId: 'family-1', childId: 'child-1', dayKey: DAY, timezone: 'Europe/London', dailyGoalPercentage: 80,
      effectiveAt: 1, createdAt: 2, tasks: [task({ pointsReward: Number.NaN })],
    })).toThrow(/reward/i)
  })

  it('treats a task without an assignee as shared with every child in the family', () => {
    const shared = task({ id: 'shared', assigneeId: undefined })
    expect(taskIsAwardableForChild(shared, 'child-1')).toBe(true)
    expect(taskIsAwardableForChild(shared, 'child-2')).toBe(true)
    expect(taskIsAwardableForChild(task(), 'child-1')).toBe(true)
    expect(taskIsAwardableForChild(task(), 'child-2')).toBe(false)
    expect(isTaskEligibleForDay(shared, 'child-2', DAY, 'Europe/London')).toBe(true)
  })

  it('includes shared tasks in taskWeights without including other children tasks', () => {
    const snapshot = buildDailyEligibilitySnapshot({
      familyId: 'family-1', childId: 'child-1', dayKey: DAY, timezone: 'Europe/London',
      dailyGoalPercentage: 80, effectiveAt: Date.parse('2026-07-23T00:00:00Z'), createdAt: Date.parse('2026-07-23T00:05:00Z'),
      tasks: [task(), task({ id: 'shared', assigneeId: undefined }), task({ id: 'other', assigneeId: 'child-2' })],
    })
    expect(snapshot.taskWeights).toEqual({ 'shared': 20, 'task-1': 20 })
    expect(snapshot).toMatchObject({ eligibleTaskCount: 2, eligiblePoints: 40 })
  })

  it('returns an immutable zero denominator when no positive-weight task is eligible', () => {
    const snapshot = buildDailyEligibilitySnapshot({
      familyId: 'family-1', childId: 'child-1', dayKey: DAY, timezone: 'Europe/London', dailyGoalPercentage: 80,
      effectiveAt: 1, createdAt: 2, tasks: [task({ pointsReward: 0 })],
    })
    expect(snapshot).toMatchObject({ taskWeights: {}, eligibleTaskCount: 0, eligiblePoints: 0 })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.taskWeights)).toBe(true)
  })
})
