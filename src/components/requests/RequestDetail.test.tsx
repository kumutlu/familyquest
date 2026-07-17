import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RequestCard } from './RequestCard'
import { RequestStatusBadge } from './RequestStatusBadge'
import { RequestDetailSheet } from './RequestDetailSheet'
import { normalizeRequest, type NormalizedRequest, type RequestContext } from '../../lib/requestModel'

const api = vi.hoisted(() => ({
  approveTaskCompletion: vi.fn(),
  rejectTaskCompletion: vi.fn(),
  approveTransferRequest: vi.fn(),
  rejectTransferRequest: vi.fn(),
  approveMoneyRequest: vi.fn(),
  rejectMoneyRequest: vi.fn(),
  approvePetBoxDonation: vi.fn(),
  rejectPetBoxDonation: vi.fn(),
  approveProfileUpdateRequest: vi.fn(),
  rejectProfileUpdateRequest: vi.fn(),
  cancelPendingApproval: vi.fn(),
}))

const storeState = vi.hoisted(() => ({ current: {} as any }))

vi.mock('../../lib/api', () => api)
vi.mock('../../store/useStore', () => ({
  useStore: (selector?: any) =>
    typeof selector === 'function' ? selector(storeState.current) : storeState.current,
}))

const ctx: RequestContext = {
  currency: '£',
  resolveMember: id => {
    const map: Record<string, { id: string; name: string; avatarUrl?: string; role?: string }> = {
      'child-1': { id: 'child-1', name: 'Mnalium', role: 'child' },
      'child-2': { id: 'child-2', name: 'Ben', role: 'child' },
      'parent-1': { id: 'parent-1', name: 'Kemal', avatarUrl: 'https://kemal', role: 'parent' },
    }
    return map[id as string]
  },
  resolveTask: () => ({ title: 'Tidy room', pointsReward: 10 }),
  rewards: { 'rw-1': { title: 'Extra screen time' } },
}

const moneyRequestRaw = {
  id: 'm1',
  category: 'money_request',
  requesterId: 'child-1',
  requesterName: 'Mnalium',
  requestedFromId: 'parent-1',
  requestedFromName: 'Kemal',
  requestedFromRole: 'parent',
  amountPence: 556,
  message: 'Can I put this on my card',
  status: 'pending',
  createdAt: { toDate: () => new Date('2026-07-15T14:24:00Z') },
}

const transferRaw = {
  id: 't1',
  category: 'transfer',
  fromChildId: 'child-1',
  toChildId: 'child-2',
  fromChildName: 'Mnalium',
  toChildName: 'Ben',
  amountPence: 200,
  message: 'For the game',
  status: 'pending',
  createdAt: { toDate: () => new Date('2026-07-15T14:24:00Z') },
}

const rewardRaw = {
  id: 'r1',
  category: 'reward',
  userId: 'child-1',
  rewardId: 'rw-1',
  costPaid: 50,
  status: 'completed',
  createdAt: { toDate: () => new Date('2026-07-15T14:24:00Z') },
}

const profileRaw = {
  id: 'p1',
  category: 'profile_update',
  childId: 'child-1',
  childName: 'Mnalium',
  requestedDisplayName: 'Mnalium',
  requestedAvatar: 'https://new',
  currentDisplayName: 'M',
  currentAvatar: 'https://old',
  status: 'pending',
  createdAt: { toDate: () => new Date('2026-07-15T14:24:00Z') },
}

function setCurrentUser(user: any) {
  storeState.current = {
    ...storeState.current,
    currentUser: user,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  storeState.current = {
    currentUser: { id: 'parent-1', familyId: 'family-1', role: 'owner', displayName: 'Kemal' },
    familyMembers: [
      { id: 'child-1', displayName: 'Mnalium' },
      { id: 'child-2', displayName: 'Ben' },
      { id: 'parent-1', displayName: 'Kemal', avatarUrl: 'https://kemal' },
    ],
    familyData: { currency: '£' },
    tasks: [],
    rewards: [{ id: 'rw-1', title: 'Extra screen time' }],
  }
  api.approveMoneyRequest.mockResolvedValue(undefined)
  api.approveTransferRequest.mockResolvedValue(undefined)
  api.cancelPendingApproval.mockResolvedValue(undefined)
})

