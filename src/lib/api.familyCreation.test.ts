import { describe, expect, it, vi } from 'vitest'

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
    query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), getDocs: vi.fn(), reset: () => { id = 0 },
  }
})
const authState = vi.hoisted(() => ({ currentUser: { uid: 'owner-1', displayName: 'Kemal' } as any }))

vi.mock('firebase/firestore', () => ({
  ...firestore, setDoc: vi.fn(), addDoc: vi.fn(), getDoc: vi.fn(), deleteDoc: vi.fn(), updateDoc: vi.fn(), writeBatch: vi.fn(),
}))
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(), signInWithEmailAndPassword: vi.fn(), signInWithPopup: vi.fn(), signOut: vi.fn(),
}))
vi.mock('./firebase', () => ({ db: { name: 'db' }, auth: authState, googleProvider: {} }))
vi.mock('./notifications', () => ({
  getApproverIds: vi.fn(async () => ['owner-1']),
  getChildIds: vi.fn(async () => []),
  loadNotificationRecipientsInTransaction: vi.fn(async () => ({ ref: { path: 'families/family-1/notifications/n' }, data: {} })),
  applyNotificationWrites: vi.fn(() => {}),
}))

import { createFamilyAndParent } from './api'

/**
 * Regression test for the onboarding "Missing or insufficient permissions" bug
 * on Step 1 ("Name your family"). The owner (parent) user doc is already created
 * by signUp()/signInWithGoogle() with role 'parent' and NO familyId. Re-writing it
 * inside the family-creation transaction with merge:true is an UPDATE (the doc
 * already exists), which the users update rule denies because it touches protected
 * fields (role, rewardPoints, ...). That denial produced the error. The fix makes
 * createFamilyAndParent write ONLY the family doc — never the owner user doc and
 * never an owner wallet doc (owners have no wallet; only children do).
 */
describe('createFamilyAndParent (onboarding Step 1)', () => {
  it('writes only the family doc — no owner user doc and no owner wallet doc', async () => {
    const sets: { path: string; data: Record<string, any> }[] = []
    const tx = {
      get: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
      update: vi.fn(() => {}),
      set: vi.fn((ref: { path: string }, data: Record<string, any>) => { sets.push({ path: ref.path, data }) }),
      delete: vi.fn(() => {}),
    }
    firestore.runTransaction.mockImplementation(async (_db: unknown, callback: any) => callback(tx))

    const { familyId, inviteCode } = await createFamilyAndParent('owner-1', 'Kemal', 'The Smiths')

    // Exactly one write: the family doc, which passes `allow create: if isAuthenticated();`
    expect(sets.length).toBe(1)
    const familySet = sets[0]
    expect(familySet.path.startsWith('families/')).toBe(true)
    expect(familySet.path).not.toContain('/wallets/')
    expect(familySet.path).not.toContain('/users/')
    expect(familySet.data).toMatchObject({ name: 'The Smiths' })
    expect(typeof familySet.data.inviteCode).toBe('string')
    expect(familySet.data.createdAt).toEqual({ server: true })

    // No owner user document is written (it already exists from signup; re-writing
    // it as an update was the denied write that caused the permission error).
    const userSet = sets.find(s => s.path === 'users/owner-1')
    expect(userSet).toBeUndefined()

    // No owner wallet document is written (owners have no wallet doc).
    const walletSet = sets.find(s => s.path.includes('/wallets/'))
    expect(walletSet).toBeUndefined()

    expect(familyId).toBeTruthy()
    expect(inviteCode).toBeTruthy()
  })
})
