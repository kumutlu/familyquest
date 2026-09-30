/**
 * Theme Shop purchase pipeline tests.
 *
 * Mirrors the avatar unlock test style (src/lib/api.profileUpdate.test.ts):
 * a fake Firestore transaction with a docs map keyed by path, asserting the
 * exact writes. The fake keys paths exactly like production code does, so
 * `purchaseShopTheme`'s refund/recovery path (deterministic purchase doc)
 * is exercised for free.
 *
 * One child. One catalog row. Authoritative price 500 (space).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), getDocs: vi.fn(), updateDoc: vi.fn(), deleteField: vi.fn(() => ({ deleteField: true })),
    reset: () => { id = 0 },
  }
})
const authState = vi.hoisted(() => ({ currentUser: { uid: 'child-1' } as any }))

vi.mock('firebase/firestore', () => ({
  ...firestore, setDoc: vi.fn(), addDoc: vi.fn(), getDoc: vi.fn(), deleteDoc: vi.fn(), writeBatch: vi.fn(),
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

import { purchaseShopTheme, updateChildTheme } from './api'

function snapshot(data?: Record<string, any>) {
  return { exists: () => data !== undefined, data: () => data }
}

/**
 * Fake transaction over a path-keyed docs map. Mirrors the recording
 * transaction used by the avatar unlock tests, including the
 * reads-before-writes invariant assertion helper.
 */
function transactionWith(docs: Record<string, Record<string, any> | undefined>) {
  const ops: string[] = []
  const tx = {
    get: vi.fn(async (ref: { path: string }) => {
      ops.push('get')
      return snapshot(docs[ref.path])
    }),
    update: vi.fn((ref: { path: string }, data: Record<string, unknown>) => {
      ops.push('update')
      // Simulate the committed value so a later read in the same fake tx
      // observes it (production Firestore does).
      docs[ref.path] = { ...(docs[ref.path] ?? {}), ...data }
    }),
    set: vi.fn((ref: { path: string }, data: Record<string, unknown>) => {
      ops.push('set')
      docs[ref.path] = { ...(docs[ref.path] ?? {}), ...data }
    }),
    delete: vi.fn(() => { ops.push('delete') }),
    _ops: ops,
  }
  firestore.runTransaction.mockImplementation(async (_db: unknown, callback: any) => callback(tx))
  return tx
}

/** Asserts no `get` occurs after the first write in the recorded op sequence. */
function expectReadsBeforeWrites(tx: { _ops: string[] }) {
  const firstWrite = tx._ops.findIndex(op => op === 'set' || op === 'update' || op === 'delete')
  if (firstWrite === -1) return
  const lateRead = tx._ops.slice(firstWrite).findIndex(op => op === 'get')
  expect(lateRead, `operation order: ${tx._ops.join(', ')}`).toBe(-1)
}

const USER_PATH = 'users/child-1'
const ROW_PATH = 'families/family-1/themes/space'
const PURCHASE_PATH = 'families/family-1/themes/space/purchases/child-1'
const IDEM_KEY = `theme_purchase:child-1:space`
const IDEM_PATH = `families/family-1/idempotency/${IDEM_KEY}`

function baseDocs(overrides: Record<string, Record<string, any> | undefined> = {}) {
  return {
    [USER_PATH]: { familyId: 'family-1', role: 'child', displayName: 'Ali', rewardPoints: 800 },
    [ROW_PATH]: { shopItemId: 'space', themeId: 'theme.shop.space', name: 'Space Explorer', pricePoints: 500, isActive: true },
    [PURCHASE_PATH]: undefined,
    [IDEM_PATH]: undefined,
    ...overrides,
  }
}

const tokenResult = async (claims: Record<string, unknown> = {}) => ({ claims })

