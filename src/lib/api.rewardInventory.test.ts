import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Reward inventory regression tests.
 *
 * These exercise the REAL production `redeemReward` Firestore transaction —
 * not a simplified helper — with a fake transaction that records every write.
 * Inventory (`inventory`, remaining stock, null = unlimited) must decrement
 * atomically together with the points deduction, redemption record, feed entry
 * and notification.
 */

const firestore = vi.hoisted(() => {
  let generatedId = 0
  return {
    collection: vi.fn((_db: unknown, path: string) => ({ path })),
    doc: vi.fn((first: { path?: string }, ...parts: string[]) => {
      if (parts.length) return { id: parts.at(-1), path: parts.join('/') }
      generatedId += 1
      return { id: `generated-${generatedId}`, path: `${first.path}/generated-${generatedId}` }
    }),
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
  deleteDoc: vi.fn(),
  updateDoc: vi.fn(),
}))
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(), signInWithEmailAndPassword: vi.fn(), signInWithPopup: vi.fn(), signOut: vi.fn(),
}))
vi.mock('./firebase', () => ({ db: { name: 'db' }, auth: authState, googleProvider: {} }))

const applyNotificationWrites = vi.fn((..._args: any[]) => {})
vi.mock('./notifications', () => ({
  getApproverIds: vi.fn(async () => ['owner-1']),
  getChildIds: vi.fn(async () => ['child-2']),
  loadNotificationRecipientsInTransaction: vi.fn(async () => ({
    ref: { path: 'families/family-1/notifications/n' },
    data: { familyId: 'family-1' },
  })),
  applyNotificationWrites: (...args: any[]) => applyNotificationWrites(...args),
}))

import { redeemReward } from './api'

const REWARD_PATH = 'families/family-1/rewards/r1'
const USER_PATH = 'users/child-1'

function snapshot(data?: Record<string, any>) {
  return { exists: () => data !== undefined, data: () => data }
}

type Write = { kind: 'set' | 'update'; path: string; data: any }

function fakeTransaction(docs: Record<string, Record<string, any> | undefined>, opts: { failOn?: string } = {}) {
  const writes: Write[] = []
  const tx = {
    get: vi.fn(async (ref: { path?: string }) => snapshot(docs[ref.path as string])),
    update: vi.fn((ref: { path: string }, data: any) => {
      if (opts.failOn === ref.path) throw new Error('write failed')
      writes.push({ kind: 'update', path: ref.path, data })
    }),
    set: vi.fn((ref: { path: string }, data: any) => {
      if (opts.failOn === ref.path) throw new Error('write failed')
      writes.push({ kind: 'set', path: ref.path, data })
    }),
    delete: vi.fn(),
    writes,
  }
  // A real Firestore transaction is atomic: if the callback throws, nothing commits.
  firestore.runTransaction.mockImplementation(async (_db: unknown, callback: any) => {
    try {
      return await callback(tx)
    } catch (e) {
      writes.length = 0
      throw e
    }
  })
  return tx
}

function inventoryWrites(tx: { writes: Write[] }) {
  return tx.writes.filter(w => w.path === REWARD_PATH && 'inventory' in (w.data ?? {}))
}

beforeEach(() => {
  vi.clearAllMocks()
  firestore.resetIds()
  authState.currentUser = { uid: 'child-1' }
  firestore.getDocs.mockResolvedValue({ docs: [] } as any)
})

