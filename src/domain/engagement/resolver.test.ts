/**
 * RED tests for the Daily Engagement resolver.
 *
 * The resolver decides what the child should see RIGHT NOW. It does NOT
 * award anything. It composes:
 *   - Active Surges (read-only)
 *   - Available tasks
 *   - Active event (from the Experience Engine)
 *   - Family opt-in (engagementPreferences.surgeHours)
 *
 * Precedence (top wins):
 *   1. Surge ending soon (< 10 min)
 *   2. Surge active
 *   3. Streak at risk (carry-over)
 *   4. Seasonal event
 *   5. Default (no primary opportunity)
 *
 * The presentation is consumed by the UI and by the mascot's engagement
 * context, never the other way around.
 */
import { describe, expect, it } from 'vitest'

import { resolveDailyEngagement } from './resolver'
import type { SurgeEligibilityDefinition } from '../surge/types'

const NOW = Date.UTC(2026, 5, 1, 17, 30, 0)

function surge(
  amount: number,
  ids: string[],
  window: { startsAt: number; endsAt: number },
): { surge: SurgeEligibilityDefinition; window: { startsAt: number; endsAt: number } } {
  return {
    surge: { kind: 'task_bonus', eligibleTaskIds: ids, reward: { type: 'bonus_points', amount } },
    window,
  }
}

function task(id: string, title: string, opts: { assigneeId: string | null; isCompleted?: boolean; pointsReward?: number } = { assigneeId: null }) {
  return {
    id,
    title,
    pointsReward: opts.pointsReward ?? 10,
    assigneeId: opts.assigneeId,
    isCompleted: opts.isCompleted ?? false,
  }
}

describe('resolveDailyEngagement — Surge preference gate', () => {
  it('returns no Surge when surgeHours is disabled', () => {
    const result = resolveDailyEngagement({
      now: NOW,
      activeSurges: [
        {
          ...surge(10, ['t1'], { startsAt: NOW - 1000, endsAt: NOW + 60_000 }),
          surgeId: 'surge-1',
        },
      ],
      availableTasks: [task('t1', 'House Vacuum', { assigneeId: 'child-A' })],
      familyPreferences: { surgeHours: false },
    })
    expect(result.primaryOpportunity?.kind).not.toBe('surge')
  })
})

describe('resolveDailyEngagement — Surge precedence', () => {
  it('promotes ending-soon Surge above everything else', () => {
    const result = resolveDailyEngagement({
      now: NOW,
      activeSurges: [
        {
          ...surge(10, ['t1'], { startsAt: NOW - 60_000, endsAt: NOW + 5 * 60_000 }),
          surgeId: 'surge-ending',
        },
      ],
      availableTasks: [task('t1', 'Vacuum', { assigneeId: 'child-A' })],
      familyPreferences: { surgeHours: true },
    })
    expect(result.primaryOpportunity?.kind).toBe('surge')
    expect(result.urgency).toBe('ending')
  })

  it('keeps regular Surge when not ending soon', () => {
    const result = resolveDailyEngagement({
      now: NOW,
      activeSurges: [
        {
          ...surge(10, ['t1'], { startsAt: NOW - 60_000, endsAt: NOW + 60 * 60_000 }),
          surgeId: 'surge-long',
        },
      ],
      availableTasks: [task('t1', 'Vacuum', { assigneeId: 'child-A' })],
      familyPreferences: { surgeHours: true },
    })
    expect(result.primaryOpportunity?.kind).toBe('surge')
    expect(result.urgency).toBe('normal')
  })

  it('filters out Surges whose window has already ended', () => {
    const result = resolveDailyEngagement({
      now: NOW,
      activeSurges: [
        {
          ...surge(10, ['t1'], { startsAt: NOW - 60 * 60_000, endsAt: NOW - 1000 }),
          surgeId: 'surge-stale',
        },
      ],
      availableTasks: [task('t1', 'Vacuum', { assigneeId: 'child-A' })],
      familyPreferences: { surgeHours: true },
    })
    expect(result.primaryOpportunity?.kind).not.toBe('surge')
  })
})

