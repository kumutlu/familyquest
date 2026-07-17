import { beforeEach, describe, expect, it, vi } from 'vitest'

const firestore = vi.hoisted(() => {
  let generatedId = 0
  const collection = vi.fn((_db: unknown, path: string) => ({ path }))
  const doc = vi.fn((first: { path?: string }, ...parts: string[]) => {
    if (parts.length) return { id: parts.at(-1), path: parts.join('/') }
    generatedId += 1
    return { id: `generated-${generatedId}`, path: `${first.path}/generated-${generatedId}` }
  })
  // A single shared batch object so we can assert on its queued writes.
  const batch = {
    set: vi.fn(),
    commit: vi.fn(async () => {}),
  }
  return {
    collection,
    doc,
    addDoc: vi.fn(),
    runTransaction: vi.fn(),
    serverTimestamp: vi.fn(() => ({ sentinel: 'server-timestamp' })),
    writeBatch: vi.fn(() => batch),
    batch,
    resetIds: () => { generatedId = 0 },
  }
})
const authState = vi.hoisted(() => ({ currentUser: { uid: 'owner-1' } as any }))

vi.mock('firebase/firestore', () => ({
  ...firestore,
  setDoc: vi.fn(), query: vi.fn(), where: vi.fn(), getDocs: vi.fn(), getDoc: vi.fn(),
  deleteDoc: vi.fn(), updateDoc: vi.fn(),
}))
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(), signInWithEmailAndPassword: vi.fn(), signInWithPopup: vi.fn(), signOut: vi.fn(),
}))
vi.mock('./firebase', () => ({ db: { name: 'db' }, auth: authState, googleProvider: {} }))

import { createTask, createReward, claimChallenge } from './api'

const taskWrite = () => firestore.batch.set.mock.calls.find(([ref]) => ref.path.includes('/tasks/'))?.[1]
const rewardWrite = () => firestore.batch.set.mock.calls.find(([ref]) => ref.path.includes('/rewards/'))?.[1]
const feedWrite = () => firestore.batch.set.mock.calls.find(([ref]) => ref.path.includes('/feed/'))?.[1]

describe('createTask atomic feed actor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    firestore.resetIds()
    authState.currentUser = { uid: 'owner-1' }
  })

  // A. createTask uses the authenticated UID as feed.actorId
  it('records the authenticated caller UID as feed.actorId', async () => {
    await createTask('family-1', { title: 'Tidy room' })

    expect(feedWrite()).toMatchObject({ actorId: 'owner-1', text: 'New task added: Tidy room' })
    expect(taskWrite()).toMatchObject({ title: 'Tidy room', isActive: true })
    // Both writes are flushed together in a single atomic batch.
    expect(firestore.batch.commit).toHaveBeenCalledTimes(1)
  })

  // B. task and feed are atomic: feed denial causes no task document to remain
  it('is atomic: a feed write failure leaves no task document behind', async () => {
    firestore.batch.commit.mockRejectedValueOnce(new Error('permission-denied: actorId must equal auth.uid'))

    await expect(createTask('family-1', { title: 'Tidy room' })).rejects.toThrow(/permission-denied/)

    // Both writes were queued into the same batch...
    expect(firestore.batch.set).toHaveBeenCalledTimes(2)
    // ...but the old non-atomic addDoc path must NOT be used (that is what
    // previously left an orphaned task when the feed write failed).
    expect(firestore.addDoc).not.toHaveBeenCalled()
    // The single commit was attempted and failed, so neither document exists.
    expect(firestore.batch.commit).toHaveBeenCalledTimes(1)
  })

  // C. unauthenticated caller: no writes occur, clear authentication error returned
  it('rejects unauthenticated callers before any write with a clear error', async () => {
    authState.currentUser = null

    await expect(createTask('family-1', { title: 'Tidy room' })).rejects.toThrow(/Authentication required/)
    expect(firestore.writeBatch).not.toHaveBeenCalled()
    expect(firestore.addDoc).not.toHaveBeenCalled()
  })
})

describe('createReward atomic feed actor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    firestore.resetIds()
    authState.currentUser = { uid: 'owner-1' }
  })

  // E. createReward uses the authenticated actor and does not leave a partial reward
  it('records the authenticated actor and commits reward+feed atomically', async () => {
    await createReward('family-1', { title: 'Extra screen time' })

    expect(feedWrite()).toMatchObject({ actorId: 'owner-1', text: 'New reward added: Extra screen time' })
    expect(rewardWrite()).toMatchObject({ title: 'Extra screen time' })
    expect(firestore.batch.commit).toHaveBeenCalledTimes(1)
  })

  it('leaves no reward document when the feed write fails', async () => {
    firestore.batch.commit.mockRejectedValueOnce(new Error('permission-denied'))

    await expect(createReward('family-1', { title: 'Extra screen time' })).rejects.toThrow(/permission-denied/)
    expect(firestore.batch.set).toHaveBeenCalledTimes(2)
    expect(firestore.addDoc).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated callers before any write', async () => {
    authState.currentUser = null
    await expect(createReward('family-1', { title: 'Extra screen time' })).rejects.toThrow(/Authentication required/)
    expect(firestore.writeBatch).not.toHaveBeenCalled()
  })
})

describe('claimChallenge (completeChallenge) feed actor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    firestore.resetIds()
    authState.currentUser = { uid: 'owner-1' }
  })

  function installTransaction() {
    const transaction = {
      get: vi.fn(async () => ({ exists: () => true, data: () => ({ isActive: true, rewardPoints: 0, lifetimeXP: 0 }) })),
      update: vi.fn(),
      set: vi.fn(),
    }
    firestore.runTransaction.mockImplementation(async (_db: unknown, callback: (tx: typeof transaction) => unknown) => callback(transaction))
    return transaction
  }

  // E. claimChallenge uses the authenticated actor
  it('records the authenticated actor in the challenge-completion feed entry', async () => {
    const transaction = installTransaction()

    await claimChallenge('family-1', 'challenge-1', 50, ['child-1'], 'Read a book')

    const feed = transaction.set.mock.calls.find(([ref]) => ref.path.includes('/feed/'))?.[1]
    expect(feed).toMatchObject({
      actorId: 'owner-1',
      text: 'Family Challenge Completed: Read a book! Everyone got +50 pts!',
    })
  })

  // E. claimChallenge does not leave partial primary records when the feed fails
  it('rolls back all writes if the transaction fails', async () => {
    firestore.runTransaction.mockRejectedValueOnce(new Error('permission-denied'))

    await expect(claimChallenge('family-1', 'challenge-1', 50, ['child-1'], 'Read a book')).rejects.toThrow(/permission-denied/)
    expect(firestore.runTransaction).toHaveBeenCalledTimes(1)
  })

  it('rejects unauthenticated callers before starting the transaction', async () => {
    authState.currentUser = null
    await expect(claimChallenge('family-1', 'challenge-1', 50, ['child-1'], 'Read a book')).rejects.toThrow(/Authentication required/)
    expect(firestore.runTransaction).not.toHaveBeenCalled()
  })
})
