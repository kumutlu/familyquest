import { fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import i18n from '../../i18n/config'

const api = vi.hoisted(() => ({
  approveTaskCompletion: vi.fn(), rejectTaskCompletion: vi.fn(),
  approveTransferRequest: vi.fn(), rejectTransferRequest: vi.fn(),
  approveMoneyRequest: vi.fn(), rejectMoneyRequest: vi.fn(), acceptMoneyRequest: vi.fn(),
  approvePetBoxDonation: vi.fn(), rejectPetBoxDonation: vi.fn(),
  approveProfileUpdateRequest: vi.fn(), rejectProfileUpdateRequest: vi.fn(),
  cancelPendingApproval: vi.fn(),
  // Mirror of the production mapApprovalError contract (src/lib/api.ts).
  mapApprovalError: (err: any) => {
    const code = err?.code
    const message: string = err?.message || ''
    if (/not pending approval|Request cannot|Request is not pending|Request not valid|Request not found|already (approved|rejected|cancelled|handled|decided)/i.test(message)) {
      return { message: 'This request has already been handled.', code: code ?? 'stale', stale: true, raw: err }
    }
    if (code === 'unauthenticated' || /Not authenticated|unauthenticated/i.test(message)) {
      return { message: 'Your session has expired. Please sign in again.', code, raw: err }
    }
    if (/Rejection reason is required/i.test(message)) {
      return { message: 'Please provide a reason for rejecting this request.', code, raw: err }
    }
    if (code === 'permission-denied' || /permission-denied|Missing or insufficient permissions|Unauthorized/i.test(message)) {
      return { message: 'This request could not be updated. Please try again.', code: 'permission-denied', raw: err }
    }
    return { message: 'This request could not be updated. Please try again.', code, raw: err }
  },
}))

const state = vi.hoisted(() => ({ current: {} as any }))

vi.mock('../../lib/api', () => api)
vi.mock('../../store/useStore', () => ({ useStore: (selector?: any) => (typeof selector === 'function' ? selector(state.current) : state.current) }))

import { ApprovalCenter } from './ApprovalCenter'
import { RequestDetailProvider } from '../requests/RequestDetailContext'
import { MoneyPrivacyProvider } from '../privacy/MoneyPrivacyContext'
import { MoneyPrivacyToggle } from '../privacy/MoneyPrivacyToggle'

function render(ui: ReactElement) {
  return rtlRender(<MoneyPrivacyProvider>{ui}</MoneyPrivacyProvider>)
}

function renderApprovalCenter() {
  return render(
    <>
      <MoneyPrivacyToggle />
      <RequestDetailProvider><ApprovalCenter /></RequestDetailProvider>
    </>,
  )
}

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  localStorage.clear()
})

