import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n/config'

const api = vi.hoisted(() => ({
  approveTaskCompletion: vi.fn(), rejectTaskCompletion: vi.fn(),
  approveTransferRequest: vi.fn(), rejectTransferRequest: vi.fn(),
  approveMoneyRequest: vi.fn(), rejectMoneyRequest: vi.fn(), acceptMoneyRequest: vi.fn(),
  approvePetBoxDonation: vi.fn(), rejectPetBoxDonation: vi.fn(),
  approveProfileUpdateRequest: vi.fn(), rejectProfileUpdateRequest: vi.fn(),
  approveGoalWithdrawal: vi.fn(), rejectGoalWithdrawal: vi.fn(),
  cancelPendingApproval: vi.fn(),
  mapApprovalError: (err: any) => ({ message: err?.message || 'failed', code: err?.code, raw: err }),
}))

const joinApi = vi.hoisted(() => ({
  approveChildJoinRequest: vi.fn(async () => ({ requestId: 'joinreq-1', childId: 'child-9', status: 'approved' })),
  rejectChildJoinRequest: vi.fn(async () => ({ requestId: 'joinreq-1', status: 'rejected' })),
  submitChildJoinRequest: vi.fn(),
  getChildJoinRequestStatus: vi.fn(),
  cancelChildJoinRequest: vi.fn(),
  storeJoinRequestHandle: vi.fn(),
  readJoinRequestHandle: vi.fn(() => null),
  clearJoinRequestHandle: vi.fn(),
  mapChildJoinErrorKey: vi.fn(() => 'auth:childJoin.errors.generic'),
}))

const state = vi.hoisted(() => ({ current: {} as any }))

vi.mock('../../lib/api', () => api)
vi.mock('../../lib/childJoinApi', () => joinApi)
vi.mock('../../store/useStore', () => ({
  useStore: (selector?: any) => (typeof selector === 'function' ? selector(state.current) : state.current),
}))

import { ApprovalCenter } from './ApprovalCenter'
import { RequestDetailProvider } from '../requests/RequestDetailContext'

function renderApprovalCenter() {
  return render(
    <RequestDetailProvider>
      <ApprovalCenter />
    </RequestDetailProvider>,
  )
}

const createdAt = new Date('2026-03-04T10:15:00Z')

function pendingJoinRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'joinreq-1',
    normalizedUsername: 'ada star',
    displayUsername: 'Ada Star',
    status: 'pending',
    createdAt: { toDate: () => createdAt },
    createdAtMs: createdAt.getTime(),
    expiresAtMs: createdAt.getTime() + 7 * 24 * 60 * 60 * 1000,
    ...overrides,
  }
}

describe('ApprovalCenter — child join requests', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.loadNamespaces(['approvals', 'requests', 'common'])
    await i18n.changeLanguage('en')
    state.current = {
      currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner' },
      tasks: [], familyMembers: [], rewards: [],
      taskCompletions: [], transferRequests: [], moneyRequests: [],
      petboxRequests: [], profileUpdateRequests: [], goalRequests: [], savingsGoals: [],
      childJoinRequests: [pendingJoinRequest()],
      bootstrapStatus: { childQrJoinRequests: 'ready' },
    }
  })

  it('renders a pending child join request with the requested username and request time', () => {
    renderApprovalCenter()
    expect(screen.getByText('Child Join Request')).toBeInTheDocument()
    expect(screen.getByText(/Ada Star/)).toBeInTheDocument()
    expect(screen.getByText(/2026/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
  })

  it('never renders password or password-derived material', () => {
    state.current.childJoinRequests = [pendingJoinRequest({
      authUid: 'auth-uid-1',
      pendingAuthUid: 'auth-uid-1',
    })]
    const { container } = renderApprovalCenter()
    expect(container.textContent).not.toMatch(/password/i)
    expect(container.textContent).not.toMatch(/auth-uid-1/)
    expect(container.textContent).not.toMatch(/secret/i)
  })

  it('approves through the trusted callable with the family and request id', async () => {
    renderApprovalCenter()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(joinApi.approveChildJoinRequest).toHaveBeenCalledWith('family-1', 'joinreq-1'))
    expect(api.approveTaskCompletion).not.toHaveBeenCalled()
  })

  it('rejects through the trusted callable', async () => {
    renderApprovalCenter()
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await waitFor(() =>
      expect(joinApi.rejectChildJoinRequest).toHaveBeenCalledWith('family-1', 'joinreq-1'))
  })

  it('removes the card once the decision succeeds', async () => {
    renderApprovalCenter()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(screen.queryByText('Child Join Request')).not.toBeInTheDocument())
  })

  it('keeps the card and shows an error when approval is denied', async () => {
    joinApi.approveChildJoinRequest.mockRejectedValueOnce(
      Object.assign(new Error('NOT_AUTHORIZED'), { code: 'functions/permission-denied' }))
    renderApprovalCenter()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(screen.getByText('Child Join Request')).toBeInTheDocument())
  })

  it.each(['approved', 'rejected', 'expired', 'cancelled'])(
    'shows a %s request in history and not in pending',
    async status => {
      state.current.childJoinRequests = [pendingJoinRequest({ status })]
      renderApprovalCenter()
      expect(screen.getByText('You’re all caught up!')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'History' }))
      expect(screen.getByText('Child Join Request')).toBeInTheDocument()
      expect(screen.getByText(status)).toBeInTheDocument()
    })

  it('renders nothing when the family has no child join requests', () => {
    state.current.childJoinRequests = []
    renderApprovalCenter()
    expect(screen.queryByText('Child Join Request')).not.toBeInTheDocument()
  })

  it('tolerates an undefined childJoinRequests slice', () => {
    delete state.current.childJoinRequests
    expect(() => renderApprovalCenter()).not.toThrow()
  })

  it('renders Turkish copy for the child join card', async () => {
    await i18n.changeLanguage('tr')
    renderApprovalCenter()
    expect(screen.getByText(i18n.t('approvals:type.childJoinRequest'))).toBeInTheDocument()
    await i18n.changeLanguage('en')
  })

  it('repeated listener updates do not duplicate child QR device join card in UI', () => {
    state.current.childQrJoinRequests = [
      {
        id: 'qr-req-dup-1',
        category: 'child_qr_join',
        status: 'pending',
        requesterDisplayName: 'Ali',
        requesterDeviceLabel: 'iPhone',
        createdAtMs: Date.now(),
      },
    ]
    const { rerender } = renderApprovalCenter()
    expect(screen.getAllByText('Ali wants to connect a device')).toHaveLength(1)

    // Simulate repeated listener snapshot arrival with the same request
    state.current.childQrJoinRequests = [
      {
        id: 'qr-req-dup-1',
        category: 'child_qr_join',
        status: 'pending',
        requesterDisplayName: 'Ali',
        requesterDeviceLabel: 'iPhone',
        createdAtMs: Date.now(),
      },
    ]
    rerender(
      <RequestDetailProvider>
        <ApprovalCenter />
      </RequestDetailProvider>,
    )
    expect(screen.getAllByText('Ali wants to connect a device')).toHaveLength(1)
  })
})