describe('resolveDailyEngagement — task filtering', () => {
  it('only lists Surge eligible tasks assigned to or unassigned for the child', () => {
    const result = resolveDailyEngagement({
      now: NOW,
      activeSurges: [
        {
          ...surge(10, ['t1', 't2', 't3'], { startsAt: NOW - 1000, endsAt: NOW + 60_000 }),
          surgeId: 'surge-1',
        },
      ],
      availableTasks: [
        task('t1', 'Yours', { assigneeId: 'child-A' }),
        task('t2', 'Sibling', { assigneeId: 'child-B' }),
        task('t3', 'Family', { assigneeId: null }),
      ],
      familyPreferences: { surgeHours: true },
      viewingChildId: 'child-A',
    })
    const opp = result.primaryOpportunity
    expect(opp?.kind).toBe('surge')
    if (opp?.kind === 'surge') {
      const eligibleIds = opp.eligibleTasks.map(t => t.id)
      expect(eligibleIds).toContain('t1')
      expect(eligibleIds).toContain('t3')
      expect(eligibleIds).not.toContain('t2')
    }
  })

  it('filters out already-completed Surge tasks', () => {
    const result = resolveDailyEngagement({
      now: NOW,
      activeSurges: [
        {
          ...surge(10, ['t1'], { startsAt: NOW - 1000, endsAt: NOW + 60_000 }),
          surgeId: 'surge-1',
        },
      ],
      availableTasks: [
        task('t1', 'Done already', { assigneeId: 'child-A', isCompleted: true }),
      ],
      familyPreferences: { surgeHours: true },
      viewingChildId: 'child-A',
    })
    const opp = result.primaryOpportunity
    if (opp?.kind === 'surge') {
      expect(opp.eligibleTasks).toHaveLength(0)
    }
  })
})

describe('resolveDailyEngagement — fallback hierarchy', () => {
  it('falls back to seasonal when no Surge is present', () => {
    const result = resolveDailyEngagement({
      now: NOW,
      activeSurges: [],
      availableTasks: [task('t1', 'Vacuum', { assigneeId: 'child-A' })],
      familyPreferences: { surgeHours: true },
      activeEvent: {
        id: 'evt-xmas',
        type: 'seasonal',
        name: 'Christmas',
        startsAt: NOW - 1000,
        endsAt: NOW + 60_000,
        status: 'active',
      },
    })
    expect(result.primaryOpportunity?.kind).toBe('seasonal')
  })

  it('falls back to streak at risk when neither Surge nor event is active', () => {
    const result = resolveDailyEngagement({
      now: NOW,
      activeSurges: [],
      availableTasks: [task('t1', 'Vacuum', { assigneeId: 'child-A' })],
      familyPreferences: { surgeHours: true },
      currentStreak: 4,
      questsRemaining: 2,
      questsCompletedToday: 0,
    })
    expect(result.primaryOpportunity?.kind).toBe('streak')
  })

  it('returns no primaryOpportunity when everything is empty', () => {
    const result = resolveDailyEngagement({
      now: NOW,
      activeSurges: [],
      availableTasks: [],
      familyPreferences: { surgeHours: true },
    })
    expect(result.primaryOpportunity).toBeUndefined()
    expect(result.urgency).toBe('normal')
  })
})

describe('resolveDailyEngagement — defensive defaults', () => {
  it('handles malformed activeSurges array', () => {
    const result = resolveDailyEngagement({
      now: NOW,
      activeSurges: null as unknown as [],
      availableTasks: [],
      familyPreferences: { surgeHours: true },
    })
    expect(result.primaryOpportunity).toBeUndefined()
  })

  it('handles malformed clock', () => {
    const result = resolveDailyEngagement({
      now: Number.NaN,
      activeSurges: [],
      availableTasks: [],
      familyPreferences: { surgeHours: true },
    })
    expect(result.primaryOpportunity).toBeUndefined()
  })
})