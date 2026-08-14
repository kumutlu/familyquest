import { beforeEach, describe, expect, it, vi } from 'vitest'

// Focused tests for the family/child goal-created notification emitted by
// `createGoal`. The notification must be created through the EXISTING
// authoritative path (loadNotificationRecipientsInTransaction +
// applyNotificationWrites) and only after the goal is written, atomically, in
// the same transaction. Recipients are resolved from the active family
// membership; the creator is never notified; deleted/disabled members are
// excluded by the resolver; and a deterministic dedupe key prevents duplicates
// on retry.

const firestore = vi.hoisted(() => {
  let id = 0
  const collection = vi.fn((_db: unknown, path: string) => ({ path }))
  const doc = vi.fn((first: any, ...parts: string[]) => {
    if (parts.length) return { id: parts.at(-1), path: parts.join('/') }
    id += 1
    return { id: `generated-${id}`, path: `${first.path}/generated-${id}` }
  })
  return {
    collection, doc, runTransaction: vi.fn(), serverTimestamp: vi.fn(() => ({ server: true })),
    query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), getDocs: vi.fn(), getDoc: vi.fn(), updateDoc: vi.fn(),
    reset: () => { id = 0 },
  }
})
const authState = vi.hoisted(() => ({ currentUser: { uid: 'parent-1' } as any }))

vi.mock('firebase/firestore', () => ({
  ...firestore,
  setDoc: vi.fn(),
  addDoc: vi.fn(),
  deleteDoc: vi.fn(),
  writeBatch: vi.fn(),
  getDoc: vi.fn(async (ref: { path: string }) => {
    const data = docStore[ref.path];
    return { exists: () => data !== undefined, data: () => data };
  }),
  getDocs: vi.fn(async (ref: { path: string }) => {
    const data = docStore[ref.path];
    const docs = data && Array.isArray((data as any).__docs__)
      ? (data as any).__docs__.map((d: any) => ({ id: d.id ?? d.contribId, data: () => d }))
      : [];
    return { docs, empty: docs.length === 0 };
  }),
}))
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(), signInWithEmailAndPassword: vi.fn(), signInWithPopup: vi.fn(), signOut: vi.fn(),
}))
vi.mock('./firebase', () => ({ db: { name: 'db' }, auth: authState, googleProvider: {} }))

// Control recipient resolution and spy on the authoritative notification helpers.
type ActiveMember = { id: string; role: string }

const getActiveFamilyMembers = vi.fn(async (): Promise<ActiveMember[]> => [])
const loadNotificationRecipientsInTransaction = vi.fn(async (_tx: any, _familyId: string, input: any) => ({
  ref: { path: `families/family-1/notifications/${input.dedupeKey}` },
  data: { type: input.type, recipientIds: input.recipientIds },
}))
const applyNotificationWrites = vi.fn(() => {})

vi.mock('./notifications', () => ({
  getActiveFamilyMembers: (...args: any[]) => (getActiveFamilyMembers as (...a: any[]) => any)(...args),
  loadNotificationRecipientsInTransaction: (...args: any[]) => (loadNotificationRecipientsInTransaction as (...a: any[]) => any)(...args),
  applyNotificationWrites: (...args: any[]) => (applyNotificationWrites as (...a: any[]) => any)(...args),
}))

import { createGoal } from './api'

const docStore: Record<string, any> = {}

function transactionWith(initialDocs: Record<string, any> = {}, opts: { failOnWrite?: boolean } = {}) {
  Object.assign(docStore, initialDocs)
  const tx = {
    get: vi.fn(async (ref: { path: string }) => {
      const data = docStore[ref.path]
      return { exists: () => data !== undefined, data: () => data }
    }),
    set: vi.fn((ref: { path: string }, data: any) => {
      if (opts.failOnWrite) throw new Error('simulated write failure')
      docStore[ref.path] = data
    }),
    update: vi.fn((ref: { path: string }, data: any) => {
      docStore[ref.path] = { ...(docStore[ref.path] ?? {}), ...data }
    }),
    delete: vi.fn((ref: { path: string }) => { delete docStore[ref.path] }),
  }
  firestore.runTransaction.mockImplementation(async (_db: unknown, cb: any) => cb(tx))
  return tx
}

const ACTIVE_MEMBERS = [
  { id: 'parent-1', role: 'parent' }, // creator in most tests
  { id: 'parent-2', role: 'parent' },
  { id: 'child-1', role: 'child' },
]

beforeEach(() => {
  vi.clearAllMocks()
  firestore.reset()
  for (const k of Object.keys(docStore)) delete docStore[k]
  authState.currentUser = { uid: 'parent-1' }
  getActiveFamilyMembers.mockResolvedValue(ACTIVE_MEMBERS.map(m => ({ ...m })))
  loadNotificationRecipientsInTransaction.mockClear()
  applyNotificationWrites.mockClear()
})

