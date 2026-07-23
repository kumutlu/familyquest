import { beforeEach, describe, expect, it, vi } from 'vitest'

const firestore = vi.hoisted(() => {
  let id = 0
  const collection = vi.fn((_db: unknown, path: string) => ({ path }))
  const doc = vi.fn((first: any, ...parts: string[]) => {
    if (parts.length) return { id: parts.at(-1), path: parts.join('/') }
    id += 1
    return { id: `generated-${id}`, path: `${first.path}/generated-${id}` }
  })
  return { collection, doc, runTransaction: vi.fn(), serverTimestamp: vi.fn(() => ({ server: true })), reset: () => { id = 0 } }
})
const authState = vi.hoisted(() => ({ currentUser: { uid: 'owner-1' } as any }))

vi.mock('firebase/firestore', () => ({
  ...firestore, setDoc: vi.fn(), addDoc: vi.fn(), query: vi.fn(), where: vi.fn(), getDocs: vi.fn(), getDoc: vi.fn(),
  deleteDoc: vi.fn(), updateDoc: vi.fn(), writeBatch: vi.fn(),
}))
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(), signInWithEmailAndPassword: vi.fn(), signInWithPopup: vi.fn(), signOut: vi.fn(),
}))
vi.mock('./firebase', () => ({ db: { name: 'db' }, auth: authState, googleProvider: {} }))

import { approveJoinRequest, approveMoneyRequest, approveTaskCompletion, approveTransferRequest, cancelPendingApproval, rejectMoneyRequest, rejectTaskCompletion, mapApprovalError } from './api'

function snapshot(data?: Record<string, any>) { return { exists: () => data !== undefined, data: () => data } }
function transactionWith(docs: Record<string, Record<string, any> | undefined>, enforceReadBeforeWrite = false) {
  let wrote = false
  const tx = {
    get: vi.fn(async (ref: { path: string }) => {
      if (enforceReadBeforeWrite && wrote) throw new Error('Firestore transactions require all reads to be executed before all writes.')
      return snapshot(docs[ref.path])
    }),
    update: vi.fn(() => { wrote = true }), set: vi.fn(() => { wrote = true }), delete: vi.fn(() => { wrote = true }),
  }
  firestore.runTransaction.mockImplementation(async (_db: unknown, callback: any) => callback(tx))
  return tx
}

