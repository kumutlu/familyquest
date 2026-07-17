import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mirror of the firebase/firestore mock used by api.traceability.test.ts so we
// can assert on the exact balance written inside the expense transaction.
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

import { addFundExpense } from './api'

function snapshot(data?: Record<string, any>) { return { exists: () => data !== undefined, data: () => data } }
function transactionWith(docs: Record<string, Record<string, any> | undefined>) {
  const tx = {
    get: vi.fn(async (ref: { path: string }) => snapshot(docs[ref.path])),
    update: vi.fn(), set: vi.fn(), delete: vi.fn(),
  }
  firestore.runTransaction.mockImplementation(async (_db: unknown, callback: any) => callback(tx))
  return tx
}

// Extract the balance written to the fund document inside the transaction.
function updatedFundBalance(tx: any): number | undefined {
  const call = tx.update.mock.calls.find((c: any[]) => c[0]?.path?.endsWith('/funds/fund-1'))
  return call?.[1]?.balance
}

describe('addFundExpense — negative balance support', () => {
  beforeEach(() => { vi.clearAllMocks(); firestore.reset(); authState.currentUser = { uid: 'owner-1' } })

  it('1. records a £5 expense against a £10 balance, leaving £5', async () => {
    const tx = transactionWith({ 'families/family-1/funds/fund-1': { balance: 1000 } })
    await addFundExpense('family-1', 'fund-1', { amount: 500, category: 'Food', description: 'Treats', fundName: 'Pet Box' })
    expect(updatedFundBalance(tx)).toBe(500)
  })

  it('2. records a £10 expense against a £10 balance, leaving exactly £0', async () => {
    const tx = transactionWith({ 'families/family-1/funds/fund-1': { balance: 1000 } })
    await addFundExpense('family-1', 'fund-1', { amount: 1000, category: 'Food', description: 'Vet', fundName: 'Pet Box' })
    expect(updatedFundBalance(tx)).toBe(0)
  })

  it('3 & 4. records an £11 expense against a £7.12 balance, leaving exactly -£3.88', async () => {
    const tx = transactionWith({ 'families/family-1/funds/fund-1': { balance: 712 } })
    await addFundExpense('family-1', 'fund-1', { amount: 1100, category: 'Vet', description: 'Emergency', fundName: 'Pet Box' })
    expect(updatedFundBalance(tx)).toBe(-388)
  })

  it('5. does not clamp a negative balance to zero', async () => {
    const tx = transactionWith({ 'families/family-1/funds/fund-1': { balance: 100 } })
    await addFundExpense('family-1', 'fund-1', { amount: 500, category: 'Vet', description: 'Big bill', fundName: 'Pet Box' })
    expect(updatedFundBalance(tx)).toBe(-400)
    expect(updatedFundBalance(tx)).not.toBe(0)
  })

  it('10. rejects a zero amount', async () => {
    const tx = transactionWith({ 'families/family-1/funds/fund-1': { balance: 1000 } })
    await expect(addFundExpense('family-1', 'fund-1', { amount: 0, category: 'Food', description: 'x', fundName: 'Pet Box' })).rejects.toThrow(/positive integer/)
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('10. rejects a negative amount', async () => {
    const tx = transactionWith({ 'families/family-1/funds/fund-1': { balance: 1000 } })
    await expect(addFundExpense('family-1', 'fund-1', { amount: -200, category: 'Food', description: 'x', fundName: 'Pet Box' })).rejects.toThrow(/positive integer/)
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('10. rejects a non-integer (fractional pence) amount', async () => {
    const tx = transactionWith({ 'families/family-1/funds/fund-1': { balance: 1000 } })
    await expect(addFundExpense('family-1', 'fund-1', { amount: 123.45, category: 'Food', description: 'x', fundName: 'Pet Box' })).rejects.toThrow(/positive integer/)
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('10. rejects a malformed (NaN) amount', async () => {
    const tx = transactionWith({ 'families/family-1/funds/fund-1': { balance: 1000 } })
    await expect(addFundExpense('family-1', 'fund-1', { amount: NaN, category: 'Food', description: 'x', fundName: 'Pet Box' })).rejects.toThrow(/positive integer/)
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('19. never rejects an expense for insufficient balance (overdraw is allowed)', async () => {
    const tx = transactionWith({ 'families/family-1/funds/fund-1': { balance: 0 } })
    await expect(addFundExpense('family-1', 'fund-1', { amount: 9999, category: 'Vet', description: 'Huge', fundName: 'Pet Box' })).resolves.toBeUndefined()
    expect(updatedFundBalance(tx)).toBe(-9999)
  })
})
