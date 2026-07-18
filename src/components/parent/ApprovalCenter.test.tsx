import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  approveTaskCompletion: vi.fn(), rejectTaskCompletion: vi.fn(),
  approveTransferRequest: vi.fn(), rejectTransferRequest: vi.fn(),
  approveMoneyRequest: vi.fn(), rejectMoneyRequest: vi.fn(), acceptMoneyRequest: vi.fn(),
  approvePetBoxDonation: vi.fn(), rejectPetBoxDonation: vi.fn(),
  approveProfileUpdateRequest: vi.fn(), rejectProfileUpdateRequest: vi.fn(),
  mapApprovalError: (err: any) => {
    const code = err?.code
    const message: string = err?.message || ''
    if (code === 'permission-denied' || /permission-denied|Missing or insufficient permissions/i.test(message)) {
      return { message: "You no longer have permission to manage this request.", code: 'permission-denied', raw: err }
    }
    if (/not pending approval|Request cannot|Request is not pending/i.test(message)) {
      return { message: "This request has already been decided.", code, raw: err }
    }
    if (/Request not found/i.test(message)) {
      return { message: "The request changed while you were reviewing it. Please refresh and try again.", code, raw: err }
    }
    if (/Unauthorized/i.test(message)) {
      return { message: "You no longer have permission to manage this request.", code, raw: err }
    }
    if (/Rejection reason is required/i.test(message)) {
      return { message: "Please provide a reason for rejecting this request.", code, raw: err }
    }
    return { message: "We couldn’t reject this request. Please try again.", code, raw: err }
  },
}))

const state = vi.hoisted(() => ({ current: {} as any }))

vi.mock('../../lib/api', () => api)
vi.mock('../../store/useStore', () => ({ useStore: (selector?: any) => (typeof selector === 'function' ? selector(state.current) : state.current) }))

import { ApprovalCenter } from './ApprovalCenter'
import { RequestDetailProvider } from '../requests/RequestDetailContext'

