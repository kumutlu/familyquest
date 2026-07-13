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

import { approveJoinRequest, approveMoneyRequest, approveTaskCompletion, approveTransferRequest, cancelPendingApproval, rejectTaskCompletion } from './api'

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

    expect(tx.update).toHaveBeenCalledWith(expect.objectContaining({ path: 'families/family-1/task_completions/completion-1' }), expect.objectContaining({
      status: 'approved', parentComment: 'Great work', reviewedBy: 'owner-1', reviewedByName: 'Kemal', awardedPoints: 10,
    }))
    expect(tx.update).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/child-1' }), { rewardPoints: 15, lifetimeXP: 30, lastTaskCompletionId: 'completion-1' })
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

  it('uses the production transfer path when both wallets are missing without reading after a write', async () => {
    const tx = transactionWith({
      'families/family-1/transfer_requests/transfer-1': { fromChildId: 'child-1', toChildId: 'child-2', amountPence: 100, status: 'pending' },
      'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Owner' },
      'users/child-1': { familyId: 'family-1', role: 'child', walletBalance: 250 },
      'users/child-2': { familyId: 'family-1', role: 'child' },
    }, true)

    await approveTransferRequest('family-1', 'transfer-1')

    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({ path: 'families/family-1/wallets/child-1' }), expect.objectContaining({
      balance: 150, lastTransferReqId: 'transfer-1', migratedFromLegacy: true,
    }), { merge: true })
    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({ path: 'families/family-1/wallets/child-2' }), expect.objectContaining({
      balance: 100, lastTransferReqId: 'transfer-1', migratedFromLegacy: true,
    }), { merge: true })
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
      balance: 125, lastTransferReqId: 'money-1', migratedFromLegacy: true,
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
})
