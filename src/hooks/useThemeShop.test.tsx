/**
 * useThemeShop + Theme of the Week lifecycle tests.
 *
 * Covers the shop view model (availability, ownership, promo, prices) and
 * the child-equip layer of useExperienceTheme (owned/promo rights, safe
 * expiry fallback, ownership unaffected by promotions).
 *
 * The Zustand store is mocked at the module boundary so tests are
 * deterministic without Firestore.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSyncExternalStore } from 'react'

// Reset module-level singletons between tests (purchase in-flight ref, clock).

/* -------------------------------------------------------------------------- */
/* Store mock                                                                 */
/* -------------------------------------------------------------------------- */

type StoreState = Record<string, unknown>

let storeState: StoreState = {}
const storeListeners = new Set<() => void>()

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: StoreState) => unknown) => useSyncExternalStore(
    (onStoreChange) => {
      storeListeners.add(onStoreChange)
      return () => { storeListeners.delete(onStoreChange) }
    },
    () => selector(storeState),
    () => selector(storeState),
  ),
}))

function setStore(next: StoreState) {
  storeState = { ...storeState, ...next }
  for (const listener of storeListeners) listener()
}

/* -------------------------------------------------------------------------- */
/* Mocks for purchaseShopTheme (imported by useThemeShop)                     */
/* -------------------------------------------------------------------------- */

const purchaseMock = vi.hoisted(() => vi.fn(async () => ({ costPoints: 500, themeId: 'theme.shop.space' })))
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, purchaseShopTheme: purchaseMock }
})

import { useThemeShop, setThemeShopClock } from './useThemeShop'
import {
  useExperienceTheme,
  setExperienceClock,
  setExperiencePreferences,
  resetExperienceState,
} from './useExperienceTheme'
import { storeEquippedTheme, getStoredEquippedTheme, migrateLegacyEquippedTheme } from './useChildThemeRights'
import { normaliseExperiencePreferences } from '../domain/experience'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function promoRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'space',
    shopItemId: 'space',
    themeId: 'theme.shop.space',
    name: 'Space Explorer',
    pricePoints: 500,
    isActive: true,
    ...overrides,
  }
}

