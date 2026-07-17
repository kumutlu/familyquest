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

import { addFundExpense, cancelPendingApproval, depositToWallet } from './api'

function snapshot(data?: Record<string, any>) { return { exists: () => data !== undefined, data: () => data } }
function transactionWith(docs: Record<string, Record<string, any> | undefined>) {
  const tx = {
    get: vi.fn(async (ref: { path: string }) => snapshot(docs[ref.path])),
    update: vi.fn(), set: vi.fn(), delete: vi.fn(),
  }
  firestore.runTransaction.mockImplementation(async (_db: unknown, callback: any) => callback(tx))
  return tx
}

describe('traceable transaction writers', () => {
  beforeEach(() => { vi.clearAllMocks(); firestore.reset(); authState.currentUser = { uid: 'owner-1' } })

  it('derives a manual deposit actor from auth and records its immutable effect', async () => {
    const tx = transactionWith({
      'users/child-1': { familyId: 'family-1', role: 'child' },
      'families/family-1/wallets/child-1': { balance: 200 },
    })

    await depositToWallet('family-1', 'child-1', 'forged-parent', 500, 'Pocket money')

    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({ path: 'families/family-1/wallet_transactions/generated-1' }), expect.objectContaining({
      sourceId: 'generated-1', familyId: 'family-1', parentRef: 'owner-1', status: 'completed',
      effectSnapshot: expect.objectContaining({ actorId: 'owner-1', childId: 'child-1', walletDeltaPence: 500 }),
    }))
  })

  it('records an expense effect and allows the fund to go negative (no insufficient-balance rejection)', async () => {
    const tx = transactionWith({ 'families/family-1/funds/fund-1': { balance: 1_000 } })
    await addFundExpense('family-1', 'fund-1', { amount: 300, category: 'vet', description: 'Check-up', fundName: 'Pet Box' })
    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({ path: 'families/family-1/fund_transactions/generated-1' }), expect.objectContaining({
      sourceId: 'generated-1', actorId: 'owner-1', familyId: 'family-1', status: 'completed',
      effectSnapshot: expect.objectContaining({ actorId: 'owner-1', fundId: 'fund-1', fundDeltaPence: -300 }),
    }))
    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'families/family-1/funds/fund-1' }),
      expect.objectContaining({ balance: 700 })
    )

    // Overdrawing is permitted: a £3.00 expense against a £1.00 balance yields -£2.00.
    const overdrawTx = transactionWith({ 'families/family-1/funds/fund-1': { balance: 100 } })
    await addFundExpense('family-1', 'fund-1', { amount: 300, category: 'vet', description: 'Check-up', fundName: 'Pet Box' })
    expect(overdrawTx.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'families/family-1/funds/fund-1' }),
      expect.objectContaining({ balance: -200 })
    )
  })

  it('cancels only the authenticated originator’s pending request without balance writes', async () => {
    authState.currentUser = { uid: 'child-1' }
    const tx = transactionWith({
      'families/family-1/transfer_requests/request-1': { status: 'pending', fromChildId: 'child-1' },
    })
    await cancelPendingApproval('family-1', 'transfer', 'request-1')
    expect(tx.update).toHaveBeenCalledWith(expect.anything(), {
      status: 'cancelled', cancelledBy: 'child-1', cancelledAt: { server: true },
    })
    expect(tx.set).not.toHaveBeenCalled()
  })
})