describe('ApprovalCenter interaction contract', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.loadNamespaces(['approvals', 'requests', 'common']);
    await i18n.changeLanguage('en');
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
      bootstrapStatus: { childQrJoinRequests: 'ready' },
    }
  })

  it('uses a type-qualified in-flight key and submits a double click only once', async () => {
    const pending = deferred()
    api.approveTaskCompletion.mockReturnValue(pending.promise)
    renderApprovalCenter()

    const taskCard = screen.getByText(/Tidy room/).closest('.rounded-2xl') as HTMLElement
    const approveButton = within(taskCard).getByRole('button', { name: 'Approve' })
    fireEvent.click(approveButton)
    fireEvent.click(approveButton)

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

  it('keeps the card and shows a neutral retry message when rejection is denied', async () => {
    api.rejectTaskCompletion.mockRejectedValue(Object.assign(new Error('Missing permissions'), { code: 'permission-denied' }))
    renderApprovalCenter()

    fireEvent.click(screen.getAllByRole('button', { name: 'Reject' })[0])

    expect(await screen.findByText('This request could not be updated. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(/permission-denied/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Missing permissions/)).not.toBeInTheDocument()
    expect(screen.queryByText(/no longer have permission/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Tidy room/)).toBeInTheDocument()
    expect(api.rejectTaskCompletion).toHaveBeenCalledWith('family-1', 'same-id', 'Rejected')
  })

  it('a stale transfer card is removed from Pending with "already been handled", never a permission error', async () => {
    api.approveTransferRequest.mockRejectedValue(new Error('Request is not pending'))
    renderApprovalCenter()

    const transferCard = screen.getByText(/wants to send money/)
    expect(transferCard).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Approve' })[1])

    expect(await screen.findByText('This request has already been handled.')).toBeInTheDocument()
    expect(screen.queryByText(/no longer have permission/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Missing or insufficient permissions/i)).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/wants to send money/)).not.toBeInTheDocument())
  })

  it('a successful owner approval removes the card and never shows a permission error', async () => {
    api.approveTransferRequest.mockResolvedValue(undefined)
    renderApprovalCenter()

    fireEvent.click(screen.getAllByRole('button', { name: 'Approve' })[1])

    await waitFor(() => expect(screen.queryByText(/wants to send money/)).not.toBeInTheDocument())
    expect(screen.queryByText(/no longer have permission/i)).not.toBeInTheDocument()
  })

  it('a same-family PARENT follows identical authorization semantics to the owner', async () => {
    state.current = { ...state.current, currentUser: { id: 'parent-1', familyId: 'family-1', role: 'parent' } }
    api.approveTransferRequest.mockResolvedValue(undefined)
    renderApprovalCenter()

    fireEvent.click(screen.getAllByRole('button', { name: 'Approve' })[1])

    await waitFor(() => expect(api.approveTransferRequest).toHaveBeenCalledWith('family-1', 'same-id'))
    expect(screen.queryByText(/no longer have permission/i)).not.toBeInTheDocument()
  })

  it('masks a stored transfer approval but leaves a Cat Box approval amount visible', async () => {
    localStorage.setItem('queki.moneyPrivacy:owner-1', 'true')
    state.current = {
      ...state.current,
      taskCompletions: [],
      transferRequests: [{
        id: 'private-transfer', fromChildId: 'child-1', toChildId: 'child-2',
        amountPence: 51_924, message: 'Please send £413.73', status: 'pending',
      }],
      petboxRequests: [{
        id: 'visible-cat-box', childId: 'child-1', childName: 'Ada', fundName: 'Milo',
        amountPence: 25_861, status: 'pending',
      }],
    }

    const { container } = renderApprovalCenter()

    await waitFor(() => expect(container).not.toHaveTextContent('413.73'))
    expect(screen.getAllByText('£••••')).toHaveLength(2)
    expect(screen.getByText('£258.61')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show money amounts' }))
    expect(screen.getByText(/Please send £413\.73/)).toBeInTheDocument()
    expect(screen.getByText('£519.24')).toBeInTheDocument()
  })

  it('renders a Profile Update Request card and approves it through the shared flow', async () => {
    state.current = {
      currentUser: { id: 'owner-1', familyId: 'family-1', role: 'owner' },
      tasks: [], familyMembers: [{ id: 'child-1', displayName: 'Muhammed Osman' }],
      taskCompletions: [], transferRequests: [], moneyRequests: [], petboxRequests: [],
      bootstrapStatus: { childQrJoinRequests: 'ready' },
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
    expect(screen.getByText(/name → "Muhammed"/)).toBeInTheDocument()

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
      bootstrapStatus: { childQrJoinRequests: 'ready' },
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
    bootstrapStatus: { childQrJoinRequests: 'ready' },
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

  it('masks the stored request amount in the approval card and accessible name', async () => {
    localStorage.setItem('queki.moneyPrivacy:owner-1', 'true')
    state.current = {
      ...baseState,
      moneyRequests: [{ ...moneyRequestPendingAcceptance, amountPence: 41_573 }],
    }

    const { container } = renderApprovalCenter()

    await waitFor(() => expect(container).not.toHaveTextContent('415.73'))
    expect(screen.getAllByText('£••••')).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Money Request/ })).not.toHaveAccessibleName(/415\.73/)
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()
  })

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
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
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

  it('resolved (approved) money requests appear only in History, not Pending', async () => {
    state.current = {
      ...baseState,
      moneyRequests: [{ ...moneyRequestPendingAcceptance, status: 'approved', reviewedAt: { toDate: () => new Date() } }],
    };
    renderApprovalCenter();

    expect(screen.getByText('Pending (0)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(await screen.findByText(/Mnalium requested/)).toBeInTheDocument();
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);
  });
})
