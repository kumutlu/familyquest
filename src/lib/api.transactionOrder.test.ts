import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Transaction-order regression tests.
 *
 * Reproduces the recurring production defect: "Firestore transactions require
 * all reads to be executed before all writes." Every transaction that queues a
 * notification must resolve the dedupe READ in Phase A and apply the WRITE in
 * Phase C. A helper called during the write phase must perform ZERO reads.
 *
 * These tests use a recording fake transaction that fails the test if any
 * `get` occurs after the first `set`/`update`/`delete`.
 */

const firestore = vi.hoisted(() => {
  let generatedId = 0
  const collection = vi.fn((_db: unknown, path: string) => ({ path }))
  const doc = vi.fn((first: { path?: string }, ...parts: string[]) => {
    if (parts.length) return { id: parts.at(-1), path: parts.join('/') }
    generatedId += 1
    return { id: `generated-${generatedId}`, path: `${first.path}/generated-${generatedId}` }
  })
  return {
    collection,
    doc,
    addDoc: vi.fn(),
    runTransaction: vi.fn(),
    serverTimestamp: vi.fn(() => ({ sentinel: 'server-timestamp' })),
    writeBatch: vi.fn(() => ({ set: vi.fn(), commit: vi.fn(async () => {}) })),
    query: vi.fn(() => ({ kind: 'query' })),
    where: vi.fn(),
    getDocs: vi.fn(async () => ({ docs: [] })),
    getDoc: vi.fn(),
    resetIds: () => { generatedId = 0 },
  }
})
const authState = vi.hoisted(() => ({ currentUser: { uid: 'child-1' } as any }))

vi.mock('firebase/firestore', () => ({
  ...firestore,
  setDoc: vi.fn(),
  deleteDoc: vi.fn(), updateDoc: vi.fn(),
}))
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(), signInWithEmailAndPassword: vi.fn(), signInWithPopup: vi.fn(), signOut: vi.fn(),
}))
vi.mock('./firebase', () => ({ db: { name: 'db' }, auth: authState, googleProvider: {} }))

// Split notification helpers: read stage returns a plan, write stage applies it.
const loadNotificationRecipientsInTransaction = vi.fn((..._args: any[]) => ({
  ref: { path: 'families/family-1/notifications/n' },
  data: { familyId: 'family-1' },
}))
const applyNotificationWrites = vi.fn((..._args: any[]) => {})
vi.mock('./notifications', () => ({
  getApproverIds: vi.fn(async () => ['owner-1']),
  getChildIds: vi.fn(async () => ['child-2']),
  loadNotificationRecipientsInTransaction: (...args: any[]) => loadNotificationRecipientsInTransaction(...args),
  applyNotificationWrites: (...args: any[]) => applyNotificationWrites(...args),
}))

import {
  completeTask,
  approveTaskCompletion,
  rejectTaskCompletion,
  addBehaviourEvent,
  redeemReward,
  depositToWallet,
  withdrawFromWallet,
  addFundExpense,
  contributeToFund,
  approveProfileUpdateRequest,
  rejectProfileUpdateRequest,
  createTransferRequest,
  approveTransferRequest,
  rejectTransferRequest,
} from './api'

function snapshot(data?: Record<string, any>) {
  return { exists: () => data !== undefined, data: () => data }
}

/**
 * A fake transaction that records the exact order of operations so we can assert
 * that every `get` happens before every `set`/`update`/`delete`.
 */
function recordingTransaction(docs: Record<string, Record<string, any> | undefined>) {
  const ops: string[] = []
  const tx = {
    get: vi.fn(async (ref: { path?: string }) => {
      if (typeof ref?.path !== 'string') {
        throw new TypeError("Cannot read properties of undefined (reading 'path')")
      }
      ops.push('get')
      return snapshot(docs[ref.path])
    }),
    update: vi.fn(() => { ops.push('update') }),
    set: vi.fn(() => { ops.push('set') }),
    delete: vi.fn(() => { ops.push('delete') }),
    _ops: ops,
  }
  firestore.runTransaction.mockImplementation(async (_db: unknown, callback: any) => callback(tx))
  return tx
}

/** Asserts no `get` occurs after the first write in the recorded op sequence. */
function expectReadsBeforeWrites(tx: { _ops: string[] }) {
  const firstWrite = tx._ops.findIndex(op => op === 'set' || op === 'update' || op === 'delete')
  if (firstWrite === -1) return
  const lateRead = tx._ops.slice(firstWrite).findIndex(op => op === 'get')
  expect(lateRead, `operation order: ${tx._ops.join(', ')}`).toBe(-1)
}

