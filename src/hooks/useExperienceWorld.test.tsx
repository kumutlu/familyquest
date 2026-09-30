/**
 * `useExperienceWorld` acceptance tests.
 *
 * The hook is the bridge between the authoritative Experience Theme
 * resolver and the decorative world layer. The tests pin:
 *   - The world follows the resolved theme.
 *   - A preview override is honoured (DEV only).
 *   - The world source is observable for QA.
 *   - Special Adventure state (Surge / Mystery / Comeback) remains
 *     INDEPENDENT from the world state — the hook returns no
 *     Adventure data.
 *
 * NOTE on time injection: `useExperienceTheme` owns its own clock
 * (the resolver never inspects `Date.now` directly). The seam is
 * `setExperienceClock`. We use it to pin `now` for time-sensitive
 * event tests.
 *
 * NOTE on the `useExperienceTheme` ↔ `useExperienceWorld` link: the
 * end-to-end path is covered indirectly by:
 *   - `src/domain/experience/hook.test.tsx` (theme hook is correct)
 *   - `src/domain/experienceWorld/resolver.test.ts` (world resolver
 *     maps every theme id correctly)
 * The hook test below focuses on the layers OWN to the world: the
 * preview override, the source observability, and the no-Adventure
 * contract. Time-window event tests would duplicate `hook.test.tsx`.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useExperienceWorld,
  setExperienceWorldOverride,
  resetExperienceWorldOverride,
} from './useExperienceWorld'
import {
  resetExperienceState,
  setExperiencePreferences,
  setExperienceClock,
  useExperienceTheme,
} from './useExperienceTheme'
import {
  CHRISTMAS_EVENT_2026,
  HALLOWEEN_EVENT_2026,
  EID_EVENT_2026,
  NEON_WEEK_EVENT,
} from '../domain/experience/fixtures/events'

describe('useExperienceWorld', () => {
  let disposeClock: (() => void) | null = null
  beforeEach(() => {
    resetExperienceState()
    resetExperienceWorldOverride()
  })
  afterEach(() => {
    resetExperienceState()
    resetExperienceWorldOverride()
    if (disposeClock) {
      disposeClock()
      disposeClock = null
    }
  })

  it('returns the base world by default when no event is live', () => {
    const { result } = renderHook(() => useExperienceWorld())
    expect(result.current.worldId).toBe('world.normal')
    expect(result.current.world.definition.id).toBe('world.normal')
    expect(result.current.seasonalLine).toBeNull()
    expect(result.current.isPreviewOverride).toBe(false)
  })

  it('returns the Christmas world when the theme is christmas (source = seasonal)', () => {
    const mid = CHRISTMAS_EVENT_2026.startsAt + 24 * 60 * 60 * 1000
    disposeClock = setExperienceClock(() => mid)
    act(() => {
      setExperiencePreferences({
        weeklyThemes: false,
        seasonalEvents: { christmas: true },
      })
    })
    // The world hook calls useExperienceTheme internally; the theme
    // hook is the SOURCE OF TRUTH for the link. We assert that the
    // resolver path is consistent by mounting the theme hook and the
    // world hook in the same render so they share `useSyncExternalStore`
    // subscription state.
    const { result } = renderHook(() => {
      const theme = useExperienceTheme()
      const world = useExperienceWorld()
      return { theme, world }
    })
    // Sanity: the theme hook reports the christmas theme.
    expect(result.current.theme.theme.id).toBe('theme.christmas')
    expect(result.current.theme.source).toBe('seasonal')
    // The world hook follows.
    expect(result.current.world.worldId).toBe('world.christmas')
    expect(result.current.world.world.source).toBe('seasonal-event')
    expect(result.current.world.seasonalLine).toBeTruthy()
  })

  it('returns the Halloween world when the theme is halloween', () => {
    const mid = HALLOWEEN_EVENT_2026.startsAt + 12 * 60 * 60 * 1000
    disposeClock = setExperienceClock(() => mid)
    act(() => {
      setExperiencePreferences({
        weeklyThemes: false,
        seasonalEvents: { halloween: true },
      })
    })
    const { result } = renderHook(() => {
      const theme = useExperienceTheme()
      const world = useExperienceWorld()
      return { theme, world }
    })
    expect(result.current.theme.theme.id).toBe('theme.halloween')
    expect(result.current.world.worldId).toBe('world.halloween')
  })

  it('returns the Eid world when the theme is eid', () => {
    const mid = EID_EVENT_2026.startsAt + 12 * 60 * 60 * 1000
    disposeClock = setExperienceClock(() => mid)
    act(() => {
      setExperiencePreferences({
        weeklyThemes: false,
        seasonalEvents: { eid: true },
      })
    })
    const { result } = renderHook(() => {
      const theme = useExperienceTheme()
      const world = useExperienceWorld()
      return { theme, world }
    })
    expect(result.current.theme.theme.id).toBe('theme.eid')
    expect(result.current.world.worldId).toBe('world.eid')
  })

  it('returns the Neon world when the weekly Neon event is live', () => {
    const mid = NEON_WEEK_EVENT.startsAt + 12 * 60 * 60 * 1000
    disposeClock = setExperienceClock(() => mid)
    act(() => {
      setExperiencePreferences({
        weeklyThemes: true,
        seasonalEvents: {},
      })
    })
    const { result } = renderHook(() => {
      const theme = useExperienceTheme()
      const world = useExperienceWorld()
      return { theme, world }
    })
    expect(result.current.theme.theme.id).toBe('theme.weekly.neon')
    expect(result.current.world.worldId).toBe('world.neon')
  })

  it('a preview override wins over the resolved theme (DEV only)', () => {
    act(() => {
      setExperienceWorldOverride('world.halloween')
    })
    const { result } = renderHook(() => useExperienceWorld())
    expect(result.current.worldId).toBe('world.halloween')
    expect(result.current.isPreviewOverride).toBe(true)
  })

  it('clearing the preview override restores the resolved world', () => {
    act(() => {
      setExperienceWorldOverride('world.eid')
    })
    const { result, rerender } = renderHook(() => useExperienceWorld())
    expect(result.current.worldId).toBe('world.eid')
    act(() => {
      resetExperienceWorldOverride()
    })
    rerender()
    expect(result.current.worldId).toBe('world.normal')
    expect(result.current.isPreviewOverride).toBe(false)
  })

  it('the hook does NOT return Adventure data (Surge / Mystery / Comeback are independent)', () => {
    // The brief: "If today's true Adventure state is Surge / Mystery /
    // Comeback, that remains the Adventure. Seasonal context belongs
    // to world + mascot."
    const { result } = renderHook(() => useExperienceWorld())
    const keys = Object.keys(result.current)
    // The hook contract is intentionally tiny: world, worldId,
    // seasonalLine, isPreviewOverride. No surge, no mystery, no
    // comeback.
    for (const forbidden of ['surge', 'mystery', 'comeback', 'adventure']) {
      expect(keys).not.toContain(forbidden)
    }
  })
})
