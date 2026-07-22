import { describe, expect, it } from 'vitest'
import type { DailyEligibilitySnapshotV1, GamificationEventV1 } from './types'
import { calculateStreak, compareCodeUnits, type GamificationEventDocumentV1 } from './streak'

const familyId = 'family-1'
const childId = 'child-1'
const monday = '2026-07-20'
const tuesday = '2026-07-21'
const wednesday = '2026-07-22'

function eligibility(dayKey: string, eligiblePoints = 10): DailyEligibilitySnapshotV1 {
  return {
    schemaVersion: 1, familyId, childId, dayKey, timezone: 'Europe/London', dailyGoalPercentage: 80,
    taskWeights: eligiblePoints === 0 ? { zero: 0 } : { task: eligiblePoints }, eligibleTaskCount: 1,
    eligiblePoints, effectiveAt: Date.UTC(2026, 6, Number(dayKey.slice(-2)), 1),
    causalGroupId: `eligibility:${dayKey}`, transitionRank: 0, createdAt: 0, createdBy: 'gamification-engine-v1',
  }
}

function qualification(
  dayKey: string,
  qualificationState: 'qualified' | 'unqualified',
  sourceTransitionId: string,
  effectiveAt: number,
  transitionRank = 2,
): GamificationEventDocumentV1 {
  const causalGroupId = `gamification_transition_v1|${sourceTransitionId}`
  return {
    id: `daily_goal_qualification:${familyId}:${childId}:${dayKey}:${sourceTransitionId}`,
    event: {
      schemaVersion: 1, familyId, childId, eventType: 'daily_goal_qualification_changed', xpDelta: 0,
      sourceType: 'daily_progress', sourceId: sourceTransitionId,
      idempotencyKey: `daily_goal_qualification:${familyId}:${childId}:${dayKey}:${sourceTransitionId}`,
      dayKey, timezone: 'Europe/London', sourceTransitionId, qualificationState, causalGroupId,
      effectiveAt, transitionRank, configSchemaVersion: 1, createdBy: 'gamification-engine-v1', createdAt: effectiveAt,
    },
  }
}

function thresholdEvent(
  id: string,
  overrides: Partial<GamificationEventV1>,
): GamificationEventDocumentV1 {
  const sourceTransitionId = overrides.sourceTransitionId ?? 'approval_v1|source'
  const effectiveAt = overrides.effectiveAt ?? 1
  return {
    id,
    event: {
      schemaVersion: 1, familyId, childId, eventType: 'daily_goal_awarded', xpDelta: 25,
      sourceType: 'daily_progress', sourceId: sourceTransitionId, idempotencyKey: id, dayKey: monday,
      timezone: 'Europe/London', sourceTransitionId, causalGroupId: `gamification_transition_v1|${sourceTransitionId}`,
      effectiveAt, transitionRank: 0, configSchemaVersion: 1, createdBy: 'gamification-engine-v1', createdAt: effectiveAt,
      ...overrides,
    },
  }
}

