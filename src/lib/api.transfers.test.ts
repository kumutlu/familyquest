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
const authState = vi.hoisted(() => ({ currentUser: { uid: 'child-1' } as any }))

vi.mock('firebase/firestore', () => ({
  ...firestore, setDoc: vi.fn(), addDoc: vi.fn(), query: vi.fn(), where: vi.fn(), getDocs: vi.fn(), getDoc: vi.fn(),
  deleteDoc: vi.fn(), updateDoc: vi.fn(), writeBatch: vi.fn(),
}))
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(), signInWithEmailAndPassword: vi.fn(), signInWithPopup: vi.fn(), signOut: vi.fn(),
}))
vi.mock('./firebase', () => ({ db: { name: 'db' }, auth: authState, googleProvider: {} }))

import { createTransferRequest, approveTransferRequest, rejectTransferRequest } from './api'

function snapshot(data?: Record<string, any>) {
  return { exists: () => data !== undefined, data: () => data }
}
function transactionWith(docs: Record<string, Record<string, any> | undefined>, enforceReadBeforeWrite = false) {
  let wrote = false
  const tx = {
    get: vi.fn(async (ref: { path: string }) => {
      if (enforceReadBeforeWrite && wrote) throw new Error('Firestore transactions require all reads to be executed before all writes.')
      return snapshot(docs[ref.path])
    }),
    update: vi.fn(() => { wrote = true }),
    set: vi.fn(() => { wrote = true }),
    delete: vi.fn(() => { wrote = true }),
  }
  firestore.runTransaction.mockImplementation(async (_db: unknown, callback: any) => callback(tx))
  return tx
}

const setCall = (tx: any, path: string) => tx.set.mock.calls.find((c: any[]) => c[0]?.path === path)?.[1]
const updateCall = (tx: any, path: string) => tx.update.mock.calls.find((c: any[]) => c[0]?.path === path)?.[1]