describe('RequestStatusBadge', () => {
  it('renders the correct emoji and label for each status', () => {
    const { rerender } = render(<RequestStatusBadge statusKind="pending" statusLabel="Waiting for approval" />)
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument()
    expect(screen.getByText('🟡')).toBeInTheDocument()

    rerender(<RequestStatusBadge statusKind="approved" statusLabel="Approved" />)
    expect(screen.getByText('🟢')).toBeInTheDocument()
    expect(screen.getByText('Approved')).toBeInTheDocument()

    rerender(<RequestStatusBadge statusKind="rejected" statusLabel="Rejected" />)
    expect(screen.getByText('🔴')).toBeInTheDocument()
    expect(screen.getByText('Rejected')).toBeInTheDocument()
  })
})

describe('RequestCard', () => {
  const base: NormalizedRequest = {
    id: 'm1',
    category: 'money_request',
    typeLabel: 'Money Request',
    status: 'pending',
    statusKind: 'pending',
    statusLabel: 'Waiting for approval',
    requestedBy: { id: 'child-1', name: 'Mnalium' },
    recipient: { id: 'parent-1', name: 'Kemal' },
    createdAt: new Date('2026-07-15T14:24:00Z').getTime(),
    primarySummary: 'Mnalium requested £5.56',
    secondarySummary: 'Can I put this on my card',
    amountPence: 556,
    message: 'Can I put this on my card',
    moneyMoved: false,
    outcome: { ifApproved: 'x', ifRejected: 'y' },
    timeline: [],
  }

  it('is fully tappable (click and keyboard)', () => {
    const onOpen = vi.fn()
    render(<RequestCard request={base} onOpen={onOpen} />)
    const card = screen.getByRole('button')
    fireEvent.click(card)
    expect(onOpen).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(card, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('does not overflow on very long messages', () => {
    const long = { ...base, secondarySummary: 'x'.repeat(400) }
    render(<RequestCard request={long} />)
    const paragraph = screen.getByText('x'.repeat(400))
    expect(paragraph.className).toContain('line-clamp-2')
    expect(paragraph.className).toContain('break-words')
  })
})

describe('Request Detail Sheet — opens for every type', () => {
  it('opens a money request detail with all sections', () => {
    render(<RequestDetailSheet request={moneyRequestRaw} onClose={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Money Request' })).toBeInTheDocument()
    expect(screen.getByText('Requested By')).toBeInTheDocument()
    expect(screen.getByText('Recipient')).toBeInTheDocument()
    expect(screen.getByText('Money Details')).toBeInTheDocument()
    expect(screen.getByText('Can I put this on my card')).toBeInTheDocument()
  })

  it('opens a transfer request detail', () => {
    render(<RequestDetailSheet request={transferRaw} onClose={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Transfer Request' })).toBeInTheDocument()
    expect(screen.getByText('Money Details')).toBeInTheDocument()
  })

  it('opens a reward request detail', () => {
    render(<RequestDetailSheet request={rewardRaw} onClose={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Reward Request' })).toBeInTheDocument()
  })

  it('opens a profile update request detail with the change diff', () => {
    render(<RequestDetailSheet request={profileRaw} onClose={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Profile Update Request' })).toBeInTheDocument()
    expect(screen.getByText('Profile Changes')).toBeInTheDocument()
    expect(screen.getAllByText('Mnalium').length).toBeGreaterThan(0)
  })
})

describe('Outcome explanation', () => {
  it('explains what happens next in human language', () => {
    render(<RequestDetailSheet request={moneyRequestRaw} onClose={() => {}} />)
    expect(screen.getByText('What happens next')).toBeInTheDocument()
    expect(screen.getByText(/If approved:/)).toBeInTheDocument()
    expect(screen.getByText(/If rejected:/)).toBeInTheDocument()
    expect(screen.getByText(/will move from Kemal/)).toBeInTheDocument()
  })
})

describe('Actions by viewer role', () => {
  it('approver sees Approve and Reject', () => {
    setCurrentUser({ id: 'parent-1', familyId: 'family-1', role: 'owner', displayName: 'Kemal' })
    render(<RequestDetailSheet request={moneyRequestRaw} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
  })

  it('creator sees Cancel Request and no approve/reject', () => {
    setCurrentUser({ id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Mnalium' })
    render(<RequestDetailSheet request={moneyRequestRaw} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Cancel Request' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
  })

  it('read-only viewers cannot act', () => {
    setCurrentUser({ id: 'child-2', familyId: 'family-1', role: 'child', displayName: 'Ben' })
    render(<RequestDetailSheet request={moneyRequestRaw} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel Request' })).not.toBeInTheDocument()
  })
})

describe('Timeline', () => {
  it('renders timeline events for a pending request', () => {
    render(<RequestDetailSheet request={moneyRequestRaw} onClose={() => {}} />)
    expect(screen.getByText('Request created')).toBeInTheDocument()
    expect(screen.getAllByText('Waiting for approval').length).toBeGreaterThan(0)
  })

  it('renders the approved event for a resolved request', () => {
    const approved = { ...moneyRequestRaw, status: 'approved', reviewedAt: { toDate: () => new Date('2026-07-15T15:00:00Z') } }
    render(<RequestDetailSheet request={approved} onClose={() => {}} />)
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0)
  })
})

describe('Responsive sheet behaviour', () => {
  it('renders a mobile bottom sheet and a desktop modal with one component', () => {
    const { container } = render(<RequestDetailSheet request={moneyRequestRaw} onClose={() => {}} />)
    const panel = container.querySelector('.request-detail-panel') as HTMLElement
    expect(panel).toBeTruthy()
    expect(panel.className).toContain('rounded-t-3xl') // mobile bottom sheet
    expect(panel.className).toContain('md:rounded-3xl') // desktop modal
    expect(panel.className).toContain('md:max-w-md')
  })
})

describe('Existing flows still pass through the universal UI', () => {
  it('approving a money request calls the wallet-affecting API once', async () => {
    setCurrentUser({ id: 'parent-1', familyId: 'family-1', role: 'owner', displayName: 'Kemal' })
    render(<RequestDetailSheet request={moneyRequestRaw} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(screen.getByText(/You are about to approve/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(api.approveMoneyRequest).toHaveBeenCalledWith('family-1', 'm1'))
  })

  it('approving a transfer request calls the transfer API once', async () => {
    setCurrentUser({ id: 'parent-1', familyId: 'family-1', role: 'owner', displayName: 'Kemal' })
    render(<RequestDetailSheet request={transferRaw} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(api.approveTransferRequest).toHaveBeenCalledWith('family-1', 't1'))
  })

  it('reflects wallet state for an already-approved money request', () => {
    const approved = { ...moneyRequestRaw, status: 'approved', reviewedAt: { toDate: () => new Date() } }
    render(<RequestDetailSheet request={approved} onClose={() => {}} />)
    expect(screen.getByText('Yes')).toBeInTheDocument() // Money moved?
    expect(screen.getByText(/will move from Kemal/)).toBeInTheDocument()
  })
})

describe('normalizeRequest pluggability', () => {
  it('normalises every known category without throwing', () => {
    expect(normalizeRequest(moneyRequestRaw, ctx).typeLabel).toBe('Money Request')
    expect(normalizeRequest(transferRaw, ctx).typeLabel).toBe('Transfer Request')
    expect(normalizeRequest(rewardRaw, ctx).typeLabel).toBe('Reward Request')
    expect(normalizeRequest(profileRaw, ctx).typeLabel).toBe('Profile Update Request')
  })
})

describe('pending_acceptance money requests', () => {
  const moneyRequestPendingAcceptanceRaw = {
    ...moneyRequestRaw,
    status: 'pending_acceptance',
  };

  it('shows a friendly label, never the raw enum text', () => {
    render(<RequestDetailSheet request={moneyRequestPendingAcceptanceRaw} onClose={() => {}} />)
    expect(screen.getAllByText('Waiting for approval').length).toBeGreaterThan(0)
    expect(screen.queryByText(/pending_acceptance/i)).not.toBeInTheDocument()
  })

    it('parent approver (who is the requested-from) sees Accept for a pending_acceptance request', () => {
    setCurrentUser({ id: 'parent-1', familyId: 'family-1', role: 'owner', displayName: 'Kemal' })
    render(<RequestDetailSheet request={moneyRequestPendingAcceptanceRaw} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Accept Request' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel Request' })).not.toBeInTheDocument()
  })

  it('request creator sees Cancel Request and no approve/reject', () => {
    setCurrentUser({ id: 'child-1', familyId: 'family-1', role: 'child', displayName: 'Mnalium' })
    render(<RequestDetailSheet request={moneyRequestPendingAcceptanceRaw} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Cancel Request' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
  })

    it('mobile action footer stays visible (sticky) and shows the Accept action', () => {
    setCurrentUser({ id: 'parent-1', familyId: 'family-1', role: 'owner', displayName: 'Kemal' })
    const { container } = render(<RequestDetailSheet request={moneyRequestPendingAcceptanceRaw} onClose={() => {}} />)
    expect(container.querySelector('.sticky.bottom-0')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Accept Request' })).toBeInTheDocument()
  })
})