describe('purchaseShopTheme — canonical points pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    firestore.reset()
    authState.currentUser = { uid: 'child-1', getIdTokenResult: tokenResult }
  })

  it('deducts the authoritative catalog price and writes an immutable purchase record', async () => {
    const tx = transactionWith(baseDocs())
    const result = await purchaseShopTheme('family-1', 'space')
    expect(result).toEqual({ costPoints: 500, themeId: 'theme.shop.space' })
    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: USER_PATH }),
      { rewardPoints: 300, lastThemePurchaseId: 'space' },
    )
    expect(tx.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: PURCHASE_PATH }),
      expect.objectContaining({
        shopItemId: 'space', childId: 'child-1', familyId: 'family-1',
        themeId: 'theme.shop.space', costPoints: 500, source: 'points', actorId: 'child-1',
      }),
    )
    // Idempotency record + feed entry complete the canonical commit shape.
    expect(tx.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: IDEM_PATH }),
      expect.objectContaining({ operationType: 'theme_purchase', status: 'completed', requestHash: expect.any(String) }),
    )
    // Human-readable history entry — theme NAME, never dev terminology.
    expect(tx.set).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('/feed/') }),
      expect.objectContaining({
        type: 'custom',
        text: 'Space Explorer · Theme purchase · −500 points',
      }),
    )
    expectReadsBeforeWrites(tx)
  })

  it('parent-published price overrides the built-in default (authoritative row wins)', async () => {
    const tx = transactionWith(baseDocs({
      [ROW_PATH]: { shopItemId: 'space', themeId: 'theme.shop.space', pricePoints: 250, isActive: true },
    }))
    const result = await purchaseShopTheme('family-1', 'space')
    expect(result.costPoints).toBe(250)
    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: USER_PATH }),
      { rewardPoints: 550, lastThemePurchaseId: 'space' },
    )
  })

  it('rejects insufficient balance without writing anything', async () => {
    const tx = transactionWith(baseDocs({
      [USER_PATH]: { familyId: 'family-1', role: 'child', rewardPoints: 100 },
    }))
    await expect(purchaseShopTheme('family-1', 'space')).rejects.toThrow(/more points/i)
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.set).not.toHaveBeenCalled()
  })

  it('rejects a duplicate purchase and charges nothing again', async () => {
    const tx = transactionWith(baseDocs({
      [PURCHASE_PATH]: { shopItemId: 'space', childId: 'child-1', costPoints: 500 },
    }))
    await expect(purchaseShopTheme('family-1', 'space')).rejects.toThrow(/already own/i)
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('rejects an inactive catalog row', async () => {
    const tx = transactionWith(baseDocs({
      [ROW_PATH]: { shopItemId: 'space', themeId: 'theme.shop.space', pricePoints: 500, isActive: false },
    }))
    await expect(purchaseShopTheme('family-1', 'space')).rejects.toThrow(/not available/i)
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('rejects an unknown shop item', async () => {
    const tx = transactionWith({
      [USER_PATH]: { familyId: 'family-1', role: 'child', rewardPoints: 800 },
      'families/family-1/themes/ghost': undefined,
      [`families/family-1/themes/ghost/purchases/child-1`]: undefined,
      'families/family-1/idempotency/theme_purchase:child-1:ghost': undefined,
    })
    await expect(purchaseShopTheme('family-1', 'ghost')).rejects.toThrow(/not available/i)
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('rejects a parent trying to buy a theme', async () => {
    transactionWith(baseDocs({
      [USER_PATH]: { familyId: 'family-1', role: 'parent', rewardPoints: 800 },
    }))
    await expect(purchaseShopTheme('family-1', 'space')).rejects.toThrow(/only children/i)
  })

  it('rejects when the caller belongs to another family', async () => {
    transactionWith(baseDocs({
      [USER_PATH]: { familyId: 'family-9', role: 'child', rewardPoints: 800 },
    }))
    await expect(purchaseShopTheme('family-1', 'space')).rejects.toThrow(/membership/i)
  })

  it('rejects a free (price 0) catalog row — free themes need no purchase', async () => {
    transactionWith(baseDocs({
      [ROW_PATH]: { shopItemId: 'space', themeId: 'theme.shop.space', pricePoints: 0, isActive: true },
    }))
    await expect(purchaseShopTheme('family-1', 'space')).rejects.toThrow(/not purchasable/i)
  })

  it('honours the parent disable switch (themeShoppingEnabled=false)', async () => {
    const tx = transactionWith(baseDocs({
      'families/family-1': { engagementPreferences: { themeShoppingEnabled: false } },
    }))
    await expect(purchaseShopTheme('family-1', 'space')).rejects.toThrow(/turned off/i)
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('keeps theme shopping enabled when the family preference is absent (backward compat)', async () => {
    const tx = transactionWith(baseDocs())
    await expect(purchaseShopTheme('family-1', 'space')).resolves.toBeTruthy()
    expectReadsBeforeWrites(tx)
  })

  it('blocks managed-child identities from theme shopping', async () => {
    authState.currentUser = {
      uid: 'auth-uid-1',
      getIdTokenResult: async () => ({ claims: { managedChild: true, childId: 'child-1' } }),
    }
    transactionWith(baseDocs())
    await expect(purchaseShopTheme('family-1', 'space')).rejects.toThrow(/not available for this profile/i)
  })

  it('replays an idempotent request without charging again', async () => {
    const { requestHashOf } = await import('./goalContracts')
    const exactHash = requestHashOf({ shopItemId: 'space', childId: 'child-1' })
    const tx = transactionWith(baseDocs({
      // The same logical request already completed (same requestHash).
      [IDEM_PATH]: { operationType: 'theme_purchase', status: 'completed', requestHash: exactHash, resultRef: PURCHASE_PATH },
    }))
    const result = await purchaseShopTheme('family-1', 'space')
    expect(result.costPoints).toBe(0)
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('fails closed when the idempotency key was used by a different request', async () => {
    const tx = transactionWith(baseDocs({
      [IDEM_PATH]: { operationType: 'theme_purchase', status: 'completed', requestHash: 'different-request-hash' },
    }))
    await expect(purchaseShopTheme('family-1', 'space')).rejects.toThrow(/idempotency key conflict/i)
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('fails closed on an ambiguous (non-completed) idempotency record', async () => {
    transactionWith(baseDocs({
      [IDEM_PATH]: { operationType: 'theme_purchase', status: 'processing', requestHash: 'x' },
    }))
    await expect(purchaseShopTheme('family-1', 'space')).rejects.toThrow(/unexpected status/i)
  })

  it('does NOT trust a client-supplied price (price comes from the catalog row only)', async () => {
    const tx = transactionWith(baseDocs({
      // The API signature has no price parameter at all; assert the deduction
      // equals the row price even when a stale/attacked row differs from the
      // built-in default.
      [ROW_PATH]: { shopItemId: 'space', themeId: 'theme.shop.space', pricePoints: 7, isActive: true },
    }))
    const result = await purchaseShopTheme('family-1', 'space')
    expect(result.costPoints).toBe(7)
    expect(tx.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: USER_PATH }),
      { rewardPoints: 793, lastThemePurchaseId: 'space' },
    )
  })

  it('recovers a crashed transaction deterministically (purchase doc exists, user write lost)', async () => {
    // Production Firestore rolls the whole transaction back, so this path
    // (duplicate-ownership recovery) can only happen if a client mutated the
    // purchase doc behind the rules — the important property is that the
    // retry REFUSES rather than double-charging.
    const tx = transactionWith(baseDocs({
      [PURCHASE_PATH]: { shopItemId: 'space', childId: 'child-1', costPoints: 500 },
    }))
    await expect(purchaseShopTheme('family-1', 'space')).rejects.toThrow(/already own/i)
    expect(tx.update).not.toHaveBeenCalled()
  })
})

describe('updateChildTheme — equip preference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.currentUser = { uid: 'child-1' }
  })

  it('writes only the theme field on the child profile', async () => {
    await updateChildTheme('theme.shop.space')
    expect(firestore.updateDoc).toHaveBeenCalledWith(
      { id: 'child-1', path: 'users/child-1' },
      { theme: 'theme.shop.space' },
    )
  })

  it('resets to the default theme when cleared', async () => {
    await updateChildTheme(null)
    expect(firestore.updateDoc).toHaveBeenCalledWith(
      { id: 'child-1', path: 'users/child-1' },
      { theme: 'theme.standard' },
    )
  })
})