function renderApprovalCenter() {
  return render(
    <RequestDetailProvider>
      <ApprovalCenter />
    </RequestDetailProvider>
  )
}

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('ApprovalCenter interaction contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.current = {
      currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner' },
      tasks: [{ id: 'task-1', title: 'Tidy room', pointsReward: 10 }],
      familyMembers: [
        { id: 'child-1', displayName: 'Ada' },
        { id: 'child-2', displayName: 'Ben' },
      ],
      taskCompletions: [{ id: 'same-id', taskId: 'task-1', assigneeId: 'child-1', status: 'pending_approval' }],
      transferRequests: [{ id: 'same-id', fromChildId: 'child-1', toChildId: 'child-2', amountPence: 100, status: 'pending' }],
      moneyRequests: [], petboxRequests: [],
    }
  })

  it('uses a type-qualified in-flight key and submits a double click only once', async () => {
    const pending = deferred()
    api.approveTaskCompletion.mockReturnValue(pending.promise)
    renderApprovalCenter()

    const approveButtons = screen.getAllByRole('button', { name: 'Approve' })
    fireEvent.click(approveButtons[0])
    fireEvent.click(approveButtons[0])

    expect(api.approveTaskCompletion).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Approving…' })).toBeDisabled()
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1)
    const rejectButtons = screen.getAllByRole('button', { name: 'Reject' })
    expect(rejectButtons.some(button => !button.hasAttribute('disabled'))).toBe(true)

    pending.resolve()
    await waitFor(() => expect(screen.queryByText(/Tidy room/)).not.toBeInTheDocument())
    expect(screen.getByText(/wants to send money/)).toBeInTheDocument()
  })

  it('keeps independent loading state for concurrent cards', async () => {
    const taskPending = deferred()
    const transferPending = deferred()
    api.approveTaskCompletion.mockReturnValue(taskPending.promise)
    api.approveTransferRequest.mockReturnValue(transferPending.promise)
    renderApprovalCenter()
    const approveButtons = screen.getAllByRole('button', { name: 'Approve' })
    fireEvent.click(approveButtons[0])
    fireEvent.click(approveButtons[1])
    expect(screen.getAllByRole('button', { name: 'Approving…' })).toHaveLength(2)
    taskPending.resolve(); transferPending.resolve()
  })

  it('keeps the card and exposes the exact Firebase code and message when rejection fails', async () => {
    api.rejectTaskCompletion.mockRejectedValue(Object.assign(new Error('Missing permissions'), { code: 'permission-denied' }))
    renderApprovalCenter()

    fireEvent.click(screen.getAllByRole('button', { name: 'Reject' })[0])

    expect(await screen.findByText('You no longer have permission to manage this request.')).toBeInTheDocument()
    expect(screen.queryByText(/permission-denied/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Missing permissions/)).not.toBeInTheDocument()
    expect(screen.getByText(/Tidy room/)).toBeInTheDocument()
    expect(api.rejectTaskCompletion).toHaveBeenCalledWith('family-1', 'same-id', 'Rejected')
  })

  it('renders a Profile Update Request card and approves it through the shared flow', async () => {
    state.current = {
      currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner' },
      tasks: [], familyMembers: [{ id: 'child-1', displayName: 'Muhammed Osman' }],
      taskCompletions: [], transferRequests: [], moneyRequests: [], petboxRequests: [],
      profileUpdateRequests: [{
        id: 'pu-1', childId: 'child-1', childName: 'Muhammed Osman',
        requestedDisplayName: 'Muhammed', requestedAvatar: 'https://new',
        currentDisplayName: 'Muhammed Osman', currentAvatar: 'https://old',
        status: 'pending', createdAt: { toDate: () => new Date('2024-01-01') },
      }],
    }
    const pending = deferred()
    api.approveProfileUpdateRequest.mockReturnValue(pending.promise)
    renderApprovalCenter()

    expect(screen.getByText(/Muhammed Osman wants to update their profile/)).toBeInTheDocument()
    expect(screen.getAllByText(/Muhammed Osman/).length).toBeGreaterThan(0)
    expect(screen.getByText('Muhammed')).toBeInTheDocument()

    const approveButtons = screen.getAllByRole('button', { name: 'Approve' })
    fireEvent.click(approveButtons[0])
    expect(api.approveProfileUpdateRequest).toHaveBeenCalledWith('family-1', 'pu-1')

    pending.resolve()
    await waitFor(() => expect(screen.queryByText(/wants to update their profile/)).not.toBeInTheDocument())
  })

  it('rejects a Profile Update Request through the shared flow', async () => {
    state.current = {
      currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner' },
      tasks: [], familyMembers: [{ id: 'child-1', displayName: 'Muhammed Osman' }],
      taskCompletions: [], transferRequests: [], moneyRequests: [], petboxRequests: [],
      profileUpdateRequests: [{
        id: 'pu-2', childId: 'child-1', childName: 'Muhammed Osman',
        requestedDisplayName: 'Muhammed', requestedAvatar: 'https://new',
        currentDisplayName: 'Muhammed Osman', currentAvatar: 'https://old',
        status: 'pending', createdAt: { toDate: () => new Date('2024-01-01') },
      }],
    }
    const pending = deferred()
    api.rejectProfileUpdateRequest.mockReturnValue(pending.promise)
    renderApprovalCenter()

    const rejectButtons = screen.getAllByRole('button', { name: 'Reject' })
    fireEvent.click(rejectButtons[0])
    expect(api.rejectProfileUpdateRequest).toHaveBeenCalledWith('family-1', 'pu-2', 'Rejected')

    pending.resolve()
    await waitFor(() => expect(screen.queryByText(/wants to update their profile/)).not.toBeInTheDocument())
  })
})