describe('createGoal — family goal notification', () => {
  it('notifies the other active family members (parents AND children), excluding the creator', async () => {
    transactionWith({
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'Kemal' },
    })
    await createGoal('family-1', { title: 'Holiday', kind: 'family', targetAmountPence: 5000 })

    expect(loadNotificationRecipientsInTransaction).toHaveBeenCalledTimes(1)
    const input = loadNotificationRecipientsInTransaction.mock.calls[0][2]
    expect(input.type).toBe('goal_created')
    // creator (parent-1) excluded; parent-2 and child-1 notified.
    expect(input.recipientIds.sort()).toEqual(['child-1', 'parent-2'])
    expect(input.actorId).toBe('parent-1')
    expect(input.dedupeKey).toBe('goal_created_generated-1')
    expect(input.entityType).toBe('goal')
    expect(input.entityId).toBe('generated-1')
    expect(input.actionUrl).toBe('/goals')
    expect(input.body).toBe('Kemal created a new family goal: Holiday')
    expect(input.title).toBe('New goal')
    expect(applyNotificationWrites).toHaveBeenCalledTimes(1)
  })

  it('does not notify anyone when the creator is the only active member', async () => {
    getActiveFamilyMembers.mockResolvedValue([{ id: 'parent-1', role: 'parent' }])
    transactionWith({
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'Kemal' },
    })
    await createGoal('family-1', { title: 'Solo', kind: 'family', targetAmountPence: 5000 })

    // No recipients => the queue/read stage is never invoked, and the write stage
    // receives a null plan (no document is written).
    expect(loadNotificationRecipientsInTransaction).not.toHaveBeenCalled()
    expect(applyNotificationWrites).toHaveBeenCalledWith(expect.anything(), { ref: null, data: null })
  })
})

describe('createGoal — child goal notification', () => {
  it('notifies the relevant parents/owners + the target child, excluding the creator', async () => {
    transactionWith({
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'Kemal' },
      'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Osman' },
    })
    await createGoal('family-1', { title: 'New Bike', kind: 'child', childId: 'child-1', targetAmountPence: 2000 })

    expect(loadNotificationRecipientsInTransaction).toHaveBeenCalledTimes(1)
    const input = loadNotificationRecipientsInTransaction.mock.calls[0][2]
    expect(input.type).toBe('goal_created')
    // parent-2 (other parent) + child-1 (target child); creator parent-1 excluded.
    expect(input.recipientIds.sort()).toEqual(['child-1', 'parent-2'])
    expect(input.body).toBe('Kemal created a new goal for Osman: New Bike')
    expect(applyNotificationWrites).toHaveBeenCalledTimes(1)
  })

  it('excludes the creator even when the creator is a parent of the target child', async () => {
    // Only the creator (parent-1) and the target child exist.
    getActiveFamilyMembers.mockResolvedValue([
      { id: 'parent-1', role: 'parent' },
      { id: 'child-1', role: 'child' },
    ])
    transactionWith({
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'Kemal' },
      'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Osman' },
    })
    await createGoal('family-1', { title: 'New Bike', kind: 'child', childId: 'child-1', targetAmountPence: 2000 })

    const input = loadNotificationRecipientsInTransaction.mock.calls[0][2]
    // Only the target child is notified; the creator parent is excluded.
    expect(input.recipientIds).toEqual(['child-1'])
  })
})

describe('createGoal — deleted/disabled members excluded', () => {
  it('only notifies members returned by the active-members resolver (deleted/disabled already filtered out)', async () => {
    // Resolver returns only the active subset; a deleted/disabled member is absent.
    getActiveFamilyMembers.mockResolvedValue([
      { id: 'parent-1', role: 'parent' }, // creator
      { id: 'parent-2', role: 'parent' },
      // child-1 (deleted/disabled) is intentionally NOT returned.
    ])
    transactionWith({
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'Kemal' },
    })
    await createGoal('family-1', { title: 'Holiday', kind: 'family', targetAmountPence: 5000 })

    const input = loadNotificationRecipientsInTransaction.mock.calls[0][2]
    expect(input.recipientIds).toEqual(['parent-2'])
  })
})

describe('createGoal — idempotent retry', () => {
  it('does not create a duplicate notification on retry (idempotency replay returns early)', async () => {
    transactionWith({
      'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'Kemal' },
    })
    // First creation: goal + notification written, idempotency doc persisted.
    await createGoal('family-1', { title: 'Holiday', kind: 'family', targetAmountPence: 5000, clientReqId: 'r1' })
    expect(applyNotificationWrites).toHaveBeenCalledTimes(1)

    // Second creation with the SAME clientReqId: hits the idempotency replay
    // path and returns early WITHOUT queueing a notification.
    await createGoal('family-1', { title: 'Holiday', kind: 'family', targetAmountPence: 5000, clientReqId: 'r1' })

    // Exactly one notification queued across both attempts.
    expect(loadNotificationRecipientsInTransaction).toHaveBeenCalledTimes(1)
    expect(applyNotificationWrites).toHaveBeenCalledTimes(1)
  })
})

describe('createGoal — failed goal creation', () => {
  it('creates no notification when the goal write fails', async () => {
    transactionWith(
      { 'users/parent-1': { familyId: 'family-1', role: 'parent', displayName: 'Kemal' } },
      { failOnWrite: true },
    )
    await expect(
      createGoal('family-1', { title: 'Holiday', kind: 'family', targetAmountPence: 5000 }),
    ).rejects.toThrow(/simulated write failure/)

    // The dedupe READ may run, but the WRITE stage (which persists the
    // notification) is never reached, so no notification is created.
    expect(applyNotificationWrites).not.toHaveBeenCalled()
  })
})