describe('calculateStreak', () => {
  it('is same-day idempotent and counts consecutive qualified days', () => {
    const mondayQualification = qualification(monday, 'qualified', 'approval_v1|monday', 1)
    const tuesdayQualification = qualification(tuesday, 'qualified', 'approval_v1|tuesday', 2)

    expect(calculateStreak({
      eligibilitySnapshots: [eligibility(monday), eligibility(tuesday)],
      events: [tuesdayQualification, mondayQualification, mondayQualification],
    })).toEqual({ currentStreak: 2, bestStreak: 2, lastQualifiedDayKey: tuesday })
  })

  it('uses immutable finalization facts to break an eligible missed day, but leaves an unfinalized day alone', () => {
    const mondayQualification = qualification(monday, 'qualified', 'approval_v1|monday', 1)
    const finalizedMiss = qualification(tuesday, 'unqualified', 'finalization_v1|child-1:2026-07-21', 2)

    expect(calculateStreak({
      eligibilitySnapshots: [eligibility(monday), eligibility(tuesday)],
      events: [mondayQualification, finalizedMiss],
    })).toMatchObject({ currentStreak: 0, bestStreak: 1, lastQualifiedDayKey: null })

    expect(calculateStreak({
      eligibilitySnapshots: [eligibility(monday), eligibility(tuesday)],
      events: [mondayQualification],
    })).toMatchObject({ currentStreak: 1, bestStreak: 1, lastQualifiedDayKey: monday })
  })

  it('bridges a finalized zero-work day without manufacturing credit', () => {
    expect(calculateStreak({
      eligibilitySnapshots: [eligibility(monday), eligibility(tuesday, 0), eligibility(wednesday)],
      events: [
        qualification(monday, 'qualified', 'approval_v1|monday', 1),
        qualification(wednesday, 'qualified', 'approval_v1|wednesday', 2),
      ],
    })).toEqual({ currentStreak: 2, bestStreak: 2, lastQualifiedDayKey: wednesday })
  })

  it('does not use a cache or clock: a late approval restores a finalized day and a later reversal removes it', () => {
    const finalizedMiss = qualification(monday, 'unqualified', 'finalization_v1|child-1:2026-07-20', 1)
    const lateApproval = qualification(monday, 'qualified', 'approval_v1|late', 2)
    const reversal = qualification(monday, 'unqualified', 'invalidation_v1|reversal-1', 3)

    expect(calculateStreak({ eligibilitySnapshots: [eligibility(monday)], events: [finalizedMiss, lateApproval] }))
      .toEqual({ currentStreak: 1, bestStreak: 1, lastQualifiedDayKey: monday })
    expect(calculateStreak({ eligibilitySnapshots: [eligibility(monday)], events: [finalizedMiss, lateApproval, reversal] }))
      .toEqual({ currentStreak: 0, bestStreak: 1, lastQualifiedDayKey: null })
  })

  it('observes qualification only after the complete causal group, so already-invalid award/revoke work is net-zero', () => {
    const source = 'approval_v1|already-invalid'
    const group = `gamification_transition_v1|${source}`
    const award = thresholdEvent('daily_goal:family-1:child-1:2026-07-20', { sourceTransitionId: source, causalGroupId: group, effectiveAt: 1, transitionRank: 0 })
    const revoke = thresholdEvent('daily_goal_reversal:family-1:child-1:2026-07-20', {
      eventType: 'daily_goal_revoked', xpDelta: -25, causalEventId: award.id, sourceTransitionId: source, causalGroupId: group,
      effectiveAt: 1, transitionRank: 1,
    })
    const qualified = qualification(monday, 'qualified', source, 1, 2)
    const unqualifiedSource = 'invalidation_v1|already-invalid'
    const unqualified = {
      ...qualification(monday, 'unqualified', unqualifiedSource, 1, 3),
      event: {
        ...qualification(monday, 'unqualified', unqualifiedSource, 1, 3).event,
        causalGroupId: group,
      },
    }

    expect(calculateStreak({ eligibilitySnapshots: [eligibility(monday)], events: [unqualified, revoke, qualified, award] }))
      .toEqual({ currentStreak: 0, bestStreak: 0, lastQualifiedDayKey: null })
  })

  it('rejects a nine-record causal group split across effective times before any partial group observation', () => {
    const group = 'gamification_transition_v1|split-oversized'
    const events = Array.from({ length: 9 }, (_, index) => {
      const document = qualification(monday, 'qualified', `approval_v1|split-${index}`, index < 4 ? 0 : 2)
      return { ...document, event: { ...document.event, causalGroupId: group } }
    })
    events.splice(4, 0, qualification(monday, 'unqualified', 'invalidation_v1|interleaving', 1))

    expect(() => calculateStreak({ eligibilitySnapshots: [eligibility(monday)], events })).toThrow(/effectiveAt/i)
  })

  it('uses canonical code-unit order for equal-time Unicode causal groups', () => {
    expect(compareCodeUnits('z', 'ä')).toBeLessThan(0)
    expect(calculateStreak({
      eligibilitySnapshots: [eligibility(monday)],
      events: [
        qualification(monday, 'qualified', 'z', 1),
        qualification(monday, 'unqualified', 'ä', 1),
      ],
    })).toEqual({ currentStreak: 0, bestStreak: 1, lastQualifiedDayKey: null })
  })

  it('preserves historical best without joining days that were never simultaneously qualified', () => {
    expect(calculateStreak({
      eligibilitySnapshots: [eligibility(monday), eligibility(tuesday)],
      events: [
        qualification(monday, 'qualified', 'approval_v1|monday', 1),
        qualification(monday, 'unqualified', 'invalidation_v1|monday', 2),
        qualification(tuesday, 'qualified', 'approval_v1|tuesday', 3),
      ],
    })).toEqual({ currentStreak: 1, bestStreak: 1, lastQualifiedDayKey: tuesday })
  })
})
