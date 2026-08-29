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

import {
  submitProfileUpdateRequest,
  approveProfileUpdateRequest,
  rejectProfileUpdateRequest,
  validateProfileUpdateInput,
  unlockAvatar,
  updateLanguagePreference,
  updateOwnCosmeticProfile,
} from './api'
import {
  loadNotificationRecipientsInTransaction,
  applyNotificationWrites,
} from './notifications'

function snapshot(data?: Record<string, any>) {
  return { exists: () => data !== undefined, data: () => data }
}

/**
 * A fake transaction that records the exact order of operations so we can assert
 * that every `get` happens before every `set`/`update`/`delete` (Firestore
 * requires reads-before-writes). The first write index is captured; any `get`
 * after it fails the test.
 */
function recordingTransaction(docs: Record<string, Record<string, any> | undefined>) {
  const ops: string[] = []
  const tx = {
    get: vi.fn(async (ref: { path: string }) => {
      ops.push('get')
      return snapshot(docs[ref.path])
    }),
    update: vi.fn(() => { ops.push('update') }),
    set: vi.fn(() => { ops.push('set') }),
    delete: vi.fn(() => { ops.push('delete') }),
    _ops: ops,
  }
  firestore.runTransaction.mockImplementation(async (_db: unknown, callback: any) => callback(tx))
  return tx
}

