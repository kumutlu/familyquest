import { describe, expect, it, vi, beforeEach } from 'vitest'

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
    query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), getDocs: vi.fn(), getDoc: vi.fn(), reset: () => { id = 0 },
  }
})
const authState = vi.hoisted(() => ({ currentUser: {
  uid: 'owner-1', displayName: 'Kemal', emailVerified: true,
  reload: vi.fn(async () => {}),
  getIdTokenResult: vi.fn(async () => ({ claims: { email_verified: true, firebase: { sign_in_provider: 'password' } } })),
} as any }))

vi.mock('firebase/firestore', () => ({
  ...firestore, setDoc: vi.fn(), addDoc: vi.fn(), deleteDoc: vi.fn(), updateDoc: vi.fn(), writeBatch: vi.fn(),
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

beforeEach(() => {
  firestore.reset()
  firestore.runTransaction.mockReset()
})

/**
 * Regression test for the onboarding "Missing or insufficient permissions" bug
 * on Step 1 ("Name your family"). Firestore permits the existing parent profile
 * to gain familyId/role=owner only in the same atomic request that creates the
 * family. This test locks that transaction boundary and the authoritative
 * post-commit profile read. Owners still do not receive a wallet document.
 */
describe('createFamilyAndParent (onboarding Step 1)', () => {
  it('atomically creates the family, promotes the existing parent, and returns the reloaded profile', async () => {
    const sets: { path: string; data: Record<string, any> }[] = []
    const updates: { path: string; data: Record<string, any> }[] = []
    const tx = {
      get: vi.fn(async (ref: { path: string }) => ref.path === 'users/owner-1'
        ? { exists: () => true, data: () => ({ uid: 'owner-1', role: 'parent', displayName: 'Kemal' }) }
        : { exists: () => false, data: () => undefined }),
      update: vi.fn((ref: { path: string }, data: Record<string, any>) => {
        updates.push({ path: ref.path, data })
      }),
      set: vi.fn((ref: { path: string }, data: Record<string, any>) => { sets.push({ path: ref.path, data }) }),
      delete: vi.fn(() => {}),
    }
    firestore.runTransaction.mockImplementation(async (_db: unknown, callback: any) => callback(tx))
    firestore.getDoc.mockResolvedValue({
      exists: () => true,
      id: 'owner-1',
      data: () => ({ uid: 'owner-1', role: 'owner', familyId: 'generated-1', displayName: 'Kemal' }),
    })

    const { familyId, inviteCode, user } = await createFamilyAndParent('owner-1', 'Kemal', 'The Smiths')

    expect(sets.length).toBe(1)
    const familySet = sets[0]
    expect(familySet.path.startsWith('families/')).toBe(true)
    expect(familySet.path).not.toContain('/wallets/')
    expect(familySet.path).not.toContain('/users/')
    expect(familySet.data).toMatchObject({
      name: 'The Smiths',
      ownerId: 'owner-1',
      createdBy: 'owner-1',
    })
    expect(typeof familySet.data.inviteCode).toBe('string')
    expect(familySet.data.createdAt).toEqual({ server: true })

    expect(updates).toEqual([{
      path: 'users/owner-1',
      data: { familyId, role: 'owner' },
    }])

    const walletSet = sets.find(s => s.path.includes('/wallets/'))
    expect(walletSet).toBeUndefined()

    expect(firestore.getDoc).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/owner-1' }))
    expect(user).toMatchObject({
      uid: 'owner-1',
      familyId,
      role: 'owner',
      displayName: 'Kemal',
    })
    expect(familyId).toBeTruthy()
    expect(inviteCode).toBeTruthy()
  })
})

/**
 * Regression for the idempotent `createFamilyAndParent` behaviour introduced for
 * the Refined Queki onboarding. When the authenticated parent already has a
 * valid family, a replayed/retried call must reuse the existing family rather
 * than creating a duplicate, overwriting ownership, resetting family data, or
 * duplicating membership. Idempotency must NOT become silent acceptance of
 * inconsistent/cross-family state: a non-parent is still rejected and no
 * cross-family write is ever performed.
 */
describe('createFamilyAndParent idempotency (existing family)', () => {
  function makeTx(userData: Record<string, any>) {
    const sets: { path: string; data: Record<string, any> }[] = []
    const updates: { path: string; data: Record<string, any> }[] = []
    const tx = {
      get: vi.fn(async (ref: { path: string }) =>
        ref.path === 'users/owner-1'
          ? { exists: () => true, data: () => userData }
          : { exists: () => false, data: () => undefined },
      ),
      update: vi.fn(() => {
        throw new Error('update should not be called in idempotent path')
      }),
      set: vi.fn((ref: { path: string }, data: Record<string, any>) => {
        sets.push({ path: ref.path, data })
      }),
      delete: vi.fn(() => {}),
    }
    return { tx, sets, updates }
  }

  it('returns/reuses the existing family and makes no writes when the parent already has a family', async () => {
    const { tx, sets } = makeTx({
      uid: 'owner-1',
      role: 'owner',
      familyId: 'existing-fam',
      inviteCode: 'EXIST1',
      displayName: 'Kemal',
    })
    firestore.runTransaction.mockImplementation(async (_db: unknown, cb: any) => cb(tx))
    firestore.getDoc.mockResolvedValue({
      exists: () => true,
      id: 'owner-1',
      data: () => ({ uid: 'owner-1', role: 'owner', familyId: 'existing-fam', inviteCode: 'EXIST1', displayName: 'Kemal' }),
    })

    const result = await createFamilyAndParent('owner-1', 'Kemal', 'The Smiths')

    // Reuses the existing family + invite code.
    expect(result.familyId).toBe('existing-fam')
    expect(result.inviteCode).toBe('EXIST1')
    expect(result.user).toMatchObject({ uid: 'owner-1', familyId: 'existing-fam', role: 'owner' })

    // Exactly-once guarantees: no second family, no ownership overwrite, no
    // family-data reset, no duplicate membership, no cross-family write.
    expect(sets).toHaveLength(0)
  })

  it('does not create a new family for a stale family reference (idempotent, no cross-family write)', async () => {
    // The stored familyId points at a family that no longer exists, but the
    // call must still be idempotent: it returns the stored reference and never
    // creates a new family or writes a cross-family membership.
    const { tx, sets } = makeTx({
      uid: 'owner-1',
      role: 'owner',
      familyId: 'stale-fam',
      inviteCode: 'STALE1',
      displayName: 'Kemal',
    })
    firestore.runTransaction.mockImplementation(async (_db: unknown, cb: any) => cb(tx))

    const result = await createFamilyAndParent('owner-1', 'Kemal', 'The Smiths')

    expect(result.familyId).toBe('stale-fam')
    expect(result.inviteCode).toBe('STALE1')
    // No family document is created and no user document is mutated.
    expect(sets).toHaveLength(0)
  })

  it('rejects a non-parent (no familyId, role !== parent) instead of silently accepting', async () => {
    const { tx, sets } = makeTx({
      uid: 'owner-1',
      role: 'child',
      displayName: 'Leo',
    })
    firestore.runTransaction.mockImplementation(async (_db: unknown, cb: any) => cb(tx))

    await expect(createFamilyAndParent('owner-1', 'Leo', 'The Smiths')).rejects.toThrow(
      /parent state for bootstrap/,
    )
    // Security boundary preserved: no family created, no membership written.
    expect(sets).toHaveLength(0)
  })
})