describe('pending_acceptance money requests', () => {
  const moneyRequestPendingAcceptance = {
    id: 'mr-1',
    category: 'money_request',
    requesterId: 'child-1',
    requesterName: 'Mnalium',
    requestedFromId: 'owner-1',
    requestedFromName: 'Kemal',
    requestedFromRole: 'parent',
    amountPence: 556,
    message: 'Can I put this on my card',
    status: 'pending_acceptance',
    createdAt: { toDate: () => new Date('2026-07-15T14:24:00Z') },
  };

  const baseState = {
    currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner' },
    tasks: [], familyMembers: [], familyData: { currency: '£' }, rewards: [],
    taskCompletions: [], transferRequests: [], petboxRequests: [], profileUpdateRequests: [],
  };

  it('appears in Pending with the correct count and never in History', () => {
    state.current = { ...baseState, moneyRequests: [moneyRequestPendingAcceptance] };
    renderApprovalCenter();

    expect(screen.getByText('Pending (1)')).toBeInTheDocument();
    expect(screen.getByText(/Mnalium requested £5\.56 from Kemal/)).toBeInTheDocument();
    // Friendly status label, never the raw enum text.
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
    expect(screen.queryByText(/pending_acceptance/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.queryByText(/Mnalium requested/)).not.toBeInTheDocument();
  });

  it('opens the shared Request Detail modal when the whole card is tapped', () => {
    state.current = { ...baseState, moneyRequests: [moneyRequestPendingAcceptance] };
    renderApprovalCenter();

    fireEvent.click(screen.getByText(/Mnalium requested £5\.56 from Kemal/));
    // The same universal sheet opens (modal heading + requester/recipient).
    expect(screen.getByRole('heading', { name: 'Money Request', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('Requested By')).toBeInTheDocument();
    expect(screen.getByText('Recipient')).toBeInTheDocument();
  });

  it('accepting a pending_acceptance money request (requested-from is the parent) removes it from Pending', async () => {
    const pending = deferred();
    api.acceptMoneyRequest.mockReturnValue(pending.promise);
    state.current = { ...baseState, moneyRequests: [moneyRequestPendingAcceptance] };
    renderApprovalCenter();

    expect(screen.getByText('Pending (1)')).toBeInTheDocument();
    // A pending_acceptance request addressed to the current parent shows Accept,
    // not Approve (approving a pending_acceptance request is denied by the rules).
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(api.acceptMoneyRequest).toHaveBeenCalledWith('family-1', 'mr-1');

    pending.resolve();
    await waitFor(() => expect(screen.getByText('Pending (0)')).toBeInTheDocument());
  });

  it('a pending_acceptance money request does NOT render Approve (canonical contract)', () => {
    state.current = { ...baseState, moneyRequests: [moneyRequestPendingAcceptance] };
    renderApprovalCenter();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
  });

  it('rejecting a pending_acceptance money request removes it from Pending', async () => {
    const pending = deferred();
    api.rejectMoneyRequest.mockReturnValue(pending.promise);
    state.current = { ...baseState, moneyRequests: [moneyRequestPendingAcceptance] };
    renderApprovalCenter();

    fireEvent.click(screen.getAllByRole('button', { name: 'Reject' })[0]);
    expect(api.rejectMoneyRequest).toHaveBeenCalledWith('family-1', 'mr-1', 'Rejected');

    pending.resolve();
    await waitFor(() => expect(screen.getByText('Pending (0)')).toBeInTheDocument());
  });

  it('resolved (approved) money requests appear only in History, not Pending', () => {
    state.current = {
      ...baseState,
      moneyRequests: [{ ...moneyRequestPendingAcceptance, status: 'approved', reviewedAt: { toDate: () => new Date() } }],
    };
    renderApprovalCenter();

    expect(screen.getByText('Pending (0)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(screen.getByText(/Mnalium requested/)).toBeInTheDocument();
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);
  });
})
