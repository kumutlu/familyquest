import { describe, it, expect } from 'vitest'
import { mapTaskApproval, type TaskApprovalSource } from './taskMapper'

describe('taskMapper', () => {
  it('maps a task approval to a TASK_APPROVED event', () => {
    const source: TaskApprovalSource = {
      familyId: 'family-1',
      memberId: 'member-1',
      taskId: 'task-1',
      logicalCompletionKey: 'member-1:task-1:2026-W02',
      pointsReward: 5,
      xpAward: 5,
      approvedAt: '2026-01-05T10:00:00.000Z',
      createdAt: '2026-01-05T10:00:00.000Z',
    }
    const event = mapTaskApproval(source)
    expect(event.eventType).toBe('TASK_APPROVED')
    expect(event.eventId).toBe('task-approved:family-1:member-1:member-1:task-1:2026-W02')
    expect(event.rewardPointsDelta).toBe(5)
    expect(event.xpDelta).toBe(5)
    expect(event.weeklyPointsDelta).toBe(5)
    expect(event.metadata.taskId).toBe('task-1')
  })
})