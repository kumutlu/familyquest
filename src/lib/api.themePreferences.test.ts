/**
 * Parent Theme Shop preference API tests (spec §16 / §A-Parent controls).
 *
 * Pins:
 *  - themeShoppingEnabled writes only that field
 *  - seasonalEvents normalisation drops unknown keys and non-boolean values
 *  - a seasonalEvents write preserves unrelated engagementPreferences keys
 *  - nothing is written when there is nothing to update
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const firestore = vi.hoisted(() => ({
  // Typed with args so mock.calls tuples carry the update payload for assertions.
  updateDoc: vi.fn(async (_ref: unknown, _payload: Record<string, unknown>) => {}),
  getDoc: vi.fn(async () => ({
    exists: () => true,
    data: () => ({
      engagementPreferences: { surgeHours: true, seasonalEvents: { ramadan: true } },
    }),
  })),
}))

vi.mock('firebase/firestore', () => ({
  ...firestore,
  collection: vi.fn((_d: unknown, p: string) => ({ path: p })),
  doc: vi.fn((_d: unknown, ...parts: string[]) => ({ id: parts.at(-1), path: parts.join('/') })),
  serverTimestamp: vi.fn(() => ({ server: true })),
  runTransaction: vi.fn(),
}))
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(), signInWithEmailAndPassword: vi.fn(), signInWithPopup: vi.fn(), signOut: vi.fn(),
}))
vi.mock('./firebase', () => ({ db: { name: 'db' }, auth: { currentUser: { uid: 'owner-1' } }, googleProvider: {} }))
vi.mock('./notifications', () => ({
  getApproverIds: vi.fn(async () => []),
  getChildIds: vi.fn(async () => []),
  loadNotificationRecipientsInTransaction: vi.fn(async () => ({ ref: null, data: null })),
  applyNotificationWrites: vi.fn(() => {}),
}))

import { updateFamilySettings, normaliseSeasonalEvents, SEASONAL_EVENT_KEYS } from './api'

describe('normaliseSeasonalEvents', () => {
  it('keeps only known keys with a true value', () => {
    expect(normaliseSeasonalEvents({ christmas: true, ramadan: true, diwali: true, eid: false })).toEqual({
      christmas: true, ramadan: true,
    })
  })

  it('handles null/undefined/non-object input safely', () => {
    expect(normaliseSeasonalEvents(null)).toEqual({})
    expect(normaliseSeasonalEvents(undefined)).toEqual({})
    expect(normaliseSeasonalEvents('nope' as never)).toEqual({})
  })

  it('exposes the closed key set', () => {
    expect(SEASONAL_EVENT_KEYS).toContain('ramadan')
    expect(SEASONAL_EVENT_KEYS).toContain('eid')
    expect(SEASONAL_EVENT_KEYS).toContain('christmas')
    expect(SEASONAL_EVENT_KEYS).toHaveLength(7)
  })
})

describe('updateFamilySettings — theme preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes themeShoppingEnabled as its own field', async () => {
    await updateFamilySettings('family-1', { themeShoppingEnabled: false })
    expect(firestore.updateDoc).toHaveBeenCalledWith(
      { id: 'family-1', path: 'families/family-1' },
      { themeShoppingEnabled: false },
    )
  })

  it('merges seasonalEvents into engagementPreferences preserving surgeHours', async () => {
    await updateFamilySettings('family-1', { seasonalEvents: { christmas: true, ramadan: false } })
    const payload = (firestore.updateDoc.mock.calls[0]?.[1] ?? {}) as Record<string, any>
    expect(payload.engagementPreferences.surgeHours).toBe(true)
    expect(payload.engagementPreferences.seasonalEvents).toEqual({ christmas: true })
  })

  it('drops unknown seasonal keys before writing', async () => {
    await updateFamilySettings('family-1', { seasonalEvents: { diwali: true } as never })
    const payload = (firestore.updateDoc.mock.calls[0]?.[1] ?? {}) as Record<string, any>
    expect(payload.engagementPreferences.seasonalEvents).toEqual({})
  })

  it('writes nothing when no updates are supplied', async () => {
    await expect(updateFamilySettings('family-1', {})).rejects.toThrow(/No family settings/i)
    expect(firestore.updateDoc).not.toHaveBeenCalled()
  })

  it('does not touch unrelated settings on a theme-only write', async () => {
    await updateFamilySettings('family-1', { themeShoppingEnabled: true })
    const payload = (firestore.updateDoc.mock.calls[0]?.[1] ?? {}) as Record<string, any>
    expect(Object.keys(payload)).toEqual(['themeShoppingEnabled'])
  })
})