const childUser = { familyId: 'family-1', role: 'child', displayName: 'Muhammed', rewardPoints: 500 }
const ownerUser = { familyId: 'family-1', role: 'owner', displayName: 'Kemal' }
const task = { title: 'Tidy room', pointsReward: 10 }
const wallet = { balance: 1000 }

describe('transaction operation ordering (reads-before-writes)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    firestore.resetIds()
    authState.currentUser = { uid: 'child-1' }
    firestore.getDoc.mockResolvedValue(snapshot(task))
    loadNotificationRecipientsInTransaction.mockResolvedValue({ ref: { path: 'families/family-1/notifications/n' }, data: { familyId: 'family-1' } })
  })

  it('completeTask (Mark as Done) keeps reads before writes', async () => {
    const tx = recordingTransaction({
      'users/child-1': childUser,
      'families/family-1/tasks/task-1': task,
    })
    await completeTask('family-1', 'task-1', 'child-1', true)
    expectReadsBeforeWrites(tx)
    expect(loadNotificationRecipientsInTransaction).toHaveBeenCalled()
    expect(applyNotificationWrites).toHaveBeenCalled()
  })

  it('completeTask never passes a query object to Transaction.get', async () => {
    const tx = recordingTransaction({
      'users/child-1': childUser,
      'families/family-1/tasks/task-1': task,
    })

    await expect(completeTask('family-1', 'task-1', 'child-1', true)).resolves.toBeUndefined()
    expect(tx.get.mock.calls.every(([ref]) => typeof ref?.path === 'string')).toBe(true)
  })

  it('completeTask atomically ignores an existing completion for the logical period', async () => {
    const tx = recordingTransaction({
      'users/child-1': childUser,
      'families/family-1/tasks/task-1': task,
      'families/family-1/task_completions/child-1__task-1__one-time': {
        status: 'approved',
        taskId: 'task-1',
        assigneeId: 'child-1',
      },
    })

    await completeTask('family-1', 'task-1', 'child-1', false)

    expect(tx.set).not.toHaveBeenCalled()
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('completeTask preserves a rejected attempt and creates the next deterministic attempt', async () => {
    const tx = recordingTransaction({
      'users/child-1': childUser,
      'families/family-1/tasks/task-1': task,
      'families/family-1/task_completions/child-1__task-1__one-time': {
        status: 'rejected',
        taskId: 'task-1',
        assigneeId: 'child-1',
      },
    })

    await completeTask('family-1', 'task-1', 'child-1', true)

    const completionSet = (tx.set.mock.calls as any[][])
      .find(([ref]) => ref.path.includes('/task_completions/'))
    expect(completionSet?.[0].path).toBe(
      'families/family-1/task_completions/child-1__task-1__one-time__attempt-2',
    )
  })

  it('completeTask honors an active completion stored under a legacy random ID', async () => {
    firestore.getDocs.mockResolvedValueOnce({
      docs: [{ data: () => ({
        taskId: 'task-1',
        assigneeId: 'child-1',
        status: 'approved',
      }) }],
    } as any)
    const tx = recordingTransaction({
      'users/child-1': childUser,
      'families/family-1/tasks/task-1': task,
    })

    await completeTask('family-1', 'task-1', 'child-1', false)

    expect(tx.get).not.toHaveBeenCalled()
    expect(tx.set).not.toHaveBeenCalled()
  })

  it('approveTaskCompletion keeps reads before writes', async () => {
    authState.currentUser = { uid: 'owner-1' }
    const tx = recordingTransaction({
      'families/family-1/task_completions/c1': { status: 'pending_approval', taskId: 'task-1', assigneeId: 'child-1' },
      'families/family-1/tasks/task-1': task,
      'users/child-1': childUser,
      'users/owner-1': ownerUser,
    })
    await approveTaskCompletion('family-1', 'c1')
    expectReadsBeforeWrites(tx)
  })

  it('rejectTaskCompletion keeps reads before writes', async () => {
    authState.currentUser = { uid: 'owner-1' }
    const tx = recordingTransaction({
      'families/family-1/task_completions/c1': { status: 'pending_approval', taskId: 'task-1', assigneeId: 'child-1' },
      'families/family-1/tasks/task-1': task,
      'users/owner-1': ownerUser,
    })
    await rejectTaskCompletion('family-1', 'c1', 'Needs improvement')
    expectReadsBeforeWrites(tx)
  })

  it('addBehaviourEvent keeps reads before writes', async () => {
    authState.currentUser = { uid: 'owner-1' }
    const tx = recordingTransaction({
      'families/family-1': { debtLimitPence: -5000 },
      'users/child-1': childUser,
      'users/owner-1': ownerUser,
      'families/family-1/wallets/child-1': wallet,
    })
    await addBehaviourEvent('family-1', 'child-1', 'owner-1', { type: 'positive', reason: 'Helped', pointsDelta: 10, walletDelta: 0 })
    expectReadsBeforeWrites(tx)
  })

  it('redeemReward keeps reads before writes', async () => {
    const tx = recordingTransaction({
      'families/family-1/rewards/r1': { title: 'Screen time', cost: 100 },
      'users/child-1': childUser,
    })
    await redeemReward('family-1', 'child-1', 'r1')
    expectReadsBeforeWrites(tx)
  })

  it('depositToWallet keeps reads before writes', async () => {
    authState.currentUser = { uid: 'owner-1' }
    const tx = recordingTransaction({ 'users/child-1': childUser, 'families/family-1/wallets/child-1': wallet })
    await depositToWallet('family-1', 'child-1', 'owner-1', 500, 'Bonus')
    expectReadsBeforeWrites(tx)
  })

  it('withdrawFromWallet keeps reads before writes', async () => {
    authState.currentUser = { uid: 'owner-1' }
    const tx = recordingTransaction({ 'users/child-1': childUser, 'families/family-1/wallets/child-1': wallet })
    await withdrawFromWallet('family-1', 'child-1', 'owner-1', 200, 'Spend')
    expectReadsBeforeWrites(tx)
  })

  it('addFundExpense keeps reads before writes', async () => {
    authState.currentUser = { uid: 'owner-1' }
    const tx = recordingTransaction({ 'families/family-1/funds/f1': { balance: 0 } })
    await addFundExpense('family-1', 'f1', { amount: 300, category: 'food', description: 'Food', fundName: 'Pet Box' })
    expectReadsBeforeWrites(tx)
  })

  it('contributeToFund keeps reads before writes', async () => {
    const tx = recordingTransaction({})
    await contributeToFund('family-1', 'f1', 'child-1', 300, 'Pet Box', 'Muhammed')
    expectReadsBeforeWrites(tx)
  })

  it('approveProfileUpdateRequest keeps reads before writes', async () => {
    authState.currentUser = { uid: 'owner-1' }
    const tx = recordingTransaction({
      'families/family-1/profile_update_requests/req-1': { childId: 'child-1', childName: 'Muhammed', requestedDisplayName: 'Mo', status: 'pending' },
      'users/child-1': childUser,
      'users/owner-1': ownerUser,
    })
    await approveProfileUpdateRequest('family-1', 'req-1')
    expectReadsBeforeWrites(tx)
  })

  it('rejectProfileUpdateRequest keeps reads before writes', async () => {
    authState.currentUser = { uid: 'owner-1' }
    const tx = recordingTransaction({
      'families/family-1/profile_update_requests/req-1': { childId: 'child-1', childName: 'Muhammed', status: 'pending' },
      'users/owner-1': ownerUser,
    })
    await rejectProfileUpdateRequest('family-1', 'req-1', 'No')
    expectReadsBeforeWrites(tx)
  })

  it('createTransferRequest keeps reads before writes', async () => {
    const tx = recordingTransaction({
      'users/child-1': childUser,
      'users/child-2': { familyId: 'family-1', role: 'child', displayName: 'Ben' },
      'families/family-1/wallets/child-1': wallet,
    })
    await createTransferRequest('family-1', 'child-2', 200, 'Hi')
    expectReadsBeforeWrites(tx)
  })

  it('approveTransferRequest keeps reads before writes', async () => {
    authState.currentUser = { uid: 'owner-1' }
    const tx = recordingTransaction({
      'families/family-1/transfer_requests/tr1': { status: 'pending', fromChildId: 'child-1', toChildId: 'child-2', amountPence: 200 },
      'users/owner-1': ownerUser,
      'users/child-1': childUser,
      'users/child-2': { familyId: 'family-1', role: 'child', displayName: 'Ben' },
      'families/family-1/wallets/child-1': wallet,
      'families/family-1/wallets/child-2': wallet,
    })
    await approveTransferRequest('family-1', 'tr1')
    expectReadsBeforeWrites(tx)
  })

  it('rejectTransferRequest keeps reads before writes', async () => {
    authState.currentUser = { uid: 'owner-1' }
    const tx = recordingTransaction({
      'families/family-1/transfer_requests/tr1': { status: 'pending', fromChildId: 'child-1', toChildName: 'Ben' },
      'users/owner-1': ownerUser,
    })
    await rejectTransferRequest('family-1', 'tr1', 'No')
    expectReadsBeforeWrites(tx)
  })
})
