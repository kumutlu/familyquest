import { beforeEach, describe, expect, it, vi } from 'vitest'

const firestore = vi.hoisted(() => {
  let generated = 0
  const documents = new Map<string, Record<string, unknown>>()
  const writes: Array<{ path: string; data: Record<string, unknown> }> = []
  const collection = vi.fn((_db: unknown, path: string) => ({ path }))
  const doc = vi.fn((first: any, ...parts: string[]) => {
    if (parts.length) return { id: parts.at(-1), path: parts.join('/') }
    generated += 1
    return { id: `generated-${generated}`, path: `${first.path}/generated-${generated}` }
  })
  const runTransaction = vi.fn(async (_db: unknown, callback: (tx: any) => Promise<void>) => callback({
    get: vi.fn(async (ref: { path: string }) => ({
      exists: () => documents.has(ref.path),
      data: () => documents.get(ref.path),
    })),
    set: vi.fn((ref: { path: string }, data: Record<string, unknown>) => {
      writes.push({ path: ref.path, data })
      documents.set(ref.path, data)
    }),
  }))
  return {
    collection,
    doc,
    runTransaction,
    serverTimestamp: vi.fn(() => ({ server: true })),
    writeBatch: vi.fn(() => {
      const pending: Array<{ path: string; data: Record<string, unknown> }> = []
      return {
        set: vi.fn((ref: { path: string }, data: Record<string, unknown>) => pending.push({ path: ref.path, data })),
        commit: vi.fn(async () => {
          if (pending.some(write => documents.has(write.path))) throw new Error('permission-denied')
          for (const write of pending) {
            writes.push(write)
            documents.set(write.path, write.data)
          }
        }),
      }
    }),
    query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), startAfter: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn(async (ref: { path: string }) => ({
      exists: () => documents.has(ref.path),
      data: () => documents.get(ref.path),
    })),
    setDoc: vi.fn(), addDoc: vi.fn(), deleteDoc: vi.fn(), updateDoc: vi.fn(),
    reset: () => { generated = 0; documents.clear(); writes.length = 0 },
    writes,
  }
})

const authState = vi.hoisted(() => ({ currentUser: { uid: 'owner-1' } as any }))

vi.mock('firebase/firestore', () => ({ ...firestore }))
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(), signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(), signOut: vi.fn(),
}))
vi.mock('./firebase', () => ({ db: { name: 'db' }, auth: authState, googleProvider: {} }))
vi.mock('./notifications', () => ({
  getApproverIds: vi.fn(async () => ['owner-1']), getChildIds: vi.fn(async () => []),
  loadNotificationRecipientsInTransaction: vi.fn(), applyNotificationWrites: vi.fn(),
}))

import { createManagedMember, createTask } from './api'

beforeEach(() => {
  vi.clearAllMocks()
  firestore.reset()
})

describe('createManagedMember onboarding idempotency', () => {
  it('reuses one authoritative child and wallet for the same client request', async () => {
    const options = { clientReqId: 'onboarding-child-request-1' }

    const first = await createManagedMember('family-1', 'child', 'Alex', undefined, options)
    const second = await createManagedMember('family-1', 'child', 'Alex', undefined, options)

    expect(second).toBe(first)
    expect(firestore.writes.filter(write => write.path.startsWith('users/'))).toHaveLength(1)
    expect(firestore.writes.filter(write => write.path.includes('/wallets/'))).toHaveLength(1)
    expect(firestore.writes.find(write => write.path.startsWith('users/'))?.data).toMatchObject({
      clientReqId: options.clientReqId,
      familyId: 'family-1',
      displayName: 'Alex',
      role: 'child',
      isManaged: true,
    })
  })

  it('reuses one initial task and feed for the same client request', async () => {
    const options = { clientReqId: 'onboarding-task-request-1' }
    const task = { title: 'Tidy bedroom', assigneeId: 'managed_child_request_1' }

    const first = await createTask('family-1', task, options)
    const second = await createTask('family-1', task, options)

    expect(second.id).toBe(first.id)
    expect(firestore.writes.filter(write => write.path.includes('/tasks/'))).toHaveLength(1)
    expect(firestore.writes.filter(write => write.path.includes('/feed/'))).toHaveLength(1)
  })
})
