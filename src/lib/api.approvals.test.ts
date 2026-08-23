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

import { approveJoinRequest, approveMoneyRequest, approveProfileUpdateRequest, approveTaskCompletion, approveTransferRequest, cancelPendingApproval, rejectMoneyRequest, rejectProfileUpdateRequest, rejectTaskCompletion, mapApprovalError } from './api'

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
    expect(tx.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'rejected', reviewedBy: 'owner-1', parentComment: 'Please retry' }))
  })

  it('rejects a task with empty/absent rejection comment', async () => {
    const tx = transactionWith({
      'families/family-1/task_completions/completion-1': { taskId: 'task-1', assigneeId: 'child-1', status: 'pending_approval' },
      'families/family-1/tasks/task-1': { title: 'Tidy room', pointsReward: 10 },
      'users/owner-1': { familyId: 'family-1', role: 'parent', displayName: 'Parent' },
    })
    await rejectTaskCompletion('family-1', 'completion-1')
    expect(tx.update).toHaveBeenCalledTimes(1)
    expect(tx.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'rejected', reviewedBy: 'owner-1', parentComment: '' }))
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

  it('passes an owner-selected parent role through the validated approval transaction', async () => {
    const tx = transactionWith({
      'families/family-1/join_requests/request-1': { uid: 'target-1', displayName: 'Stored Name', status: 'pending' },
      'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Owner' },
    })
    await approveJoinRequest('family-1', 'request-1', 'parent')
    expect(tx.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/target-1' }),
      expect.objectContaining({ role: 'parent', familyId: 'family-1' }),
      { merge: true },
    )
  })

  it('ignores a legacy requester role and writes only the owner-selected role', async () => {
    const tx = transactionWith({
      'families/family-1/join_requests/request-1': {
        uid: 'target-1',
        displayName: 'Stored Name',
        status: 'pending',
        requestedRole: 'owner',
      },
      'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Owner' },
    })
    await approveJoinRequest('family-1', 'request-1', 'child')
    expect(tx.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/target-1' }),
      expect.objectContaining({ role: 'child' }),
      { merge: true },
    )
  })

  it('uses the invitation intendedRole instead of the owner-selected role', async () => {
    const tx = transactionWith({
      'families/family-1/join_requests/request-1': {
        uid: 'target-1',
        displayName: 'Stored Name',
        status: 'pending',
        intendedRole: 'child',
        invitationCode: '7ZXWRZ',
      },
      'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Owner' },
    })
    // The owner tries to promote an invitation-derived child to parent.
    await approveJoinRequest('family-1', 'request-1', 'parent')
    expect(tx.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/target-1' }),
      expect.objectContaining({ role: 'child' }),
      { merge: true },
    )
    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'families/family-1/join_requests/request-1' }),
      expect.objectContaining({ status: 'approved', assignedRole: 'child' }),
    )
  })

  it('honours a parent-intended invitation record', async () => {
    const tx = transactionWith({
      'families/family-1/join_requests/request-1': {
        uid: 'target-1',
        displayName: 'Stored Name',
        status: 'pending',
        intendedRole: 'parent',
        invitationCode: '7ZXWRZ',
      },
      'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Owner' },
    })
    await approveJoinRequest('family-1', 'request-1', 'child')
    expect(tx.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/target-1' }),
      expect.objectContaining({ role: 'parent' }),
      { merge: true },
    )
  })

  it('refuses to honour a corrupt owner intendedRole on a join request', async () => {
    const tx = transactionWith({
      'families/family-1/join_requests/request-1': {
        uid: 'target-1',
        displayName: 'Stored Name',
        status: 'pending',
        intendedRole: 'owner',
      },
      'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Owner' },
    })
    await expect(approveJoinRequest('family-1', 'request-1', 'parent')).rejects.toThrow(
      'Join request role is invalid',
    )
    expect(tx.set).not.toHaveBeenCalled()
  })

  it('rejects an unsupported approval role before starting a transaction', async () => {
    await expect(
      approveJoinRequest('family-1', 'request-1', 'owner' as any),
    ).rejects.toThrow('Unsupported approval role')
    expect(firestore.runTransaction).not.toHaveBeenCalled()
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

describe('profile_update request authorization', () => {
  beforeEach(() => { vi.clearAllMocks(); firestore.reset(); authState.currentUser = { uid: 'owner-1' } })

  it('rejects approval when the reviewer is not a parent or owner', async () => {
    const tx = transactionWith({
      'families/family-1/profile_update_requests/pu-1': { childId: 'child-1', status: 'pending', childName: 'Kid' },
      'users/child-1': { familyId: 'family-1', role: 'child' },
      'users/owner-1': { familyId: 'family-1', role: 'child', displayName: 'Kid' },
    })
    await expect(approveProfileUpdateRequest('family-1', 'pu-1')).rejects.toThrow('Unauthorized')
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('rejects rejection when the reviewer is not a parent or owner', async () => {
    const tx = transactionWith({
      'families/family-1/profile_update_requests/pu-1': { childId: 'child-1', status: 'pending', childName: 'Kid' },
      'users/child-1': { familyId: 'family-1', role: 'child' },
      'users/owner-1': { familyId: 'family-1', role: 'child', displayName: 'Kid' },
    })
    await expect(rejectProfileUpdateRequest('family-1', 'pu-1')).rejects.toThrow('Unauthorized')
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('allows approval when the reviewer is a parent', async () => {
    const tx = transactionWith({
      'families/family-1/profile_update_requests/pu-1': { childId: 'child-1', status: 'pending', childName: 'Kid' },
      'users/child-1': { familyId: 'family-1', role: 'child' },
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'Parent' },
    })
    authState.currentUser = { uid: 'parent-1' }
    await approveProfileUpdateRequest('family-1', 'pu-1')
    expect(tx.update).toHaveBeenCalled()
  })

  it('allows rejection when the reviewer is a parent', async () => {
    const tx = transactionWith({
      'families/family-1/profile_update_requests/pu-1': { childId: 'child-1', status: 'pending', childName: 'Kid' },
      'users/child-1': { familyId: 'family-1', role: 'child' },
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'Parent' },
    })
    authState.currentUser = { uid: 'parent-1' }
    await rejectProfileUpdateRequest('family-1', 'pu-1')
    expect(tx.update).toHaveBeenCalled()
  })
})

describe('mapApprovalError', () => {
  it('never surfaces raw Firebase permission-denied text, and never blames the actor', () => {
    const mapped = mapApprovalError({ code: 'permission-denied', message: 'Missing or insufficient permissions.' })
    expect(mapped.message).not.toContain('permission-denied')
    expect(mapped.message).not.toContain('Missing or insufficient permissions')
    expect(mapped.message).not.toContain('You no longer have permission')
    expect(mapped.message).toBe('This request could not be updated. Please try again.')
    expect(mapped.code).toBe('permission-denied')
  })

  it('logs full technical context for a genuine authorization failure', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mapApprovalError({ code: 'permission-denied', message: 'Missing or insufficient permissions.' }, {
      requestPath: 'families/family-1/transfer_requests/req-1',
      actorId: 'parent-1', actorRole: 'parent', actorFamilyId: 'family-1',
      requestFamilyId: 'family-1', requestStatus: 'pending', operation: 'approve',
    })
    expect(spy).toHaveBeenCalledWith('[approval] operation failed', expect.objectContaining({
      requestPath: 'families/family-1/transfer_requests/req-1',
      actorId: 'parent-1', actorRole: 'parent', actorFamilyId: 'family-1',
      requestFamilyId: 'family-1', requestStatus: 'pending', operation: 'approve',
      firebaseErrorCode: 'permission-denied',
    }))
    spy.mockRestore()
  })

  it('maps an already-handled request to the stale message (not a permission error)', () => {
    for (const message of ['Request is not pending approval', 'Request not found', 'Request not valid']) {
      const mapped = mapApprovalError(new Error(message))
      expect(mapped.message).toBe('This request has already been handled.')
      expect(mapped.stale).toBe(true)
    }
  })

  it('maps a lost session to a sign-in prompt', () => {
    expect(mapApprovalError(new Error('Not authenticated')).message).toBe('Your session has expired. Please sign in again.')
  })

  it('falls back to a neutral retry message for unknown errors', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const mapped = mapApprovalError(new Error('boom'))
    expect(mapped.message).toBe('This request could not be updated. Please try again.')
    expect(mapped.stale).toBeFalsy()
  })
})
