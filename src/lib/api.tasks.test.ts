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

  // Faithful transaction double: Firestore REJECTS a transaction that performs
  // a read after a write. The old permissive mock hid the production failure of
  // the Claim reward button, so the double now enforces the real rule.
  function installTransaction(options: { existingNotification?: boolean } = {}) {
    let hasWritten = false
    const transaction = {
      get: vi.fn(async (ref: { path?: string }) => {
        if (hasWritten) {
          throw new Error('Firestore transactions require all reads to be executed before all writes.')
        }
        if (ref?.path?.includes('/notifications')) {
          return { exists: () => options.existingNotification === true, data: () => ({}) }
        }
        return { exists: () => true, data: () => ({ isActive: true, rewardPoints: 0, lifetimeXP: 0 }) }
      }),
      update: vi.fn((_ref: { path: string; id: string }, _data?: Record<string, unknown>) => { hasWritten = true }),
      set: vi.fn((_ref: { path: string; id: string }, _data?: Record<string, unknown>) => { hasWritten = true }),
    }
    firestore.runTransaction.mockImplementation(async (_db: unknown, callback: (tx: typeof transaction) => unknown) => callback(transaction))
    return transaction
  }

  const notificationWrite = (transaction: { set: { mock: { calls: any[][] } } }) =>
    transaction.set.mock.calls.find(([ref]) => ref.path.includes('/notifications'))?.[1]

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

  // REGRESSION (P0): the Claim reward button always failed because the
  // challenge document was updated BEFORE the per-child user documents were
  // read, which Firestore rejects. All reads must now precede all writes.
  it('performs every read before any write so the claim transaction is legal', async () => {
    const transaction = installTransaction()

    await expect(
      claimChallenge('family-1', 'challenge-1', 100, ['child-1', 'child-2'], 'Weekly Warriors'),
    ).resolves.toBeUndefined()

    // Reward distribution unchanged: exactly one update per existing child.
    const childUpdates = transaction.update.mock.calls.filter(([ref]) => ref.path.startsWith('users/'))
    expect(childUpdates).toHaveLength(2)
    expect(childUpdates[0][1]).toEqual({ rewardPoints: 100, lifetimeXP: 100 })
    expect(childUpdates[1][1]).toEqual({ rewardPoints: 100, lifetimeXP: 100 })
  })

  // The one-time child celebration is derived from a single presentation
  // notification written inside the SAME authoritative claim transaction.
  it('creates one deterministic child celebration marker per claimed challenge', async () => {
    const transaction = installTransaction()

    await claimChallenge('family-1', 'challenge-1', 100, ['child-1', 'child-2'], 'Weekly Warriors')

    const notif = notificationWrite(transaction)
    expect(notif).toMatchObject({
      type: 'challenge_completed',
      recipientIds: ['child-1', 'child-2'],
      title: 'Challenge complete!',
      body: 'You earned +100 points',
      entityType: 'challenge',
      entityId: 'challenge-1',
    })
    // Deterministic id => a retried claim can never create a second marker.
    const ref = transaction.set.mock.calls.find(([r]) => r.path.includes('/notifications'))?.[0]!
    expect(ref.id).toBe('challenge_completed_challenge-1')
    // Exactly one marker for all rewarded children.
    expect(transaction.set.mock.calls.filter(([r]) => r.path.includes('/notifications'))).toHaveLength(1)
  })

  it('is idempotent: an existing celebration marker is never rewritten', async () => {
    const transaction = installTransaction({ existingNotification: true })

    await claimChallenge('family-1', 'challenge-1', 100, ['child-1'], 'Weekly Warriors')

    expect(notificationWrite(transaction)).toBeUndefined()
    // The reward is still distributed exactly once.
    expect(transaction.update.mock.calls.filter(([ref]) => ref.path.startsWith('users/'))).toHaveLength(1)
  })
})
