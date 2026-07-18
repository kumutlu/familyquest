import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RecentActivity } from './RecentActivity'

const openRequest = vi.fn()

vi.mock('../../requests/RequestDetailContext', () => ({
  useRequestDetail: () => ({ openRequest }),
}))

const moneyRequest = {
  id: 'mr-1',
  category: 'money_request',
  requesterId: 'child-1',
  requesterName: 'Mnalium',
  requestedFromId: 'parent-1',
  requestedFromName: 'Kemal',
  requestedFromRole: 'parent',
  amountPence: 556,
  message: 'Can I put this on my card',
  status: 'pending_acceptance',
  createdAt: { toDate: () => new Date() },
}

vi.mock('../../../store/useStore', () => ({
  useStore: () => ({
    feed: [
      { id: 'f1', type: 'money', text: 'Mnalium requested £5.56 from Kemal.', entityType: 'money_request', entityId: 'mr-1', timestamp: { toMillis: () => 1000 } },
      { id: 'f2', type: 'money', text: 'Legacy request with no entity id.', timestamp: { toMillis: () => 900 } },
      { id: 'f3', type: 'money', text: 'Deleted request reference.', entityType: 'money_request', entityId: 'missing', timestamp: { toMillis: () => 800 } },
    ],
    moneyRequests: [moneyRequest],
    transferRequests: [], profileUpdateRequests: [], redemptions: [], taskCompletions: [], petboxRequests: [],
  }),
}))

describe('Recent Family Activity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the section heading', () => {
    render(<RecentActivity />)
    expect(screen.getByText('Recent Family Activity')).toBeInTheDocument()
  })

  it('makes a request activity row tappable and opens the shared detail modal by entity id', () => {
    render(<RecentActivity />)
    const row = screen.getByText('Mnalium requested £5.56 from Kemal.')
    const button = row.closest('button')
    expect(button).toBeTruthy()
    fireEvent.click(button!)
    expect(openRequest).toHaveBeenCalledTimes(1)
    const arg = openRequest.mock.calls[0][0]
    expect(arg.id).toBe('mr-1')
    expect(arg.category).toBe('money_request')
  })

  it('shows a "View request" affordance for tappable rows', () => {
    render(<RecentActivity />)
    expect(screen.getByText('View request')).toBeInTheDocument()
  })

  it('does not make legacy (no entityId) activity tappable', () => {
    render(<RecentActivity />)
    const row = screen.getByText('Legacy request with no entity id.')
    expect(row.closest('button')).toBeNull()
  })

  it('does not crash and is not tappable for a deleted request reference', () => {
    render(<RecentActivity />)
    const row = screen.getByText('Deleted request reference.')
    expect(row.closest('button')).toBeNull()
    expect(screen.getByText('Recent Family Activity')).toBeInTheDocument()
  })
})
