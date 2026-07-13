import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    runTransaction: vi.fn(),
    serverTimestamp: vi.fn(() => ({ sentinel: 'server-timestamp' })),
    updateDoc: vi.fn(),
    resetIds: () => { generatedId = 0 },
  }
})
const authState = vi.hoisted(() => ({ currentUser: { uid: 'owner-1' } as any }))

vi.mock('firebase/firestore', () => ({
  ...firestore,
  setDoc: vi.fn(), addDoc: vi.fn(), query: vi.fn(), where: vi.fn(), getDocs: vi.fn(), getDoc: vi.fn(),
  deleteDoc: vi.fn(), writeBatch: vi.fn(),
}))
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(), signInWithEmailAndPassword: vi.fn(), signInWithPopup: vi.fn(), signOut: vi.fn(),
}))
vi.mock('./firebase', () => ({ db: { name: 'db' }, auth: authState, googleProvider: {} }))

import { addBehaviourEvent, updateDebtLimit } from './api'

type UserData = Record<string, unknown>

function snapshot(data?: UserData) {
  return { exists: () => data !== undefined, data: () => data }
}

function installTransaction(docs: Record<string, UserData | undefined>) {
  const transaction = {
    get: vi.fn(async (ref: { path: string }) => snapshot(docs[ref.path])),
    update: vi.fn(),
    set: vi.fn(),
  }
  firestore.runTransaction.mockImplementation(async (_db: unknown, callback: (tx: typeof transaction) => unknown) => callback(transaction))
  return transaction
}