describe('useThemeShop — shop view model', () => {
  beforeEach(() => {
    purchaseMock.mockClear()
    purchaseMock.mockImplementation(async () => ({ costPoints: 500, themeId: 'theme.shop.space' }))
    storeListeners.clear()
    setThemeShopClock(() => Date.UTC(2026, 8, 28, 12, 0, 0))
    setStore({
      currentUser: { id: 'child-1', familyId: 'family-1' },
      familyData: { id: 'family-1' },
      themeShopItems: [],
      themePurchases: [],
    })
  })

  it('renders every shop theme from built-in defaults with no catalog rows', () => {
    const { result } = renderHook(() => useThemeShop())
    expect(result.current.items.map(i => i.shopItemId)).toEqual(['neon', 'space', 'rainbow', 'pixel', 'calm'])
    expect(result.current.items.find(i => i.shopItemId === 'space')!.pricePoints).toBe(500)
    expect(result.current.items.find(i => i.shopItemId === 'calm')!.pricePoints).toBe(300)
    expect(result.current.isLoading).toBe(false)
  })

  it('marks unowned paid items purchasable and never owned', () => {
    const { result } = renderHook(() => useThemeShop())
    const space = result.current.items.find(i => i.shopItemId === 'space')!
    expect(space.status).toBe('purchasable')
    expect(space.effectivePricePoints).toBe(500)
  })

  it('marks purchased items owned with an effective price of 0 display state', () => {
    setStore({
      themePurchases: [{ id: 'space', shopItemId: 'space', childId: 'child-1', costPoints: 500 }],
    })
    const { result } = renderHook(() => useThemeShop())
    const space = result.current.items.find(i => i.shopItemId === 'space')!
    expect(space.status).toBe('owned')
  })

  it('ownership is child-specific: another child purchase does not grant ownership', () => {
    setStore({
      themePurchases: [{ id: 'space', shopItemId: 'space', childId: 'child-2', costPoints: 500 }],
    })
    const { result } = renderHook(() => useThemeShop())
    const space = result.current.items.find(i => i.shopItemId === 'space')!
    expect(space.status).toBe('purchasable')
  })

  it('parent catalog row overrides the built-in price and active flag', () => {
    setStore({
      themeShopItems: [promoRow({ pricePoints: 250 })],
      themePurchases: [],
    })
    const { result } = renderHook(() => useThemeShop())
    const space = result.current.items.find(i => i.shopItemId === 'space')!
    expect(space.pricePoints).toBe(250)
    expect(space.hasCatalogRow).toBe(true)
  })

  it('parent catalog row can deactivate an item', () => {
    setStore({
      themeShopItems: [promoRow({ isActive: false })],
      themePurchases: [],
    })
    const { result } = renderHook(() => useThemeShop())
    const space = result.current.items.find(i => i.shopItemId === 'space')!
    expect(space.status).toBe('free')
    expect(space.isActive).toBe(false)
  })

  it('reports the parent disable switch', () => {
    setStore({
      familyData: { id: 'family-1', engagementPreferences: { themeShoppingEnabled: false } },
    })
    const { result } = renderHook(() => useThemeShop())
    expect(result.current.shoppingDisabled).toBe(true)
  })

  it('routes purchases through the canonical pipeline and reports failure', async () => {
    const { result } = renderHook(() => useThemeShop())
    purchaseMock.mockResolvedValueOnce({ costPoints: 500, themeId: 'theme.shop.space' })
    await act(async () => {
      const ok = await result.current.purchase('space')
      expect(ok).toBe(true)
    })
    expect(purchaseMock).toHaveBeenCalledWith('family-1', 'space')

    purchaseMock.mockRejectedValueOnce(new Error('You need 200 more points to buy this theme.'))
    await act(async () => {
      const ok = await result.current.purchase('space')
      expect(ok).toBe(false)
    })
    expect(result.current.purchaseError).toMatch(/more points/)
    act(() => result.current.clearError())
    expect(result.current.purchaseError).toBeNull()
  })

  it('swallows a second purchase attempt while one is in flight', async () => {
    const { result } = renderHook(() => useThemeShop())
    let release: (value: { costPoints: number; themeId: string }) => void = () => {}
    purchaseMock.mockImplementationOnce(() => new Promise<{ costPoints: number; themeId: string }>(resolve => { release = resolve }))
    let firstOk: boolean | undefined
    await act(async () => {
      const promise = result.current.purchase('space').then(ok => { firstOk = ok })
      // Second click while in flight → refused synchronously.
      const secondOk = await result.current.purchase('space')
      expect(secondOk).toBe(false)
      release({ costPoints: 500, themeId: 'theme.shop.space' })
      await promise
    })
    expect(firstOk).toBe(true)
    expect(purchaseMock).toHaveBeenCalledTimes(1)
  })
})

describe('Theme of the Week — shop surface', () => {
  beforeEach(() => {
    storeListeners.clear()
    setStore({
      currentUser: { id: 'child-1', familyId: 'family-1' },
      familyData: { id: 'family-1' },
      themeShopItems: [],
      themePurchases: [],
    })
  })

  it('surfaces a live promotion and marks the item promo with 0 effective price', () => {
    setThemeShopClock(() => Date.UTC(2026, 8, 28, 12, 0, 0))
    setStore({
      themeShopItems: [promoRow({
        promo: {
          themeId: 'theme.shop.space',
          startsAt: Date.UTC(2026, 8, 21, 0, 0, 0),
          endsAt: Date.UTC(2026, 8, 28, 12, 0, 0) + 60_000,
        },
      })],
      themePurchases: [],
    })
    const { result } = renderHook(() => useThemeShop())
    expect(result.current.themeOfTheWeek?.theme.id).toBe('theme.shop.space')
    const space = result.current.items.find(i => i.shopItemId === 'space')!
    expect(space.status).toBe('promo')
    expect(space.effectivePricePoints).toBe(0)
  })

  it('ignores an expired promotion', () => {
    setThemeShopClock(() => Date.UTC(2026, 8, 28, 12, 0, 0))
    setStore({
      themeShopItems: [promoRow({
        promo: {
          themeId: 'theme.shop.space',
          startsAt: Date.UTC(2026, 8, 21, 0, 0, 0),
          endsAt: Date.UTC(2026, 8, 28, 11, 0, 0),
        },
      })],
      themePurchases: [],
    })
    const { result } = renderHook(() => useThemeShop())
    expect(result.current.themeOfTheWeek).toBeNull()
    const space = result.current.items.find(i => i.shopItemId === 'space')!
    expect(space.status).toBe('purchasable')
  })

  it('ignores a future promotion', () => {
    setThemeShopClock(() => Date.UTC(2026, 8, 28, 12, 0, 0))
    setStore({
      themeShopItems: [promoRow({
        promo: {
          themeId: 'theme.shop.space',
          startsAt: Date.UTC(2026, 8, 28, 12, 0, 0) + 3_600_000,
          endsAt: Date.UTC(2026, 8, 28, 12, 0, 0) + WEEK_MS,
        },
      })],
      themePurchases: [],
    })
    const { result } = renderHook(() => useThemeShop())
    expect(result.current.themeOfTheWeek).toBeNull()
  })

  it('an owned promoted theme still shows owned (ownership wins over promo)', () => {
    setThemeShopClock(() => Date.UTC(2026, 8, 28, 12, 0, 0))
    setStore({
      themeShopItems: [promoRow({
        promo: {
          themeId: 'theme.shop.space',
          startsAt: Date.UTC(2026, 8, 21, 0, 0, 0),
          endsAt: Date.UTC(2026, 8, 28, 12, 0, 0) + 60_000,
        },
      })],
      themePurchases: [{ id: 'space', shopItemId: 'space', childId: 'child-1', costPoints: 500 }],
    })
    const { result } = renderHook(() => useThemeShop())
    const space = result.current.items.find(i => i.shopItemId === 'space')!
    expect(space.status).toBe('owned')
  })
})