describe('approval API transaction contracts', () => {
  beforeEach(() => { vi.clearAllMocks(); firestore.reset(); authState.currentUser = { uid: 'owner-1' } })

  it('derives task and assignee from the pending completion and reviewer from auth', async () => {
    const tx = transactionWith({
      'families/family-1/task_completions/completion-1': { taskId: 'task-1', assigneeId: 'child-1', status: 'pending_approval' },
      'families/family-1/tasks/task-1': { title: 'Tidy room', pointsReward: 10 },
      'users/child-1': { familyId: 'family-1', role: 'child', rewardPoints: 5, lifetimeXP: 20 },
      'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Kemal' },
    })

    await approveTaskCompletion('family-1', 'completion-1', 'Great work')

    // Client writes only status fields; awardedPoints and effectSnapshot are server-only
    expect(tx.update).toHaveBeenCalledWith(expect.objectContaining({ path: 'families/family-1/task_completions/completion-1' }), expect.objectContaining({
      status: 'approved', parentComment: 'Great work', reviewedBy: 'owner-1', reviewedByName: 'Kemal',
    }))
    // XP/rewards handled by gamification processor (server-side)
    // Client no longer writes lastTaskCompletionId - server handles it
  })

  it('rejects replay before any write', async () => {
    const tx = transactionWith({
      'families/family-1/task_completions/completion-1': { taskId: 'task-1', assigneeId: 'child-1', status: 'approved' },
      'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Kemal' },
    })
    await expect(approveTaskCompletion('family-1', 'completion-1')).rejects.toThrow('Completion is not pending approval')
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('rejects a task using stored identity without changing points', async () => {
    const tx = transactionWith({
      'families/family-1/task_completions/completion-1': { taskId: 'task-1', assigneeId: 'child-1', status: 'pending_approval' },
      'families/family-1/tasks/task-1': { title: 'Tidy room', pointsReward: 10 },
      'users/owner-1': { familyId: 'family-1', role: 'parent', displayName: 'Parent' },
    })
    await rejectTaskCompletion('family-1', 'completion-1', 'Please retry')
    expect(tx.update).toHaveBeenCalledTimes(1)
    expect(tx.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'rejected', reviewedBy: 'owner-1' }))
  })

  it('derives join target identity and display name from the pending request', async () => {
    const tx = transactionWith({
      'families/family-1/join_requests/request-1': { uid: 'target-1', displayName: 'Stored Name', status: 'pending' },
      'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Owner' },
    })
    await approveJoinRequest('family-1', 'request-1', 'child')
    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/target-1' }), expect.objectContaining({
      uid: 'target-1', displayName: 'Stored Name', role: 'child', familyId: 'family-1',
    }), { merge: true })
  })

  it('uses the production parent-funded money path for an existing wallet', async () => {
    const tx = transactionWith({
      'families/family-1/money_requests/money-1': { requesterId: 'child-1', requestedFromId: 'parent-source', amountPence: 100, status: 'pending', message: 'Lunch' },
      'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Owner' },
      'users/parent-source': { familyId: 'family-1', role: 'parent' },
      'users/child-1': { familyId: 'family-1', role: 'child' },
      'families/family-1/wallets/child-1': { balance: 250 },
    })
    await approveMoneyRequest('family-1', 'money-1')
    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({ path: 'families/family-1/wallets/child-1' }), {
      balance: 350, lastTransferTxId: 'generated-1_in', lastTransferReqId: 'money-1',
    }, { merge: true })
    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({ path: 'families/family-1/wallet_transactions/generated-1_in' }), expect.objectContaining({
      type: 'request_payment', childId: 'child-1', amountPence: 100, moneyRequestId: 'money-1', approvalTxId: 'generated-1', parentRef: 'owner-1',
    }))
  })

  it('rejects the transfer approval with WALLET_NOT_FOUND when a canonical wallet is missing (no legacy seeding)', async () => {
    const tx = transactionWith({
      'families/family-1/transfer_requests/transfer-1': { fromChildId: 'child-1', toChildId: 'child-2', amountPence: 100, status: 'pending' },
      'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Owner' },
      'users/child-1': { familyId: 'family-1', role: 'child', walletBalance: 250 },
      'users/child-2': { familyId: 'family-1', role: 'child' },
    }, true)

    await expect(approveTransferRequest('family-1', 'transfer-1')).rejects.toMatchObject({
      code: 'WALLET_NOT_FOUND',
      childId: 'child-1',
    })
    expect(tx.set).not.toHaveBeenCalledWith(expect.objectContaining({ path: 'families/family-1/wallets/child-1' }), expect.anything())
    expect(tx.set).not.toHaveBeenCalledWith(expect.objectContaining({ path: 'families/family-1/wallets/child-2' }), expect.anything())
  })

  it('uses the production sibling-money path when the requester wallet is missing without reading after a write', async () => {
    const tx = transactionWith({
      'families/family-1/money_requests/money-1': { requesterId: 'child-2', requestedFromId: 'child-1', amountPence: 100, status: 'pending' },
      'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Owner' },
      'users/child-1': { familyId: 'family-1', role: 'child' },
      'users/child-2': { familyId: 'family-1', role: 'child', walletBalance: 25 },
      'families/family-1/wallets/child-1': { balance: 300 },
    }, true)

    await approveMoneyRequest('family-1', 'money-1')

    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({ path: 'families/family-1/wallets/child-2' }), expect.objectContaining({
      balance: 100, lastTransferReqId: 'money-1', migratedFromLegacy: true,
    }), { merge: true })
  })

  it('allows an authenticated family parent to cancel a child-created pending request', async () => {
    const tx = transactionWith({
      'users/owner-1': { familyId: 'family-1', role: 'owner' },
      'families/family-1/transfer_requests/transfer-1': { fromChildId: 'child-1', status: 'pending' },
    })
    await cancelPendingApproval('family-1', 'transfer', 'transfer-1')
    expect(tx.update).toHaveBeenCalledWith(expect.objectContaining({ path: 'families/family-1/transfer_requests/transfer-1' }), expect.objectContaining({
      status: 'cancelled', cancelledBy: 'owner-1',
    }))
  })

  describe('rejectMoneyRequest', () => {
    const baseRequest = {
      requesterId: 'child-2', requestedFromId: 'child-1', amountPence: 100, status: 'pending_acceptance', message: 'Lunch',
    }

    it('rejects a pending_acceptance money request and records the approver (regression for production bug)', async () => {
      const tx = transactionWith({
        'families/family-1/money_requests/money-1': { ...baseRequest },
        'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Kemal' },
      })

      await rejectMoneyRequest('family-1', 'money-1', 'Not allowed')

      expect(tx.update).toHaveBeenCalledWith(expect.objectContaining({ path: 'families/family-1/money_requests/money-1' }), expect.objectContaining({
        status: 'rejected',
        reviewedBy: 'owner-1',
        reviewedByName: 'Kemal',
        rejectionReason: 'Not allowed',
      }))
      // No wallet or wallet_transaction writes must occur on rejection.
      expect(tx.set).not.toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('/wallets/') }), expect.anything())
      expect(tx.set).not.toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('/wallet_transactions/') }), expect.anything())
    })

    it('writes a feed entry attributed to the authenticated approver', async () => {
      const tx = transactionWith({
        'families/family-1/money_requests/money-1': { ...baseRequest },
        'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Kemal' },
      })

      await rejectMoneyRequest('family-1', 'money-1', 'Not allowed')

      expect(tx.set).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.stringContaining('families/family-1/feed/') }),
        expect.objectContaining({
          actorId: 'owner-1',
          entityType: 'money_request',
          entityId: 'money-1',
          type: 'custom',
          text: 'Money request rejected.',
          visibleTo: ['child-2', 'child-1'],
        })
      )
    })

    it('requires a non-empty rejection reason', async () => {
      const tx = transactionWith({
        'families/family-1/money_requests/money-1': { ...baseRequest },
        'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Kemal' },
      })
      await expect(rejectMoneyRequest('family-1', 'money-1', '   ')).rejects.toThrow('Rejection reason is required')
      expect(tx.update).not.toHaveBeenCalled()
    })

    it('rejects when the caller is not a parent/owner in the family', async () => {
      const tx = transactionWith({
        'families/family-1/money_requests/money-1': { ...baseRequest },
        'users/owner-1': { familyId: 'other-family', role: 'owner', displayName: 'Kemal' },
      })
      await expect(rejectMoneyRequest('family-1', 'money-1', 'No')).rejects.toThrow('Unauthorized')
      expect(tx.update).not.toHaveBeenCalled()
    })

    it('rejects when the request is not pending approval', async () => {
      const tx = transactionWith({
        'families/family-1/money_requests/money-1': { ...baseRequest, status: 'approved', paymentTransferId: 'pay1' },
        'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Kemal' },
      })
      await expect(rejectMoneyRequest('family-1', 'money-1', 'No')).rejects.toThrow('Request is not pending approval')
      expect(tx.update).not.toHaveBeenCalled()
    })
  })
})

describe('mapApprovalError', () => {
  it('never surfaces raw Firebase permission-denied text', () => {
    const mapped = mapApprovalError({ code: 'permission-denied', message: 'Missing or insufficient permissions.' })
    expect(mapped.message).not.toContain('permission-denied')
    expect(mapped.message).not.toContain('Missing or insufficient permissions')
    expect(mapped.message).toBe('You no longer have permission to manage this request.')
    expect(mapped.code).toBe('permission-denied')
  })

  it('maps already-decided requests to a friendly message', () => {
    const mapped = mapApprovalError(new Error('Request is not pending approval'))
    expect(mapped.message).toBe('This request has already been decided.')
  })

  it('maps missing requests to a refresh prompt', () => {
    const mapped = mapApprovalError(new Error('Request not found'))
    expect(mapped.message).toBe('The request changed while you were reviewing it. Please refresh and try again.')
  })

  it('falls back to a generic message for unknown errors', () => {
    const mapped = mapApprovalError(new Error('boom'))
    expect(mapped.message).toBe('We couldn’t reject this request. Please try again.')
  })
})