describe('addBehaviourEvent transaction contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    firestore.resetIds()
    authState.currentUser = { uid: 'owner-1' }
  })

  const baseDocs = {
    'families/family-1': { debtLimitPence: -5000 },
    'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Ada', rewardPoints: 10, lifetimeXP: 100, walletBalance: 0 },
    'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Kemal' },
  }

  it('atomically applies a financial penalty and links its preallocated event to the ledger', async () => {
    const transaction = installTransaction(baseDocs)

    const eventId = await addBehaviourEvent('family-1', 'child-1', 'owner-1', {
      type: 'financial', reason: '  Broken headphones  ', pointsDelta: 0, walletDelta: -500,
    })

    expect(firestore.runTransaction).toHaveBeenCalledTimes(1)
    expect(transaction.update).toHaveBeenCalledWith(expect.objectContaining({ path: 'families/family-1/wallets/child-1' }), { balance: -500 })
    const eventWrite = transaction.set.mock.calls.find(([ref]) => ref.path.includes('/behaviour_events/'))?.[1]
    const ledgerWrite = transaction.set.mock.calls.find(([ref]) => ref.path.includes('/wallet_transactions/'))?.[1]
    expect(eventWrite).toMatchObject({
      familyId: 'family-1', childId: 'child-1', type: 'financial', reason: 'Broken headphones',
      pointsDelta: 0, walletDelta: -500, createdBy: 'owner-1', createdByName: 'Kemal',
    })
    expect(ledgerWrite).toMatchObject({
      type: 'financial_penalty', eventId, childId: 'child-1', amount: 500,
      reason: 'Broken headphones', createdBy: 'owner-1', createdByName: 'Kemal',
    })
    expect(eventId).toBe('generated-1')

    const feedWrite = transaction.set.mock.calls.find(([ref]) => ref.path.includes('/feed/'))?.[1]
    expect(feedWrite).toMatchObject({
      type: 'behaviour', behaviourType: 'financial', reason: 'Broken headphones',
      pointsDelta: 0, walletDelta: -500, childId: 'child-1', actorId: 'owner-1',
      text: 'Logged behaviour for Ada: Broken headphones (-£5.00)'
    })
  })

  it('stores the applied negative delta, clamps points, preserves XP, and creates no ledger', async () => {
    const transaction = installTransaction(baseDocs)

    await addBehaviourEvent('family-1', 'child-1', 'owner-1', {
      type: 'negative', reason: 'Late home', pointsDelta: -25, walletDelta: 0,
    })

    expect(transaction.update).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/child-1' }), { rewardPoints: 0, lastBehaviourEventId: 'generated-1' })
    const eventWrite = transaction.set.mock.calls.find(([ref]) => ref.path.includes('/behaviour_events/'))?.[1]
    expect(eventWrite).toMatchObject({ pointsDelta: -10, walletDelta: 0 })
    expect(transaction.set.mock.calls.some(([ref]) => ref.path.includes('/wallet_transactions/'))).toBe(false)

    const feedWrite = transaction.set.mock.calls.find(([ref]) => ref.path.includes('/feed/'))?.[1]
    expect(feedWrite).toMatchObject({
      type: 'behaviour', behaviourType: 'negative', reason: 'Late home',
      pointsDelta: -10, walletDelta: 0, childId: 'child-1', actorId: 'owner-1',
      text: 'Logged behaviour for Ada: Late home (-10 pts)'
    })
  })

  it('normalizes the legacy dashboard call into the V2 event shape during migration', async () => {
    const transaction = installTransaction(baseDocs)

    await addBehaviourEvent('family-1', 'child-1', 'owner-1', { type: 'positive', reason: 'Helped out', pointsDelta: 5, walletDelta: 0 })

    const eventWrite = transaction.set.mock.calls.find(([ref]) => ref.path.includes('/behaviour_events/'))?.[1]
    expect(eventWrite).toMatchObject({ type: 'positive', reason: 'Helped out', pointsDelta: 5, walletDelta: 0 })

    const feedWrite = transaction.set.mock.calls.find(([ref]) => ref.path.includes('/feed/'))?.[1]
    expect(feedWrite).toMatchObject({
      type: 'behaviour', behaviourType: 'positive', reason: 'Helped out',
      pointsDelta: 5, walletDelta: 0, childId: 'child-1', actorId: 'owner-1',
      text: 'Logged behaviour for Ada: Helped out (+5 pts)'
    })
  })

  it.each([
    ['cross-family child', { ...baseDocs, 'users/child-1': { ...baseDocs['users/child-1'], familyId: 'other' } }],
    ['non-child target', { ...baseDocs, 'users/child-1': { ...baseDocs['users/child-1'], role: 'parent' } }],
    ['cross-family creator', { ...baseDocs, 'users/owner-1': { ...baseDocs['users/owner-1'], familyId: 'other' } }],
    ['child creator', { ...baseDocs, 'users/owner-1': { ...baseDocs['users/owner-1'], role: 'child' } }],
  ])('rejects a %s before any writes', async (_case, docs) => {
    const transaction = installTransaction(docs)
    await expect(addBehaviourEvent('family-1', 'child-1', 'owner-1', {
      type: 'positive', reason: 'Helped out', pointsDelta: 5, walletDelta: 0,
    })).rejects.toThrow()
    expect(transaction.update).not.toHaveBeenCalled()
    expect(transaction.set).not.toHaveBeenCalled()
  })

  it('rejects a financial penalty that exceeds the family debt limit', async () => {
    const transaction = installTransaction(baseDocs)
    await expect(addBehaviourEvent('family-1', 'child-1', 'owner-1', {
      type: 'financial', reason: 'Expensive', pointsDelta: 0, walletDelta: -6000
    })).rejects.toThrow('This penalty would exceed the family debt limit.')
    expect(transaction.set).not.toHaveBeenCalled()
  })

  it('allows a parent or owner to create a behaviour event', async () => {
    const docs = {
      ...baseDocs,
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'Mom' },
    }
    const transaction = installTransaction(docs)

    // Parent
    authState.currentUser = { uid: 'parent-1' }
    await addBehaviourEvent('family-1', 'child-1', 'parent-1', {
      type: 'positive', reason: 'Good', pointsDelta: 10, walletDelta: 0
    })
    expect(transaction.set).toHaveBeenCalled()

    vi.clearAllMocks()

    // Owner
    authState.currentUser = { uid: 'owner-1' }
    await addBehaviourEvent('family-1', 'child-1', 'owner-1', {
      type: 'positive', reason: 'Good', pointsDelta: 10, walletDelta: 0
    })
    expect(transaction.set).toHaveBeenCalled()
  })
})

describe('updateDebtLimit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('allows only the family owner and records the audit fields', async () => {
    firestore.updateDoc.mockResolvedValue(undefined)
    await updateDebtLimit('family-1', 'owner-1', -7500)
    expect(firestore.updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'families/family-1' }),
      { debtLimitPence: -7500, updatedBy: 'owner-1', updatedAt: { sentinel: 'server-timestamp' } },
    )
  })
})