function transactionWith(docs: Record<string, Record<string, any> | undefined>) {
  const tx = {
    get: vi.fn(async (ref: { path: string }) => snapshot(docs[ref.path])),
    update: vi.fn(() => {}),
    set: vi.fn(() => {}),
    delete: vi.fn(() => {}),
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

// Catalog ids used by the tests (must match src/config/avatarCatalog.ts).
const STARTER = 'starter-robot'
const PREMIUM = 'rare-neon' // cost 150
const validAvatarConfig = {
  version: 1 as const,
  base: 'round' as const,
  skinTone: 'warm' as const,
  hairStyle: 'curls' as const,
  hairColor: 'brown' as const,
  face: 'smile' as const,
  accessory: 'glasses' as const,
  outfit: 'hoodie' as const,
  outfitColor: 'purple' as const,
  background: 'mint' as const,
}

describe('profile update request API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    firestore.reset()
    authState.currentUser = { uid: 'child-1' }
  })

  describe('language preference', () => {
    it('writes the supported preference only to the signed-in user profile', async () => {
      await updateLanguagePreference('tr')
      expect(firestore.updateDoc).toHaveBeenCalledWith(
        { id: 'child-1', path: 'users/child-1' },
        { language: 'tr' },
      )
    })

    it('rejects unsupported values before writing', async () => {
      await expect(updateLanguagePreference('de' as any)).rejects.toThrow(/unsupported language/i)
      expect(firestore.updateDoc).not.toHaveBeenCalled()
    })
  })

  describe('child cosmetic self-update', () => {
    it('writes only validated cosmetic fields to the authenticated child profile', async () => {
      await updateOwnCosmeticProfile('managed-child-profile-1', '  Muhammed  ', STARTER, {
        ownedAvatarIds: [],
        avatarConfig: validAvatarConfig,
      })

      expect(firestore.updateDoc).toHaveBeenCalledWith(
        { id: 'managed-child-profile-1', path: 'users/managed-child-profile-1' },
        {
          displayName: 'Muhammed',
          avatarId: STARTER,
          avatarConfig: validAvatarConfig,
        },
      )
      expect(firestore.runTransaction).not.toHaveBeenCalled()
    })
  })

  describe('validation', () => {
    it('accepts a trimmed name and a starter avatar id', () => {
      expect(validateProfileUpdateInput('  Muhammed  ', STARTER)).toEqual({
        displayName: 'Muhammed',
        avatarId: STARTER,
        legacyAvatarUrl: null,
      })
    })
    it('rejects empty names', () => {
      expect(() => validateProfileUpdateInput('', null)).toThrow(/empty/i)
    })
    it('rejects whitespace-only names', () => {
      expect(() => validateProfileUpdateInput('    ', null)).toThrow(/empty/i)
    })
    it('rejects names over the 40-character limit', () => {
      expect(() => validateProfileUpdateInput('a'.repeat(41), null)).toThrow(/40 characters/i)
    })
    it('rejects an unknown avatar id', () => {
      expect(() => validateProfileUpdateInput('Name', 'not-a-real-avatar')).toThrow(/no longer available/i)
    })
    it('rejects a premium avatar the child does not own', () => {
      expect(() => validateProfileUpdateInput('Name', PREMIUM, { ownedAvatarIds: [] }))
        .toThrow(/not been unlocked yet/i)
    })
    it('allows a premium avatar the child owns', () => {
      expect(validateProfileUpdateInput('Name', PREMIUM, { ownedAvatarIds: [PREMIUM] }))
        .toEqual({ displayName: 'Name', avatarId: PREMIUM, legacyAvatarUrl: null })
    })
    it('keeps a legacy url when no catalog id is supplied', () => {
      expect(validateProfileUpdateInput('Name', null, { legacyAvatarUrl: 'https://old' }))
        .toEqual({ displayName: 'Name', avatarId: null, legacyAvatarUrl: 'https://old' })
    })
  })

  describe('submit (child flow)', () => {
    const avatarConfig = {
      version: 1 as const, base: 'round' as const, skinTone: 'warm' as const,
      hairStyle: 'curls' as const, hairColor: 'brown' as const, face: 'smile' as const,
      accessory: 'glasses' as const, outfit: 'hoodie' as const,
      outfitColor: 'purple' as const, background: 'mint' as const,
    }

    it('stores validated requested/current avatar configs without changing unlock data', async () => {
      const tx = transactionWith({
        'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: 'https://old', avatarId: 'starter-cat', avatarConfig: { ...avatarConfig, hairStyle: 'waves' } },
      })
      firestore.getDocs.mockResolvedValue({ docs: [] })
      await submitProfileUpdateRequest('family-1', 'Muhammed', STARTER, { avatarConfig })

      expect(tx.set).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'families/family-1/profile_update_requests/generated-1' }),
        expect.objectContaining({
          requestedAvatarConfig: avatarConfig,
          currentAvatarConfig: expect.objectContaining({ version: 1, hairStyle: 'waves' }),
        }),
      )
      expect(tx.set).not.toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('avatar_unlocks') }), expect.anything())
    })

    it('rejects malformed avatar config before any request write', async () => {
      transactionWith({ 'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Muhammed Osman' } })
      firestore.getDocs.mockResolvedValue({ docs: [] })
      await expect(submitProfileUpdateRequest('family-1', 'Muhammed', STARTER, {
        avatarConfig: { ...avatarConfig, background: 'url(https://evil.example)' } as any,
      })).rejects.toThrow(/avatar configuration/i)
    })

    it('creates a pending request and notifies approvers', async () => {
      const tx = transactionWith({
        'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: 'https://old', avatarId: 'starter-cat' },
      })
      firestore.getDocs.mockResolvedValue({ docs: [] })
      await submitProfileUpdateRequest('family-1', 'Muhammed', STARTER, { ownedAvatarIds: [], legacyAvatarUrl: 'https://old' })

      expect(tx.set).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'families/family-1/profile_update_requests/generated-1' }),
        expect.objectContaining({
          familyId: 'family-1',
          childId: 'child-1',
          childName: 'Muhammed Osman',
          requestedDisplayName: 'Muhammed',
          requestedAvatarId: STARTER,
          currentAvatarId: 'starter-cat',
          currentAvatar: 'https://old',
          status: 'pending',
        }),
      )
      expect(loadNotificationRecipientsInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        'family-1',
        expect.objectContaining({ type: 'profile_update_requested', recipientIds: ['owner-1'] }),
      )
      expect(applyNotificationWrites).toHaveBeenCalled()
    })

    it('blocks a second active request for the same child', async () => {
      transactionWith({ 'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Muhammed Osman' } })
      firestore.getDocs.mockResolvedValue({ docs: [{ data: () => ({ status: 'pending' }) }] })
      await expect(submitProfileUpdateRequest('family-1', 'Muhammed', STARTER, { ownedAvatarIds: [] }))
        .rejects.toThrow(/waiting for approval/i)
    })

    it('rejects when the actor is not a child', async () => {
      authState.currentUser = { uid: 'owner-1' }
      transactionWith({ 'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Kemal' } })
      firestore.getDocs.mockResolvedValue({ docs: [] })
      await expect(submitProfileUpdateRequest('family-1', 'Kemal', null, { ownedAvatarIds: [] })).rejects.toThrow(/children/i)
    })

    it('rejects a premium avatar the child has not unlocked', async () => {
      transactionWith({ 'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Muhammed Osman' } })
      firestore.getDocs.mockResolvedValue({ docs: [] })
      await expect(submitProfileUpdateRequest('family-1', 'Muhammed', PREMIUM, { ownedAvatarIds: [] }))
        .rejects.toThrow(/not been unlocked yet/i)
    })
  })

  describe('approve', () => {
    const avatarConfig = {
      version: 1 as const, base: 'round' as const, skinTone: 'warm' as const,
      hairStyle: 'curls' as const, hairColor: 'brown' as const, face: 'smile' as const,
      accessory: 'glasses' as const, outfit: 'hoodie' as const,
      outfitColor: 'purple' as const, background: 'mint' as const,
    }

    it('applies only a validated requested avatar config during parent approval', async () => {
      authState.currentUser = { uid: 'owner-1' }
      const tx = transactionWith({
        'families/family-1/profile_update_requests/req-config': {
          childId: 'child-1', childName: 'Muhammed', requestedDisplayName: 'Muhammed',
          requestedAvatarId: 'starter-cat', requestedAvatar: 'https://old', requestedAvatarConfig: avatarConfig,
          currentDisplayName: 'Muhammed', currentAvatarId: 'starter-cat', currentAvatar: 'https://old', status: 'pending',
        },
        'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Muhammed', avatarUrl: 'https://old', avatarId: 'starter-cat' },
        'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Kemal' },
      })
      await approveProfileUpdateRequest('family-1', 'req-config')
      expect(tx.update).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/child-1' }),
        expect.objectContaining({ avatarConfig }),
      )
    })

    it('rejects a malformed requested config instead of applying it', async () => {
      authState.currentUser = { uid: 'owner-1' }
      transactionWith({
        'families/family-1/profile_update_requests/req-config': {
          childId: 'child-1', requestedDisplayName: 'Muhammed', requestedAvatarConfig: { ...avatarConfig, extra: 'bad' }, status: 'pending',
        },
        'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Muhammed' },
        'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Kemal' },
      })
      await expect(approveProfileUpdateRequest('family-1', 'req-config')).rejects.toThrow(/avatar configuration/i)
    })

    it('updates the profile atomically and notifies the child', async () => {
      authState.currentUser = { uid: 'owner-1' }
      const tx = transactionWith({
        'families/family-1/profile_update_requests/req-1': {
          childId: 'child-1', childName: 'Muhammed', requestedDisplayName: 'Muhammed',
          requestedAvatarId: STARTER, requestedAvatar: 'https://x/starter', currentDisplayName: 'Muhammed Osman',
          currentAvatarId: 'starter-cat', currentAvatar: 'https://old', status: 'pending',
        },
        'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: 'https://old', avatarId: 'starter-cat' },
        'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Kemal' },
      })
      await approveProfileUpdateRequest('family-1', 'req-1')

      expect(tx.update).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/child-1' }),
        expect.objectContaining({ displayName: 'Muhammed', avatarId: STARTER, avatarUrl: 'https://x/starter' }),
      )
      expect(tx.update).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'families/family-1/profile_update_requests/req-1' }),
        expect.objectContaining({ status: 'approved', reviewedBy: 'owner-1', reviewedByName: 'Kemal' }),
      )
      expect(loadNotificationRecipientsInTransaction).toHaveBeenCalledWith(
        expect.anything(), 'family-1',
        expect.objectContaining({ type: 'profile_update_approved', recipientIds: ['child-1'] }),
      )
      expect(applyNotificationWrites).toHaveBeenCalled()
    })

    it('keeps the current avatar when no avatar id is requested', async () => {
      authState.currentUser = { uid: 'owner-1' }
      const tx = transactionWith({
        'families/family-1/profile_update_requests/req-1': {
          childId: 'child-1', childName: 'Muhammed', requestedDisplayName: 'Muhammed',
          requestedAvatarId: null, requestedAvatar: '', currentDisplayName: 'Muhammed Osman',
          currentAvatarId: 'starter-cat', currentAvatar: 'https://old', status: 'pending',
        },
        'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Muhammed Osman', avatarUrl: 'https://old', avatarId: 'starter-cat' },
        'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Kemal' },
      })
      await approveProfileUpdateRequest('family-1', 'req-1')
      expect(tx.update).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/child-1' }),
        expect.objectContaining({ displayName: 'Muhammed', avatarId: 'starter-cat', avatarUrl: 'https://old' }),
      )
    })

    it('rejects when the request is not pending', async () => {
      authState.currentUser = { uid: 'owner-1' }
      transactionWith({
        'families/family-1/profile_update_requests/req-1': { childId: 'child-1', status: 'approved' },
        'users/owner-1': { familyId: 'family-1', role: 'owner' },
      })
      await expect(approveProfileUpdateRequest('family-1', 'req-1')).rejects.toThrow(/not pending/i)
    })

    it('rejects when the child is no longer in the family', async () => {
      authState.currentUser = { uid: 'owner-1' }
      transactionWith({
        'families/family-1/profile_update_requests/req-1': {
          childId: 'child-1', childName: 'Muhammed', requestedDisplayName: 'Muhammed',
          requestedAvatarId: null, requestedAvatar: '', currentDisplayName: 'Muhammed Osman', currentAvatar: '', status: 'pending',
        },
        'users/child-1': { familyId: 'other-family', role: 'child' },
        'users/owner-1': { familyId: 'family-1', role: 'owner' },
      })
      await expect(approveProfileUpdateRequest('family-1', 'req-1')).rejects.toThrow(/no longer/i)
    })
  })

  describe('reject', () => {
    it('marks rejected, preserves the profile, notifies the child, and keeps history', async () => {
      authState.currentUser = { uid: 'owner-1' }
      const tx = transactionWith({
        'families/family-1/profile_update_requests/req-1': { childId: 'child-1', childName: 'Muhammed', status: 'pending' },
        'users/owner-1': { familyId: 'family-1', role: 'owner', displayName: 'Kemal' },
      })
      await rejectProfileUpdateRequest('family-1', 'req-1', 'Not appropriate')

      expect(tx.update).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'families/family-1/profile_update_requests/req-1' }),
        expect.objectContaining({ status: 'rejected', reviewedBy: 'owner-1', rejectionReason: 'Not appropriate' }),
      )
      // Profile is never written during rejection.
      expect(tx.update).not.toHaveBeenCalledWith(expect.objectContaining({ path: 'users/child-1' }), expect.anything())
      // History is preserved (request is updated, never deleted).
      expect(tx.delete).not.toHaveBeenCalled()
      expect(loadNotificationRecipientsInTransaction).toHaveBeenCalledWith(
        expect.anything(), 'family-1',
        expect.objectContaining({ type: 'profile_update_rejected', recipientIds: ['child-1'] }),
      )
      expect(applyNotificationWrites).toHaveBeenCalled()
    })
  })

  describe('unlock avatar', () => {
    it('deducts the exact catalog cost and writes an immutable unlock record', async () => {
      const tx = transactionWith({
        'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Muhammed', rewardPoints: 500 },
        'families/family-1/users/child-1/avatar_unlocks/rare-neon': undefined,
      })
      const cost = await unlockAvatar('family-1', PREMIUM)
      expect(cost).toBe(150)
      expect(tx.update).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users/child-1' }),
        { rewardPoints: 350 },
      )
      expect(tx.set).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'families/family-1/users/child-1/avatar_unlocks/rare-neon' }),
        expect.objectContaining({ avatarId: PREMIUM, userId: 'child-1', familyId: 'family-1', costPoints: 150, source: 'points', actorId: 'child-1' }),
      )
    })

    it('rejects when points are insufficient', async () => {
      transactionWith({
        'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Muhammed', rewardPoints: 100 },
        'families/family-1/users/child-1/avatar_unlocks/rare-neon': undefined,
      })
      await expect(unlockAvatar('family-1', PREMIUM)).rejects.toThrow(/more points/i)
    })

    it('rejects a duplicate unlock', async () => {
      transactionWith({
        'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Muhammed', rewardPoints: 500 },
        'families/family-1/users/child-1/avatar_unlocks/rare-neon': { avatarId: PREMIUM, userId: 'child-1' },
      })
      await expect(unlockAvatar('family-1', PREMIUM)).rejects.toThrow(/already own/i)
    })

    it('rejects a starter avatar (nothing to unlock)', async () => {
      transactionWith({
        'users/child-1': { familyId: 'family-1', role: 'child', displayName: 'Muhammed', rewardPoints: 500 },
      })
      await expect(unlockAvatar('family-1', STARTER)).rejects.toThrow(/already free/i)
    })
  })

  // -------------------------------------------------------------------------
  // Transaction operation ordering regression (Firestore reads-before-writes)
  // -------------------------------------------------------------------------
  describe('transaction operation ordering', () => {
    const childDoc = {
      familyId: 'family-1', role: 'child', displayName: 'Muhammed Osman',
      avatarUrl: 'https://old', avatarId: 'starter-cat', rewardPoints: 500,
    }

    it('free avatar request uses reads-before-writes', async () => {
      const tx = recordingTransaction({ 'users/child-1': childDoc })
      firestore.getDocs.mockResolvedValue({ docs: [] })
      await submitProfileUpdateRequest('family-1', 'Muhammed', STARTER, { ownedAvatarIds: [], legacyAvatarUrl: 'https://old' })
      expectReadsBeforeWrites(tx)
    })

    it('owned premium avatar request uses reads-before-writes', async () => {
      const tx = recordingTransaction({ 'users/child-1': childDoc })
      firestore.getDocs.mockResolvedValue({ docs: [] })
      await submitProfileUpdateRequest('family-1', 'Muhammed', PREMIUM, { ownedAvatarIds: [PREMIUM], legacyAvatarUrl: 'https://old' })
      expectReadsBeforeWrites(tx)
    })

    it('recipient resolution (notification read) completes before writes', async () => {
      const tx = recordingTransaction({ 'users/child-1': childDoc })
      firestore.getDocs.mockResolvedValue({ docs: [] })
      await submitProfileUpdateRequest('family-1', 'Muhammed', STARTER, { ownedAvatarIds: [], legacyAvatarUrl: 'https://old' })
      // The notification dedupe read must occur before the request/feed writes.
      const notifReadIdx = tx._ops.indexOf('get')
      const firstWrite = tx._ops.findIndex(op => op === 'set' || op === 'update' || op === 'delete')
      expect(notifReadIdx).toBeGreaterThanOrEqual(0)
      expect(firstWrite).toBeGreaterThan(notifReadIdx)
    })

    it('notification helper does not read during the write phase', async () => {
      const tx = recordingTransaction({ 'users/child-1': childDoc })
      firestore.getDocs.mockResolvedValue({ docs: [] })
      await submitProfileUpdateRequest('family-1', 'Muhammed', STARTER, { ownedAvatarIds: [], legacyAvatarUrl: 'https://old' })
      // applyNotificationWrites must be the final op and perform zero gets.
      expect(applyNotificationWrites).toHaveBeenCalled()
      expectReadsBeforeWrites(tx)
    })

    it('duplicate active request fails before any writes', async () => {
      const tx = recordingTransaction({ 'users/child-1': childDoc })
      firestore.getDocs.mockResolvedValue({ docs: [{ data: () => ({ status: 'pending' }) }] })
      await expect(submitProfileUpdateRequest('family-1', 'Muhammed', STARTER, { ownedAvatarIds: [] }))
        .rejects.toThrow(/waiting for approval/i)
      expect(tx.set).not.toHaveBeenCalled()
      expect(tx.update).not.toHaveBeenCalled()
    })

    it('locked avatar fails before any writes', async () => {
      const tx = recordingTransaction({ 'users/child-1': childDoc })
      firestore.getDocs.mockResolvedValue({ docs: [] })
      await expect(submitProfileUpdateRequest('family-1', 'Muhammed', PREMIUM, { ownedAvatarIds: [] }))
        .rejects.toThrow(/not been unlocked yet/i)
      expect(tx.set).not.toHaveBeenCalled()
    })

    it('transaction failure creates no partial request', async () => {
      firestore.runTransaction.mockRejectedValueOnce(new Error('permission-denied'))
      firestore.getDocs.mockResolvedValue({ docs: [] })
      await expect(submitProfileUpdateRequest('family-1', 'Muhammed', STARTER, { ownedAvatarIds: [], legacyAvatarUrl: 'https://old' }))
        .rejects.toThrow(/permission-denied/i)
      // No writes should have been committed (transaction aborted by Firestore).
      expect(loadNotificationRecipientsInTransaction).not.toHaveBeenCalled()
    })

    it('request, notifications, and feed/audit writes remain atomic', async () => {
      const tx = recordingTransaction({ 'users/child-1': childDoc })
      firestore.getDocs.mockResolvedValue({ docs: [] })
      await submitProfileUpdateRequest('family-1', 'Muhammed', STARTER, { ownedAvatarIds: [], legacyAvatarUrl: 'https://old' })
      // All writes share the same transaction instance.
      expect(tx.set).toHaveBeenCalled()
      expect(applyNotificationWrites).toHaveBeenCalled()
      // The request write and the notification write are on the same tx object.
      expect(loadNotificationRecipientsInTransaction).toHaveBeenCalledWith(tx, 'family-1', expect.anything())
    })
  })
})
