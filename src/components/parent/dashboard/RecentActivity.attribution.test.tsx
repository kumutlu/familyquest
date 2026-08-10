import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RecentActivity } from './RecentActivity'
import i18n from '../../../i18n/config'

vi.mock('../../requests/RequestDetailContext', () => ({
  useRequestDetail: () => ({ openRequest: vi.fn() }),
}))

vi.mock('../../../store/useStore', () => ({
  useStore: () => ({
    feed: [
      {
        id: 'task_approval_c1',
        type: 'task',
        text: 'Task approved: House Vacuum (+40 pts)',
        actorId: 'parent-1',
        actorName: 'Kemal',
        timestamp: { toMillis: () => 2000, toDate: () => new Date() },
      },
      {
        id: 'task_approval_c2',
        type: 'task',
        text: 'Task approved: House Vacuum (+40 pts)',
        actorId: 'parent-1',
        actorName: 'Kemal',
        timestamp: { toMillis: () => 1000, toDate: () => new Date() },
      },
      { id: 'legacy', type: 'custom', text: 'Something else happened.', timestamp: { toMillis: () => 500 } },
    ],
    moneyRequests: [], transferRequests: [], profileUpdateRequests: [], redemptions: [], petboxRequests: [],
    taskCompletions: [
      { id: 'c1', taskId: 'task-1', assigneeId: 'child-1', awardedPoints: 40 },
      { id: 'c2', taskId: 'task-1', assigneeId: 'child-2', awardedPoints: 40 },
    ],
    tasks: [{ id: 'task-1', title: 'House Vacuum', pointsReward: 40 }],
    familyMembers: [
      { id: 'child-1', displayName: 'Osman' },
      { id: 'child-2', displayName: 'Alisya' },
      { id: 'parent-1', displayName: 'Kemal' },
    ],
  }),
}))

describe('Recent Family Activity attribution', () => {
  beforeEach(async () => {
    await i18n.loadNamespaces(['dashboard'])
    await i18n.changeLanguage('en')
  })

  it('names the child who completed the task, not just the approver', () => {
    render(<RecentActivity />)
    expect(screen.getByText('Osman completed')).toBeInTheDocument()
    expect(screen.getAllByText('House Vacuum')).toHaveLength(2)
    expect(screen.getAllByText('Approved by Kemal').length).toBe(2)
  })

  it('distinguishes two children completing the same task', () => {
    render(<RecentActivity />)
    expect(screen.getByText('Alisya completed')).toBeInTheDocument()
    expect(screen.getAllByText('House Vacuum')).toHaveLength(2)
  })

  it('shows the points awarded', () => {
    render(<RecentActivity />)
    expect(screen.getAllByText('+40 Points').length).toBe(2)
  })

  it('keeps legacy rows readable', () => {
    render(<RecentActivity />)
    expect(screen.getByText('Something else happened.')).toBeInTheDocument()
  })
})