describe('Theme of the Week — child equip rights (useExperienceTheme)', () => {
  const NOW = Date.UTC(2026, 8, 28, 12, 0, 0)

  beforeEach(() => {
    storeListeners.clear()
    localStorage.clear()
    setExperienceClock(() => NOW)
    setExperiencePreferences(normaliseExperiencePreferences({ weeklyThemes: true, seasonalEvents: {} }))
    resetExperienceState()
    setStore({
      currentUser: { id: 'child-1', familyId: 'family-1', theme: null },
      familyData: { id: 'family-1' },
      themeShopItems: [],
      themePurchases: [],
    })
    return () => {
      resetExperienceState()
      localStorage.clear()
    }
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('falls back to the default theme when nothing is equipped', () => {
    const { result } = renderHook(() => useExperienceTheme())
    expect(result.current.theme.id).toBe('theme.standard')
  })

  it('equips an owned shop theme above base', () => {
    setStore({
      themePurchases: [{ id: 'space', shopItemId: 'space', childId: 'child-1', costPoints: 500 }],
      currentUser: { id: 'child-1', familyId: 'family-1', theme: 'theme.shop.space' },
    })
    const { result } = renderHook(() => useExperienceTheme())
    expect(result.current.theme.id).toBe('theme.shop.space')
    expect(result.current.source).toBe('equipped')
  })

  it('a locked theme can NOT become the persisted active theme', () => {
    setStore({
      themePurchases: [],
      currentUser: { id: 'child-1', familyId: 'family-1', theme: 'theme.shop.space' },
    })
    const { result } = renderHook(() => useExperienceTheme())
    expect(result.current.theme.id).toBe('theme.standard')
    expect(result.current.source).toBe('base')
  })

  it('lets a child use the live promo theme WITHOUT owning it', () => {
    setStore({
      themeShopItems: [promoRow({
        promo: {
          themeId: 'theme.shop.space',
          startsAt: NOW - 1000,
          endsAt: NOW + WEEK_MS,
        },
      })],
      themePurchases: [],
      currentUser: { id: 'child-1', familyId: 'family-1', theme: 'theme.shop.space' },
    })
    const { result } = renderHook(() => useExperienceTheme())
    expect(result.current.theme.id).toBe('theme.shop.space')
    expect(result.current.source).toBe('equipped')
  })

  it('returns safely to the previous valid theme when the promotion expires', () => {
    setStore({
      themeShopItems: [promoRow({
        promo: {
          themeId: 'theme.shop.space',
          startsAt: NOW - WEEK_MS,
          endsAt: NOW - 1000, // just expired
        },
      })],
      themePurchases: [],
      currentUser: { id: 'child-1', familyId: 'family-1', theme: 'theme.shop.space' },
    })
    const { result } = renderHook(() => useExperienceTheme())
    expect(result.current.theme.id).toBe('theme.standard')
  })

  it('a purchased promoted theme remains usable after the promotion expires', () => {
    setStore({
      themeShopItems: [promoRow({
        promo: {
          themeId: 'theme.shop.space',
          startsAt: NOW - WEEK_MS,
          endsAt: NOW - 1000, // expired
        },
      })],
      themePurchases: [{ id: 'space', shopItemId: 'space', childId: 'child-1', costPoints: 500 }],
      currentUser: { id: 'child-1', familyId: 'family-1', theme: 'theme.shop.space' },
    })
    const { result } = renderHook(() => useExperienceTheme())
    expect(result.current.theme.id).toBe('theme.shop.space')
  })

  it('promo state does NOT create ownership — shop still shows purchasable after expiry', () => {
    setStore({
      themeShopItems: [promoRow({
        promo: {
          themeId: 'theme.shop.space',
          startsAt: NOW - WEEK_MS,
          endsAt: NOW - 1000,
        },
      })],
      themePurchases: [],
      currentUser: { id: 'child-1', familyId: 'family-1', theme: 'theme.shop.space' },
    })
    const shop = renderHook(() => useThemeShop())
    const space = shop.result.current.items.find(i => i.shopItemId === 'space')!
    expect(space.status).toBe('purchasable')
    expect(space.effectivePricePoints).toBe(500)
  })

  it('maps legacy / unknown theme values safely to the default', () => {
    setStore({
      currentUser: { id: 'child-1', familyId: 'family-1', theme: 'theme.does-not-exist' },
    })
    const { result } = renderHook(() => useExperienceTheme())
    expect(result.current.theme.id).toBe('theme.standard')
  })

  it('Child A ownership does not leak to Child B', () => {
    setStore({
      themePurchases: [{ id: 'space', shopItemId: 'space', childId: 'child-2', costPoints: 500 }],
      currentUser: { id: 'child-1', familyId: 'family-1', theme: 'theme.shop.space' },
    })
    const { result } = renderHook(() => useExperienceTheme())
    expect(result.current.theme.id).toBe('theme.standard')
  })

  it('mirrors the equipped theme in localStorage (scoped per family + child)', () => {
    setStore({
      themePurchases: [{ id: 'space', shopItemId: 'space', childId: 'child-1', costPoints: 500 }],
      currentUser: { id: 'child-1', familyId: 'family-1', theme: 'theme.shop.space' },
    })
    renderHook(() => useExperienceTheme())
    expect(getStoredEquippedTheme('family-1', 'child-1')).toBe('theme.shop.space')
    // The legacy GLOBAL key must never be written again.
    expect(window.localStorage.getItem('queki:equipped-theme')).toBeNull()
  })

  it('uses the cached mirror when the profile value is temporarily unavailable', () => {
    storeEquippedTheme('theme.shop.space', 'family-1', 'child-1')
    setStore({
      themePurchases: [{ id: 'space', shopItemId: 'space', childId: 'child-1', costPoints: 500 }],
      currentUser: { id: 'child-1', familyId: 'family-1', theme: null },
    })
    const { result } = renderHook(() => useExperienceTheme())
    expect(result.current.theme.id).toBe('theme.shop.space')
    // Cleanup
    storeEquippedTheme(null, 'family-1', 'child-1')
  })

  it('equipped seasonal layer stays inside the resolver: base+weekly still resolves base when nothing equipped', () => {
    const { result } = renderHook(() => useExperienceTheme())
    // No live fixture events at the deterministic clock → base.
    expect(result.current.theme.id).toBe('theme.standard')
    expect(result.current.source).toBe('base')
  })

  it('a promotion that has not started yet does NOT grant temporary access', () => {
    setStore({
      themeShopItems: [promoRow({
        promo: {
          themeId: 'theme.shop.space',
          // A full week beyond NOW so the window has not started under
          // either the suite clock or the real wall clock.
          startsAt: NOW + WEEK_MS,
          endsAt: NOW + 2 * WEEK_MS,
        },
      })],
      themePurchases: [],
      currentUser: { id: 'child-1', familyId: 'family-1', theme: 'theme.shop.space' },
    })
    const { result } = renderHook(() => useExperienceTheme())
    expect(result.current.theme.id).toBe('theme.standard')
  })

  it('promo access is exact at the exclusive end boundary (endsAt itself is expired)', () => {
    // Pin the engine clock to NOW (beforeEach's resetExperienceState
    // restored the real clock) so the boundary is exact.
    setExperienceClock(() => NOW)
    setStore({
      themeShopItems: [promoRow({
        promo: {
          themeId: 'theme.shop.space',
          startsAt: NOW - WEEK_MS,
          endsAt: NOW, // ends exactly now → not live
        },
        // The purchase state stays empty: only the promo could grant access.
      })],
      themePurchases: [],
      currentUser: { id: 'child-1', familyId: 'family-1', theme: 'theme.shop.space' },
    })
    const { result } = renderHook(() => useExperienceTheme())
    expect(result.current.theme.id).toBe('theme.standard')
  })

  it('a stale localStorage mirror can NOT equip an unowned theme after sign-out', () => {
    // Simulates a previous child's leftover mirror on a shared device.
    storeEquippedTheme('theme.shop.space', 'family-1', 'child-1')
    setStore({
      themePurchases: [],
      currentUser: { id: 'child-1', familyId: 'family-1', theme: null },
    })
    const { result } = renderHook(() => useExperienceTheme())
    expect(result.current.theme.id).toBe('theme.standard')
    expect(result.current.source).toBe('base')
  })

  it('the profile theme wins over a stale unowned mirror (fail-closed preference order)', () => {
    storeEquippedTheme('theme.shop.space', 'family-1', 'child-1')
    setStore({
      themePurchases: [{ id: 'rainbow', shopItemId: 'rainbow', childId: 'child-1', costPoints: 300 }],
      currentUser: { id: 'child-1', familyId: 'family-1', theme: 'theme.shop.rainbow' },
    })
    const { result } = renderHook(() => useExperienceTheme())
    expect(result.current.theme.id).toBe('theme.shop.rainbow')
  })
})

describe('equipped-theme localStorage scoping (child isolation)', () => {
  beforeEach(() => {
    storeListeners.clear()
    setThemeShopClock(() => Date.UTC(2026, 8, 28, 12, 0, 0))
    window.localStorage.clear()
    resetExperienceState()
    setStore({
      currentUser: { id: 'child-1', familyId: 'family-1' },
      familyData: { id: 'family-1' },
      themeShopItems: [],
      themePurchases: [],
    })
  })

  it('child A theme does not leak to child B on a shared device', () => {
    // Child A owns + equips space.
    setStore({
      themePurchases: [{ id: 'space', shopItemId: 'space', childId: 'child-a', costPoints: 500 }],
      currentUser: { id: 'child-a', familyId: 'family-1', theme: 'theme.shop.space' },
    })
    renderHook(() => useExperienceTheme())
    expect(getStoredEquippedTheme('family-1', 'child-a')).toBe('theme.shop.space')

    // Child B (no purchases, no profile theme) on the SAME device.
    setStore({
      themePurchases: [],
      currentUser: { id: 'child-b', familyId: 'family-1', theme: null },
    })
    const { result } = renderHook(() => useExperienceTheme())
    expect(result.current.theme.id).toBe('theme.standard')
    expect(result.current.source).toBe('base')
    expect(getStoredEquippedTheme('family-1', 'child-b')).toBeNull()
  })

  it('switching back to child A restores their cached theme (isolated slots)', () => {
    setStore({
      themePurchases: [{ id: 'space', shopItemId: 'space', childId: 'child-a', costPoints: 500 }],
      currentUser: { id: 'child-a', familyId: 'family-1', theme: 'theme.shop.space' },
    })
    renderHook(() => useExperienceTheme())

    // Child B session in between — writes must not touch child A's slot.
    setStore({
      themePurchases: [{ id: 'neon', shopItemId: 'neon', childId: 'child-b', costPoints: 400 }],
      currentUser: { id: 'child-b', familyId: 'family-1', theme: 'theme.shop.neon' },
    })
    renderHook(() => useExperienceTheme())
    expect(getStoredEquippedTheme('family-1', 'child-b')).toBe('theme.shop.neon')

    // Back to child A — server value briefly unavailable (null), mirror wins.
    setStore({
      themePurchases: [{ id: 'space', shopItemId: 'space', childId: 'child-a', costPoints: 500 }],
      currentUser: { id: 'child-a', familyId: 'family-1', theme: null },
    })
    const { result } = renderHook(() => useExperienceTheme())
    expect(result.current.theme.id).toBe('theme.shop.space')
  })

  it('a cached theme for a DIFFERENT child is rejected even when forged into the slot', () => {
    // Child B physically writes child A's key (tampered shared storage).
    storeEquippedTheme('theme.shop.space', 'family-1', 'child-b')
    setStore({
      themePurchases: [{ id: 'space', shopItemId: 'space', childId: 'child-a', costPoints: 500 }],
      currentUser: { id: 'child-b', familyId: 'family-1', theme: null },
    })
    const { result } = renderHook(() => useExperienceTheme())
    // Ownership is checked against the CURRENT child: child B owns nothing.
    expect(result.current.theme.id).toBe('theme.standard')
  })

  it('an inactive/stale cached theme that no longer exists is rejected', () => {
    storeEquippedTheme('theme.shop.deleted', 'family-1', 'child-1')
    setStore({
      themePurchases: [{ id: 'space', shopItemId: 'space', childId: 'child-1', costPoints: 500 }],
      currentUser: { id: 'child-1', familyId: 'family-1', theme: null },
    })
    const { result } = renderHook(() => useExperienceTheme())
    expect(result.current.theme.id).toBe('theme.standard')
  })

  it('an expired promo theme cached in the mirror no longer equips (promo only grants temporary access)', () => {
    storeEquippedTheme('theme.shop.space', 'family-1', 'child-1')
    setStore({
      // The promo window has fully passed and there is no purchase record.
      themeShopItems: [promoRow({
        promo: {
          themeId: 'theme.shop.space',
          startsAt: Date.UTC(2026, 7, 1),
          endsAt: Date.UTC(2026, 7, 8),
        },
      })],
      themePurchases: [],
      currentUser: { id: 'child-1', familyId: 'family-1', theme: null },
    })
    const { result } = renderHook(() => useExperienceTheme())
    expect(result.current.theme.id).toBe('theme.standard')
    expect(result.current.source).toBe('base')
  })

  it('server-authoritative ownership wins over a forged local cache', () => {
    storeEquippedTheme('theme.shop.space', 'family-1', 'child-1')
    setStore({
      // Server says child-1 does NOT own space (no purchase record).
      themePurchases: [],
      currentUser: { id: 'child-1', familyId: 'family-1', theme: null },
    })
    const { result } = renderHook(() => useExperienceTheme())
    expect(result.current.theme.id).toBe('theme.standard')
    expect(result.current.source).toBe('base')
  })

  it('a legacy global key is migrated once into the scoped slot, never to the next child', () => {
    // Pre-isolation release left a global value behind.
    window.localStorage.setItem('queki:equipped-theme', 'theme.shop.space')
    setStore({
      themePurchases: [{ id: 'space', shopItemId: 'space', childId: 'child-a', costPoints: 500 }],
      currentUser: { id: 'child-a', familyId: 'family-1', theme: null },
    })
    const first = renderHook(() => useExperienceTheme())
    expect(first.result.current.theme.id).toBe('theme.shop.space')
    // Migrated into the scoped slot…
    expect(getStoredEquippedTheme('family-1', 'child-a')).toBe('theme.shop.space')
    // …and the global key is gone.
    expect(window.localStorage.getItem('queki:equipped-theme')).toBeNull()
    first.unmount()

    // The NEXT child on the same device can no longer inherit it.
    setStore({
      themePurchases: [],
      currentUser: { id: 'child-b', familyId: 'family-1', theme: null },
    })
    const second = renderHook(() => useExperienceTheme())
    expect(second.result.current.theme.id).toBe('theme.standard')
    expect(second.result.current.source).toBe('base')
  })

  it('migration is idempotent: a second call finds nothing to migrate', () => {
    window.localStorage.setItem('queki:equipped-theme', 'theme.shop.space')
    expect(migrateLegacyEquippedTheme('family-1', 'child-1')).toBe('theme.shop.space')
    expect(window.localStorage.getItem('queki:equipped-theme')).toBeNull()
    expect(migrateLegacyEquippedTheme('family-1', 'child-2')).toBeNull()
    expect(getStoredEquippedTheme('family-1', 'child-2')).toBeNull()
  })

  it('storage helpers ignore calls without a full scope (no global writes ever)', () => {
    storeEquippedTheme('theme.shop.space', '', 'child-1')
    storeEquippedTheme('theme.shop.space', 'family-1', '')
    expect(window.localStorage.getItem('queki:equipped-theme')).toBeNull()
    expect(window.localStorage.length).toBe(0)
    expect(getStoredEquippedTheme('', 'child-1')).toBeNull()
    expect(getStoredEquippedTheme('family-1', '')).toBeNull()
  })
})
