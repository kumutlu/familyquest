import { describe, expect, it } from 'vitest'
import type { DailyEligibilitySnapshotV1, TaskCompletionStatus, TaskGamificationEffectV1 } from './types'
import {
  addFamilyDays,
  calculateDailyProgress,
  familyDayKey,
  type DailyProgressCompletionEffectV1,
} from './dailyProgress'

const timestamp = Date.UTC(2026, 6, 22, 12)
const familyId = 'family-1'
const childId = 'child-1'
const dayKey = '2026-07-22'
const timezone = 'Europe/London'

function snapshot(
  taskWeights: Record<string, number>,
  overrides: Partial<DailyEligibilitySnapshotV1> = {},
): DailyEligibilitySnapshotV1 {
  return {
    schemaVersion: 1,
    familyId,
    childId,
    dayKey,
    timezone,
    dailyGoalPercentage: 80,
    taskWeights,
    eligibleTaskCount: Object.keys(taskWeights).length,
    eligiblePoints: Object.values(taskWeights).reduce((total, weight) => total + weight, 0),
    effectiveAt: timestamp,
    causalGroupId: 'gamification_transition_v1|eligibility',
    transitionRank: 0,
    createdAt: timestamp,
    createdBy: 'gamification-engine-v1',
    ...overrides,
  }
}

function completionEffect(
  taskId: string,
  dailyWeight: number,
  overrides: Partial<TaskGamificationEffectV1> & {
    readonly completionId?: string
    readonly status?: TaskCompletionStatus
  } = {},
): DailyProgressCompletionEffectV1 {
  const { completionId = `completion-${taskId}`, status = 'approved', ...effectOverrides } = overrides
  return {
    completionId,
    status,
    effect: {
      schemaVersion: 1,
      familyId,
      childId,
      taskId,
      logicalCompletionKey: `task_v1|${childId}|${taskId}|day:${dayKey}`,
      periodKey: `day:${dayKey}`,
      dayKey,
      timezone,
      pointsReward: dailyWeight,
      xpAward: dailyWeight,
      rewardPointsAward: dailyWeight,
      dailyWeight,
      requiresApproval: false,
      approvedAt: timestamp,
      ...effectOverrides,
    },
  }
}

function progressFor({
  taskWeights,
  effects = [],
  invalidatedLogicalCompletionKeys = [],
  dailyGoalPercentage = 80,
}: {
  readonly taskWeights: Record<string, number>
  readonly effects?: readonly DailyProgressCompletionEffectV1[]
  readonly invalidatedLogicalCompletionKeys?: readonly string[]
  readonly dailyGoalPercentage?: number
}) {
  const eligibilitySnapshot = snapshot(taskWeights, { dailyGoalPercentage })
  return calculateDailyProgress({
    eligibilitySnapshot,
    eligibilitySnapshotId: `${childId}:${dayKey}`,
    completionEffects: effects,
    invalidatedLogicalCompletionKeys,
    finalized: false,
    calculatedAt: timestamp,
  })
}