describe('redeemReward — reward inventory', () => {
  it('decrements stock N -> N-1 on a successful redemption', async () => {
    const tx = fakeTransaction({
      [REWARD_PATH]: { cost: 10, title: 'Movie', inventory: 5 },
      [USER_PATH]: { rewardPoints: 100, displayName: 'Alisya' },
    })
    await redeemReward('family-1', 'child-1', 'r1')
    expect(inventoryWrites(tx)).toEqual([{ kind: 'update', path: REWARD_PATH, data: { inventory: 4 } }])
  })

  it('decrements the last unit 1 -> 0', async () => {
    const tx = fakeTransaction({
      [REWARD_PATH]: { cost: 10, title: 'Movie', inventory: 1 },
      [USER_PATH]: { rewardPoints: 100, displayName: 'Alisya' },
    })
    await redeemReward('family-1', 'child-1', 'r1')
    expect(inventoryWrites(tx)[0].data.inventory).toBe(0)
  })

  it('rejects redemption when stock is 0 and writes nothing', async () => {
    const tx = fakeTransaction({
      [REWARD_PATH]: { cost: 10, title: 'Movie', inventory: 0 },
      [USER_PATH]: { rewardPoints: 100, displayName: 'Alisya' },
    })
    await expect(redeemReward('family-1', 'child-1', 'r1')).rejects.toThrow(/out of stock/i)
    expect(tx.writes).toHaveLength(0)
  })

  it('never touches inventory for unlimited rewards', async () => {
    const tx = fakeTransaction({
      [REWARD_PATH]: { cost: 10, title: 'Movie', inventory: null },
      [USER_PATH]: { rewardPoints: 100, displayName: 'Alisya' },
    })
    await redeemReward('family-1', 'child-1', 'r1')
    expect(inventoryWrites(tx)).toHaveLength(0)
    expect(tx.writes.some(w => w.path === USER_PATH)).toBe(true)
  })

  it('changes neither stock nor points when the child cannot afford the reward', async () => {
    const tx = fakeTransaction({
      [REWARD_PATH]: { cost: 500, title: 'Movie', inventory: 3 },
      [USER_PATH]: { rewardPoints: 10, displayName: 'Alisya' },
    })
    await expect(redeemReward('family-1', 'child-1', 'r1')).rejects.toThrow(/not enough points/i)
    expect(tx.writes).toHaveLength(0)
  })

  it('decrements only once per redemption transaction (duplicate clicks re-read stock)', async () => {
    const tx = fakeTransaction({
      [REWARD_PATH]: { cost: 10, title: 'Movie', inventory: 2 },
      [USER_PATH]: { rewardPoints: 100, displayName: 'Alisya' },
    })
    await redeemReward('family-1', 'child-1', 'r1')
    expect(inventoryWrites(tx)).toHaveLength(1)
    // A retry re-reads the (now updated) reward document rather than reusing
    // a stale client-side value, so stock can never drop by two for one redeem.
    const retry = fakeTransaction({
      [REWARD_PATH]: { cost: 10, title: 'Movie', inventory: 1 },
      [USER_PATH]: { rewardPoints: 90, displayName: 'Alisya' },
    })
    await redeemReward('family-1', 'child-1', 'r1')
    expect(inventoryWrites(retry)[0].data.inventory).toBe(0)
  })

  it('rolls back points, stock, redemption and feed when any write in the batch fails', async () => {
    const tx = fakeTransaction(
      {
        [REWARD_PATH]: { cost: 10, title: 'Movie', inventory: 5 },
        [USER_PATH]: { rewardPoints: 100, displayName: 'Alisya' },
      },
      { failOn: USER_PATH },
    )
    await expect(redeemReward('family-1', 'child-1', 'r1')).rejects.toThrow(/write failed/i)
    expect(tx.writes).toHaveLength(0)
  })

  it('denies redeeming on behalf of another child', async () => {
    fakeTransaction({
      [REWARD_PATH]: { cost: 10, title: 'Movie', inventory: 5 },
      [USER_PATH]: { rewardPoints: 100, displayName: 'Alisya' },
    })
    await expect(redeemReward('family-1', 'child-2', 'r1')).rejects.toThrow(/another user/i)
  })

  it('keeps points deduction, redemption record, feed and notification atomic with the decrement', async () => {
    const tx = fakeTransaction({
      [REWARD_PATH]: { cost: 10, title: 'Movie', inventory: 5 },
      [USER_PATH]: { rewardPoints: 100, displayName: 'Alisya' },
    })
    await redeemReward('family-1', 'child-1', 'r1')
    expect(tx.writes.find(w => w.path === USER_PATH)?.data.rewardPoints).toBe(90)
    expect(tx.writes.some(w => w.path.includes('/redemptions/'))).toBe(true)
    expect(tx.writes.some(w => w.path.includes('/feed/'))).toBe(true)
    expect(applyNotificationWrites).toHaveBeenCalled()
  })
})
