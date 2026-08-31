/**
 * RED tests for `useDailyEngagement` — the read-only hook that wires
 * the existing Zustand store + Experience Theme into the
 * `resolveDailyEngagement` resolver.
 *
 * The hook is the ONLY place that turns engagement inputs into a
 * `ResolvedDailyEngagement` value. Components consume the hook result;
 * they never call the resolver directly so precedence cannot drift.
 *
 * No write paths. No Firestore rules changes. No Firestore queries.
 * The hook composes from existing store snapshots that the existing
 * bootstrap layer already keeps fresh.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'

import { useDailyEngagement } from './useDailyEngagement'
import type { EventDefinition } from '../domain/experience/types'

const NOW = Date.UTC(2026, 5, 1, 17, 30, 0)

function activeSurge(
  id: string,
  amount: number,
  ids: string[],
  window: { startsAt: number; endsAt: number },
) {
  return {
    surgeId: id,
    surge: {
      kind: 'task_bonus' as const,
      eligibleTaskIds: ids,
      reward: { type: 'bonus_points' as const, amount },
    },
    window,
  }
}

const T1 = {
  id: 't1',
  title: 'House Vacuum',
  pointsReward: 15,
  assigneeId: 'child-A',
  isCompleted: false,
}

afterEach(() => cleanup())

describe('useDailyEngagement — composes from store inputs', () => {
  it('returns a Surge primaryOpportunity when an active Surge matches a child task', async () => {
    const hook = renderHook(() =>
      useDailyEngagement({
        now: NOW,
        activeSurges: [activeSurge('s1', 10, ['t1'], { startsAt: NOW - 60_000, endsAt: NOW + 60_000 })],
        availableTasks: [T1],
        familyPreferences: { surgeHours: true },
        viewingChildId: 'child-A',
      }),
    )
    const value = hook.result.current
    expect(value.primaryOpportunity?.kind).toBe('surge')
  })

  it('skips Surge when surgeHours is disabled', () => {
    const hook = renderHook(() =>
      useDailyEngagement({
        now: NOW,
        activeSurges: [activeSurge('s1', 10, ['t1'], { startsAt: NOW - 60_000, endsAt: NOW + 60_000 })],
        availableTasks: [T1],
        familyPreferences: { surgeHours: false },
        viewingChildId: 'child-A',
      }),
    )
    const opp = hook.result.current.primaryOpportunity
    expect(opp?.kind === 'surge').toBe(false)
  })

  it('memoises on the same inputs', () => {
    const inputs = {
      now: NOW,
      activeSurges: [] as ReturnType<typeof activeSurge>[],
      availableTasks: [] as typeof T1[],
      familyPreferences: { surgeHours: true },
    }
    const hook = renderHook(() => useDailyEngagement(inputs))
    const a = hook.result.current
    const b = hook.result.current
    expect(a).toBe(b)
  })
})

describe('useDailyEngagement — falls through to seasonal when no Surge', () => {
  it('returns seasonal opportunity when an active event is present', () => {
    const event: EventDefinition = {
      id: 'evt-xmas',
      type: 'seasonal',
      name: 'Christmas',
      startsAt: NOW - 1000,
      endsAt: NOW + 60_000,
      status: 'active',
    }
    const hook = renderHook(() =>
      useDailyEngagement({
        now: NOW,
        activeSurges: [],
        availableTasks: [],
        familyPreferences: { surgeHours: true },
        activeEvent: event,
      }),
    )
    expect(hook.result.current.primaryOpportunity?.kind).toBe('seasonal')
  })
})