import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  approveTaskCompletion: vi.fn(), rejectTaskCompletion: vi.fn(),
  approveTransferRequest: vi.fn(), rejectTransferRequest: vi.fn(),
  approveMoneyRequest: vi.fn(), rejectMoneyRequest: vi.fn(),
  approvePetBoxDonation: vi.fn(), rejectPetBoxDonation: vi.fn(),
}))

const state = vi.hoisted(() => ({ current: {} as any }))

vi.mock('../../lib/api', () => api)
vi.mock('../../store/useStore', () => ({ useStore: () => state.current }))

import { ApprovalCenter } from './ApprovalCenter'

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
    render(<ApprovalCenter />)
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(2)

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
    render(<ApprovalCenter />)
    const approveButtons = screen.getAllByRole('button', { name: 'Approve' })
    fireEvent.click(approveButtons[0])
    fireEvent.click(approveButtons[1])
    expect(screen.getAllByRole('button', { name: 'Approving…' })).toHaveLength(2)
    taskPending.resolve(); transferPending.resolve()
  })

  it('keeps the card and exposes the exact Firebase code and message when rejection fails', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Needs more evidence')
    api.rejectTaskCompletion.mockRejectedValue(Object.assign(new Error('Missing permissions'), { code: 'permission-denied' }))
    render(<ApprovalCenter />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Reject' })[0])

    expect(await screen.findByText('permission-denied: Missing permissions')).toBeInTheDocument()
    expect(screen.getByText(/Tidy room/)).toBeInTheDocument()
    expect(api.rejectTaskCompletion).toHaveBeenCalledWith('family-1', 'same-id', 'Needs more evidence')
  })
})
