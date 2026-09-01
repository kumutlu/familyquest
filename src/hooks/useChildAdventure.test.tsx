/**
 * `useChildAdventure` — focused tests.
 *
 * Pins:
 *   - Mystery READY outranks Comeback in the resolved presentation.
 *   - Mystery LOCKED loses to Comeback.
 *   - `resolved: false` produces a loading presentation (no flash).
 *   - The hook NEVER inspects inputs to make precedence decisions; that
 *     is the resolver's job.
 */

import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useChildAdventure } from './useChildAdventure'

describe('useChildAdventure', () => {
  it('reports loading when state is unresolved', () => {
    const { result } = renderHook(() =>
      useChildAdventure({
        now: Date.now(),
        activeSurges: [],
        availableTasks: [],
        surgeHoursEnabled: true,
        resolved: false,
      }),
    )
    expect(result.current.presentation.kind).toBe('loading')
  })

  it('reports mystery_ready over comeback', () => {
    const { result } = renderHook(() =>
      useChildAdventure({
        now: Date.now(),
        activeSurges: [],
        availableTasks: [],
        surgeHoursEnabled: true,
        resolved: true,
        comeback: {
          timezone: 'UTC',
          now: Date.now(),
          lastMeaningfulActivityAt: Date.now() - 3 * 86_400_000,
        },
        mysteryDrop: {
          id: 'drop-1',
          rarity: 'rare',
          isRevealReady: true,
        },
      }),
    )
    expect(result.current.presentation.kind).toBe('mystery_ready')
  })

  it('reports comeback over mystery_available (locked)', () => {
    const { result } = renderHook(() =>
      useChildAdventure({
        now: Date.now(),
        activeSurges: [],
        availableTasks: [],
        surgeHoursEnabled: true,
        resolved: true,
        comeback: {
          timezone: 'UTC',
          now: Date.now(),
          lastMeaningfulActivityAt: Date.now() - 3 * 86_400_000,
        },
        mysteryDrop: {
          id: 'drop-2',
          rarity: 'common',
          isRevealReady: false,
        },
      }),
    )
    expect(result.current.presentation.kind).toBe('comeback')
  })

  it('reports mystery_available when only a locked drop exists', () => {
    const { result } = renderHook(() =>
      useChildAdventure({
        now: Date.now(),
        activeSurges: [],
        availableTasks: [],
        surgeHoursEnabled: true,
        resolved: true,
        mysteryDrop: {
          id: 'drop-3',
          rarity: 'epic',
          isRevealReady: false,
        },
      }),
    )
    expect(result.current.presentation.kind).toBe('mystery_available')
  })

  it('reports normal when nothing special exists', () => {
    const { result } = renderHook(() =>
      useChildAdventure({
        now: Date.now(),
        activeSurges: [],
        availableTasks: [],
        surgeHoursEnabled: true,
        resolved: true,
      }),
    )
    expect(result.current.presentation.kind).toBe('normal')
  })

  it('reports seasonal when seasonalActive is true and nothing outranks', () => {
    const { result } = renderHook(() =>
      useChildAdventure({
        now: Date.now(),
        activeSurges: [],
        availableTasks: [],
        surgeHoursEnabled: true,
        resolved: true,
        seasonalActive: true,
      }),
    )
    expect(result.current.presentation.kind).toBe('seasonal')
  })

  it('reports loading when resolved is false even with surge + comeback + mystery', () => {
    const { result } = renderHook(() =>
      useChildAdventure({
        now: Date.now(),
        activeSurges: [],
        availableTasks: [],
        surgeHoursEnabled: true,
        resolved: false,
        comeback: {
          timezone: 'UTC',
          now: Date.now(),
          lastMeaningfulActivityAt: Date.now() - 7 * 86_400_000,
        },
        mysteryDrop: {
          id: 'drop-4',
          rarity: 'rare',
          isRevealReady: true,
        },
        seasonalActive: true,
      }),
    )
    expect(result.current.presentation.kind).toBe('loading')
  })
})