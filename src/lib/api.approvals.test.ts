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

import { approveTaskCompletion, rejectTaskCompletion } from './api'

function snapshot(data?: Record<string, any>) { return { exists: () => data !== undefined, data: () => data } }
function transactionWith(docs: Record<string, Record<string, any> | undefined>) {
  const tx = {
    get: vi.fn(async (ref: { path: string }) => snapshot(docs[ref.path])),
    update: vi.fn(), set: vi.fn(), delete: vi.fn(),
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
    expect(tx.update).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/child-1' }), { rewardPoints: 15, lifetimeXP: 30 })
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
})