describe('family-local calendar helpers', () => {
  it('uses London local dates across winter, summer, and both 2026 DST transitions', () => {
    expect(familyDayKey(Date.UTC(2025, 11, 31, 23, 59, 59), 'Europe/London')).toBe('2025-12-31')
    expect(familyDayKey(Date.UTC(2026, 0, 1), 'Europe/London')).toBe('2026-01-01')
    expect(familyDayKey(Date.UTC(2026, 6, 1, 23, 59, 59), 'Europe/London')).toBe('2026-07-02')
    expect(familyDayKey(Date.UTC(2026, 2, 29, 0, 59, 59), 'Europe/London')).toBe('2026-03-29')
    expect(familyDayKey(Date.UTC(2026, 2, 29, 1), 'Europe/London')).toBe('2026-03-29')
    expect(familyDayKey(Date.UTC(2026, 9, 25, 0, 59, 59), 'Europe/London')).toBe('2026-10-25')
    expect(familyDayKey(Date.UTC(2026, 9, 25, 1), 'Europe/London')).toBe('2026-10-25')
  })

  it('uses the family timezone rather than UTC or the browser timezone', () => {
    const instant = Date.UTC(2025, 11, 31, 21, 30)

    expect(familyDayKey(instant, 'Europe/London')).toBe('2025-12-31')
    expect(familyDayKey(instant, 'Europe/Istanbul')).toBe('2026-01-01')
  })

  it('falls back to London for missing or invalid legacy timezones', () => {
    const instant = Date.UTC(2026, 6, 1, 23, 30)

    expect(familyDayKey(instant, undefined)).toBe('2026-07-02')
    expect(familyDayKey(instant, 'Not/A-Timezone')).toBe('2026-07-02')
  })

  it('moves Gregorian family days without a DST hour shift', () => {
    expect(addFamilyDays('2026-03-29', 1)).toBe('2026-03-30')
    expect(addFamilyDays('2026-10-25', 1)).toBe('2026-10-26')
    expect(addFamilyDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('calculateDailyProgress', () => {
  it('uses immutable snapshot weights for weighted progress and integer thresholds', () => {
    expect(progressFor({
      taskWeights: { a: 10, b: 30 },
      effects: [completionEffect('b', 30)],
    })).toMatchObject({
      eligiblePoints: 40,
      approvedPoints: 30,
      progressPercentage: 75,
      dailyGoalReached: false,
      perfectDayReached: false,
    })

    expect(progressFor({
      taskWeights: { a: 10, b: 30 },
      effects: [completionEffect('a', 10), completionEffect('b', 30)],
    })).toMatchObject({
      approvedPoints: 40,
      dailyGoalReached: true,
      perfectDayReached: true,
    })
  })

  it('keeps an all-zero immutable denominator neutral', () => {
    expect(progressFor({
      taskWeights: { zero: 0 },
      effects: [completionEffect('zero', 0)],
    })).toMatchObject({
      eligiblePoints: 0,
      approvedPoints: 0,
      progressPercentage: 0,
      dailyGoalReached: false,
      perfectDayReached: false,
    })
  })

  it('caps every logical task contribution independently instead of globally clamping', () => {
    expect(progressFor({
      taskWeights: { a: 10, b: 30 },
      effects: [completionEffect('a', 999), completionEffect('b', 30)],
    })).toMatchObject({
      eligiblePoints: 40,
      approvedPoints: 40,
      dailyGoalReached: true,
      perfectDayReached: true,
    })
  })

  it('caps one overweight valid effect at its frozen task weight', () => {
    expect(progressFor({
      taskWeights: { task: 20 },
      effects: [completionEffect('task', 999)],
    })).toMatchObject({
      eligiblePoints: 20,
      approvedPoints: 20,
      approvedTaskCount: 1,
      progressPercentage: 100,
    })
  })

  it('treats manual and auto-approved frozen effects identically', () => {
    const autoApproved = progressFor({
      taskWeights: { task: 20 },
      effects: [completionEffect('task', 20, { requiresApproval: false })],
    })
    const manuallyApproved = progressFor({
      taskWeights: { task: 20 },
      effects: [completionEffect('task', 20, { requiresApproval: true })],
    })

    expect(manuallyApproved).toMatchObject(autoApproved)
  })

  it.each<TaskCompletionStatus>([
    'pending_approval', 'rejected', 'cancelled', 'invalidated',
  ])('excludes %s effects', (status) => {
    expect(progressFor({
      taskWeights: { task: 20 },
      effects: [completionEffect('task', 20, { status })],
    })).toMatchObject({ approvedPoints: 0, approvedTaskCount: 0 })
  })

  it('excludes an approved effect reversed by an immutable invalidation fact', () => {
    const effect = completionEffect('task', 20)

    expect(progressFor({
      taskWeights: { task: 20 },
      effects: [effect],
      invalidatedLogicalCompletionKeys: [effect.effect.logicalCompletionKey],
    })).toMatchObject({
      approvedPoints: 0,
      approvedTaskCount: 0,
      contributingLogicalCompletionKeys: [],
      invalidatedLogicalCompletionKeys: [effect.effect.logicalCompletionKey],
    })
  })

  it('excludes malformed frozen effects without borrowing mutable task values', () => {
    expect(progressFor({
      taskWeights: { task: 20 },
      effects: [completionEffect('task', Number.NaN)],
    })).toMatchObject({ approvedPoints: 0, approvedTaskCount: 0 })
  })

  it('deduplicates retried completion documents by logical completion key', () => {
    const first = completionEffect('task', 20, { completionId: 'completion-a' })
    const retry = completionEffect('task', 20, { completionId: 'completion-b' })

    expect(progressFor({ taskWeights: { task: 20 }, effects: [first, retry] })).toMatchObject({
      approvedPoints: 20,
      approvedTaskCount: 1,
      contributingLogicalCompletionKeys: [first.effect.logicalCompletionKey],
    })
  })

  it('accepts only the canonical task_v1 child, task, and period identity', () => {
    const effect = completionEffect('task', 20)

    expect(progressFor({ taskWeights: { task: 20 }, effects: [effect] })).toMatchObject({
      approvedPoints: 20,
      approvedTaskCount: 1,
    })
    expect(progressFor({
      taskWeights: { task: 20 },
      effects: [completionEffect('task', 20, {
        logicalCompletionKey: `task_v1|${childId}|task|day:other-day`,
      })],
    })).toMatchObject({ approvedPoints: 0, approvedTaskCount: 0 })
  })

  it.each([
    `task_v1|other-child|task|day:${dayKey}`,
    `task_v1|${childId}|other-task|day:${dayKey}`,
    `task_v1|${childId}|task|day:${dayKey}|extra`,
    `task_v1|${childId}|task/with-slash|day:${dayKey}`,
  ])('excludes a logical key with mismatched or delimiter-invalid components: %s', (logicalCompletionKey) => {
    expect(progressFor({
      taskWeights: { task: 20 },
      effects: [completionEffect('task', 20, { logicalCompletionKey })],
    })).toMatchObject({ approvedPoints: 0, approvedTaskCount: 0 })
  })

  it('does not let two arbitrary logical keys double-credit one frozen task', () => {
    expect(progressFor({
      taskWeights: { task: 20 },
      effects: [
        completionEffect('task', 20, { completionId: 'completion-a', logicalCompletionKey: 'arbitrary-a' }),
        completionEffect('task', 20, { completionId: 'completion-b', logicalCompletionKey: 'arbitrary-b' }),
      ],
    })).toMatchObject({
      eligiblePoints: 20,
      approvedPoints: 0,
      approvedTaskCount: 0,
      progressPercentage: 0,
    })
  })

  it('fails closed for two canonical logical occurrences of one frozen task', () => {
    expect(() => progressFor({
      taskWeights: { task: 20 },
      effects: [
        completionEffect('task', 20, { completionId: 'completion-a' }),
        completionEffect('task', 20, {
          completionId: 'completion-b',
          periodKey: 'week:2026-W30',
          logicalCompletionKey: `task_v1|${childId}|task|week:2026-W30`,
        }),
      ],
    })).toThrow(/integrity/i)
  })

  it('fails closed when logical retries disagree on their immutable snapshot', () => {
    const first = completionEffect('task', 20, { completionId: 'completion-a' })
    const conflict = completionEffect('task', 19, { completionId: 'completion-b' })

    expect(() => progressFor({ taskWeights: { task: 20 }, effects: [first, conflict] })).toThrow(/integrity/i)
  })
})