describe('child-to-child transfer requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    firestore.reset()
    authState.currentUser = { uid: 'child-1' }
  })

  describe('createTransferRequest', () => {
    const baseDocs = (overrides: Record<string, any> = {}) => ({
      'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'C1', walletBalance: 500 },
      'users/child-2': { familyId: 'family-1', role: 'child', displayName: 'C2' },
      'families/family-1/wallets/child-1': { balance: 500 },
      ...overrides,
    })

    it('creates a pending request for a valid sibling transfer', async () => {
      const tx = transactionWith(baseDocs())
      await createTransferRequest('family-1', 'child-2', 100, 'Thanks!')

      const req = setCall(tx, 'families/family-1/transfer_requests/generated-1')
      expect(req).toMatchObject({
        familyId: 'family-1',
        fromChildId: 'child-1',
        toChildId: 'child-2',
        amountPence: 100,
        message: 'Thanks!',
        status: 'pending',
      })
      // No money moves at creation time.
      expect(tx.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ path: 'families/family-1/wallets/child-1' }),
        expect.anything(),
      )
    })

    it('blocks self-transfer', async () => {
      transactionWith(baseDocs())
      await expect(createTransferRequest('family-1', 'child-1', 100, '')).rejects.toThrow(/recipient must differ/i)
    })

    it('blocks transfers to a child in another family', async () => {
      transactionWith({
        ...baseDocs(),
        'users/child-2': { familyId: 'family-2', role: 'child', displayName: 'C2' },
      })
      await expect(createTransferRequest('family-1', 'child-2', 100, '')).rejects.toThrow(/same family/i)
    })

    it('blocks non-integer (fractional pence) amounts', async () => {
      transactionWith(baseDocs())
      await expect(createTransferRequest('family-1', 'child-2', 100.5, '')).rejects.toThrow(/invalid amount/i)
    })

    it('blocks requests that exceed the sender balance', async () => {
      transactionWith({
        ...baseDocs(),
        'families/family-1/wallets/child-1': { balance: 50 },
      })
      await expect(createTransferRequest('family-1', 'child-2', 100, '')).rejects.toThrow(/insufficient funds/i)
    })

    it('allows a request that exactly matches the sender balance', async () => {
      const tx = transactionWith({
        ...baseDocs(),
        'families/family-1/wallets/child-1': { balance: 100 },
      })
      await createTransferRequest('family-1', 'child-2', 100, '')
      const req = setCall(tx, 'families/family-1/transfer_requests/generated-1')
      expect(req.status).toBe('pending')
      expect(req.amountPence).toBe(100)
    })

    it('rejects creation with WALLET_NOT_FOUND when the sender wallet document is missing (never uses legacy users.walletBalance)', async () => {
      transactionWith({
        'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'C1', walletBalance: 999999 },
        'users/child-2': { familyId: 'family-1', role: 'child', displayName: 'C2' },
        // Intentionally no families/family-1/wallets/child-1 document.
      })
      await expect(createTransferRequest('family-1', 'child-2', 100, 'Thanks!')).rejects.toMatchObject({
        code: 'WALLET_NOT_FOUND',
        childId: 'child-1',
      })
    })

    it('uses the canonical wallet balance, never the legacy users.walletBalance', async () => {
      // Legacy profile claims 999999 but the canonical wallet says 50.
      const tx = transactionWith({
        ...baseDocs(),
        'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'C1', walletBalance: 999999 },
        'families/family-1/wallets/child-1': { balance: 50 },
      })
      await expect(createTransferRequest('family-1', 'child-2', 100, '')).rejects.toThrow(/insufficient funds/i)
      expect(setCall(tx, 'families/family-1/transfer_requests/generated-1')).toBeUndefined()
    })
  })

  describe('approveTransferRequest', () => {
    const reviewerDocs = (overrides: Record<string, any> = {}) => ({
      'families/family-1/transfer_requests/transfer-1': {
        fromChildId: 'child-1', toChildId: 'child-2', amountPence: 100, status: 'pending',
        fromChildName: 'C1', toChildName: 'C2',
      },
      'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Owner' },
      'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'C1' },
      'users/child-2': { familyId: 'family-1', role: 'child', displayName: 'C2' },
      'families/family-1/wallets/child-1': { balance: 500 },
      'families/family-1/wallets/child-2': { balance: 200 },
      ...overrides,
    })

    beforeEach(() => { authState.currentUser = { uid: 'owner-1' } })

    it('moves money, writes ledger entries and notifies both parties on approval', async () => {
      const tx = transactionWith(reviewerDocs())

      await approveTransferRequest('family-1', 'transfer-1')

      // Balances updated atomically.
      expect(setCall(tx, 'families/family-1/wallets/child-1')).toMatchObject({ balance: 400 })
      expect(setCall(tx, 'families/family-1/wallets/child-2')).toMatchObject({ balance: 300 })

      // Ledger entries created correctly.
      const out = setCall(tx, 'families/family-1/wallet_transactions/generated-1_out')
      const inn = setCall(tx, 'families/family-1/wallet_transactions/generated-1_in')
      expect(out).toMatchObject({ type: 'transfer_out', childId: 'child-1', counterpartyChildId: 'child-2', amountPence: -100, description: 'Sent to C2' })
      expect(inn).toMatchObject({ type: 'transfer_in', childId: 'child-2', counterpartyChildId: 'child-1', amountPence: 100, description: 'Received from C1' })

      // Request marked approved.
      expect(updateCall(tx, 'families/family-1/transfer_requests/transfer-1')).toMatchObject({ status: 'approved' })

      // Notifications created for sender and recipient.
      const senderNote = setCall(tx, 'families/family-1/feed/generated-2')
      const recipientNote = setCall(tx, 'families/family-1/feed/generated-3')
      expect(senderNote).toMatchObject({ text: 'Your transfer to C2 was approved.', visibleTo: ['child-1'] })
      expect(recipientNote).toMatchObject({ text: 'You received £1.00 from C1.', visibleTo: ['child-2'] })
    })

    it('fails approval when the sender no longer has sufficient funds', async () => {
      const tx = transactionWith({
        ...reviewerDocs(),
        'families/family-1/wallets/child-1': { balance: 50 },
      })

      await expect(approveTransferRequest('family-1', 'transfer-1')).rejects.toThrow(/sufficient funds/i)
      // Nothing was committed.
      expect(updateCall(tx, 'families/family-1/transfer_requests/transfer-1')).toBeUndefined()
      expect(setCall(tx, 'families/family-1/wallets/child-1')).toBeUndefined()
    })

    it('rejects approval by a non-parent/owner (child cannot approve)', async () => {
      authState.currentUser = { uid: 'child-9' }
      const tx = transactionWith({
        ...reviewerDocs(),
        'users/child-9': { familyId: 'family-1', role: 'child', displayName: 'C9' },
      })

      await expect(approveTransferRequest('family-1', 'transfer-1')).rejects.toThrow(/parent\/owner/i)
      expect(updateCall(tx, 'families/family-1/transfer_requests/transfer-1')).toBeUndefined()
    })

    it('allows a parent/owner to approve', async () => {
      const tx = transactionWith(reviewerDocs())
      await expect(approveTransferRequest('family-1', 'transfer-1')).resolves.toBeUndefined()
      expect(updateCall(tx, 'families/family-1/transfer_requests/transfer-1')?.status).toBe('approved')
    })

    it('rejects approval with WALLET_NOT_FOUND when the sender wallet is missing (no partial writes)', async () => {
      const tx = transactionWith({
        ...reviewerDocs(),
        'families/family-1/wallets/child-1': undefined,
      })
      await expect(approveTransferRequest('family-1', 'transfer-1')).rejects.toMatchObject({
        code: 'WALLET_NOT_FOUND',
        childId: 'child-1',
      })
      expect(setCall(tx, 'families/family-1/wallets/child-1')).toBeUndefined()
      expect(setCall(tx, 'families/family-1/wallets/child-2')).toBeUndefined()
      expect(updateCall(tx, 'families/family-1/transfer_requests/transfer-1')).toBeUndefined()
    })

    it('rejects approval with WALLET_NOT_FOUND when the recipient wallet is missing (no partial writes)', async () => {
      const tx = transactionWith({
        ...reviewerDocs(),
        'families/family-1/wallets/child-2': undefined,
      })
      await expect(approveTransferRequest('family-1', 'transfer-1')).rejects.toMatchObject({
        code: 'WALLET_NOT_FOUND',
        childId: 'child-2',
      })
      expect(setCall(tx, 'families/family-1/wallets/child-1')).toBeUndefined()
      expect(setCall(tx, 'families/family-1/wallets/child-2')).toBeUndefined()
      expect(updateCall(tx, 'families/family-1/transfer_requests/transfer-1')).toBeUndefined()
    })

    it('approves using only canonical wallet balances, ignoring any legacy users.walletBalance', async () => {
      const tx = transactionWith({
        ...reviewerDocs(),
        'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'C1', walletBalance: 999999 },
        'users/child-2': { familyId: 'family-1', role: 'child', displayName: 'C2', walletBalance: 999999 },
      })
      await approveTransferRequest('family-1', 'transfer-1')
      expect(setCall(tx, 'families/family-1/wallets/child-1')).toMatchObject({ balance: 400 })
      expect(setCall(tx, 'families/family-1/wallets/child-2')).toMatchObject({ balance: 300 })
    })
  })

  describe('rejectTransferRequest', () => {
    const rejectDocs = (overrides: Record<string, any> = {}) => ({
      'families/family-1/transfer_requests/transfer-1': {
        fromChildId: 'child-1', toChildId: 'child-2', amountPence: 100, status: 'pending',
        fromChildName: 'C1', toChildName: 'C2',
      },
      'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Owner' },
      ...overrides,
    })

    beforeEach(() => { authState.currentUser = { uid: 'owner-1' } })

    it('marks the request rejected and notifies the sender (no money moves)', async () => {
      const tx = transactionWith(rejectDocs())

      await rejectTransferRequest('family-1', 'transfer-1', 'Not now')

      expect(updateCall(tx, 'families/family-1/transfer_requests/transfer-1')).toMatchObject({ status: 'rejected' })
      // No wallet or ledger writes on rejection.
      expect(setCall(tx, 'families/family-1/wallets/child-1')).toBeUndefined()
      expect(setCall(tx, 'families/family-1/wallets/child-2')).toBeUndefined()

      const note = setCall(tx, 'families/family-1/feed/generated-1')
      expect(note).toMatchObject({ text: 'Your transfer to C2 was rejected.', visibleTo: ['child-1'] })
    })

    it('rejects when attempted by a child', async () => {
      authState.currentUser = { uid: 'child-9' }
      transactionWith({
        ...rejectDocs(),
        'users/child-9': { familyId: 'family-1', role: 'child', displayName: 'C9' },
      })
      await expect(rejectTransferRequest('family-1', 'transfer-1', 'x')).rejects.toThrow(/parent\/owner/i)
    })
  })
})
