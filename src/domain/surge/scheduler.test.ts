/**
 * RED tests for the Surge scheduler.
 *
 * The scheduler decides whether to emit a Surge now, applying anti-gaming
 * constraints (per-day quota, per-week quota, minimum gap). It MUST be
 * deterministic — same inputs ⇒ same outputs — and MUST NOT use
 * `Math.random()` anywhere (UI tests rely on a fixed seed).
 */
import { describe, expect, it } from 'vitest'

import { DEFAULT_SURGE_SCHEDULER_LIMITS, decideSurgeEmission } from './scheduler'
import type { SurgeEligibilityDefinition } from './types'

const FIXED_NOW = Date.UTC(2026, 5, 1, 10, 0, 0) // 2026-06-01 10:00 UTC

function surge(amount: number, ids: string[]): SurgeEligibilityDefinition {
  return {
    kind: 'task_bonus',
    eligibleTaskIds: ids,
    reward: { type: 'bonus_points', amount },
  }
}

function decision(overrides: Partial<Parameters<typeof decideSurgeEmission>[0]> = {}) {
  return decideSurgeEmission({
    seed: 'family-X',
    now: FIXED_NOW,
    todaysSurges: 0,
    weeksSurges: 0,
    lastSurgeEndedAt: null,
    familyPreferences: { surgeHours: true },
    candidate: surge(10, ['t1']),
    candidateWindow: {
      startsAt: FIXED_NOW,
      endsAt: FIXED_NOW + 60 * 60 * 1000,
    },
    ...overrides,
  })
}

describe('decideSurgeEmission — family opt-in', () => {
  it('refuses to emit when surgeHours preference is false', () => {
    const result = decision({ familyPreferences: { surgeHours: false } })
    expect(result.mayEmit).toBe(false)
    expect(result.reason).toBe('preference_disabled')
  })
})

describe('decideSurgeEmission — quota enforcement', () => {
  it('refuses to emit when daily quota is exhausted', () => {
    const result = decision({ todaysSurges: DEFAULT_SURGE_SCHEDULER_LIMITS.maxSurgesPerDay })
    expect(result.mayEmit).toBe(false)
    expect(result.reason).toBe('daily_quota_exhausted')
  })

  it('refuses to emit when weekly quota is exhausted', () => {
    const result = decision({ weeksSurges: DEFAULT_SURGE_SCHEDULER_LIMITS.maxSurgesPerWeek })
    expect(result.mayEmit).toBe(false)
    expect(result.reason).toBe('weekly_quota_exhausted')
  })

  it('allows emission when both quotas are within bounds', () => {
    const result = decision({ todaysSurges: 1, weeksSurges: 3 })
    expect(result.mayEmit).toBe(true)
  })
})

describe('decideSurgeEmission — minimum gap', () => {
  it('refuses to emit when last Surge ended less than the minimum gap ago', () => {
    const result = decision({
      lastSurgeEndedAt: FIXED_NOW - 30 * 60 * 1000, // 30 minutes ago
    })
    expect(result.mayEmit).toBe(false)
    expect(result.reason).toBe('gap_too_short')
  })

  it('allows emission when the last Surge ended exactly the minimum gap ago', () => {
    const result = decision({
      lastSurgeEndedAt:
        FIXED_NOW - DEFAULT_SURGE_SCHEDULER_LIMITS.minimumGapBetweenSurges,
    })
    expect(result.mayEmit).toBe(true)
  })

  it('allows emission when no previous Surge exists', () => {
    const result = decision({ lastSurgeEndedAt: null })
    expect(result.mayEmit).toBe(true)
  })
})

describe('decideSurgeEmission — deterministic output', () => {
  it('returns identical decisions for identical inputs', () => {
    const a = decision({ seed: 'family-A', todaysSurges: 1 })
    const b = decision({ seed: 'family-A', todaysSurges: 1 })
    expect(a).toEqual(b)
  })

  it('narrows to a single task id deterministically per seed', () => {
    const ids = ['task-house', 'task-yard', 'task-cat', 'task-read', 'task-draw']
    const a = decision({ seed: 'family-A', candidate: surge(10, ids) })
    const b = decision({ seed: 'family-B', candidate: surge(10, ids) })
    expect(a.mayEmit).toBe(true)
    expect(b.mayEmit).toBe(true)
    // Both narrows are length-1.
    expect(a.candidateSurge?.eligibleTaskIds.length).toBe(1)
    expect(b.candidateSurge?.eligibleTaskIds.length).toBe(1)
    // Same seed ⇒ same selection across runs.
    const a2 = decision({ seed: 'family-A', candidate: surge(10, ids) })
    expect(a2.candidateSurge?.eligibleTaskIds).toEqual(a.candidateSurge?.eligibleTaskIds)
  })
})

describe('decideSurgeEmission — task id selection', () => {
  it('selects an eligible task id from the candidate list', () => {
    const result = decision({
      seed: 'family-X',
      candidate: surge(10, ['task-house', 'task-yard', 'task-cat']),
      candidateWindow: { startsAt: FIXED_NOW, endsAt: FIXED_NOW + 60 * 60 * 1000 },
    })
    expect(result.mayEmit).toBe(true)
    expect(result.candidateSurge?.eligibleTaskIds.length).toBeGreaterThan(0)
  })

  it('rejects when candidate eligibleTaskIds is empty', () => {
    const result = decision({ candidate: surge(10, []) })
    expect(result.mayEmit).toBe(false)
    expect(result.reason).toBe('seed_selected_none')
  })
})

describe('decideSurgeEmission — defensive defaults', () => {
  it('rejects malformed window', () => {
    const result = decision({
      candidateWindow: { startsAt: FIXED_NOW, endsAt: FIXED_NOW - 1 },
    })
    expect(result.mayEmit).toBe(false)
  })

  it('rejects malformed clock', () => {
    const result = decision({ now: Number.NaN })
    expect(result.mayEmit).toBe(false)
  })

  it('rejects when candidate reward is xp_multiplier', () => {
    const result = decision({
      candidate: {
        kind: 'task_bonus',
        eligibleTaskIds: ['t1'],
        reward: { type: 'xp_multiplier', multiplier: 2 },
      },
    })
    expect(result.mayEmit).toBe(false)
    expect(result.reason).toBe('seed_selected_none')
  })
})

describe('DEFAULT_SURGE_SCHEDULER_LIMITS — frozen contract', () => {
  it('exposes stable defaults that the design pins', () => {
    expect(DEFAULT_SURGE_SCHEDULER_LIMITS.maxSurgesPerDay).toBe(3)
    expect(DEFAULT_SURGE_SCHEDULER_LIMITS.maxSurgesPerWeek).toBe(12)
    expect(DEFAULT_SURGE_SCHEDULER_LIMITS.minimumGapBetweenSurges).toBe(90 * 60 * 1000)
  })
})