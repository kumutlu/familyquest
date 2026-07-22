import { describe, expect, it } from 'vitest'
import type { DailyProgressV1, GamificationEventV1 } from './types'
import {
  calculatePerfectDayCount,
  dailyGoalEventId,
  dailyGoalQualificationEventId,
  dailyGoalRevocationEventId,
  perfectDayEventId,
  perfectDayQualificationEventId,
  perfectDayRevocationEventId,
  planThresholdEvents,
  type ThresholdEventDocumentV1,
} from './perfectDay'

const familyId = 'family-1'
const childId = 'child-1'
const dayKey = '2026-07-22'
const timestamp = Date.UTC(2026, 6, 22, 12)

function progress(overrides: Partial<DailyProgressV1> = {}): DailyProgressV1 {
  return {
    schemaVersion: 1, familyId, childId, dayKey, timezone: 'Europe/London', eligibilitySnapshotId: 'child-1:2026-07-22',
    dailyGoalPercentage: 80, eligiblePoints: 100, approvedPoints: 100, eligibleTaskCount: 2, approvedTaskCount: 2,
    progressPercentage: 100, dailyGoalReached: true, perfectDayReached: true, finalized: false,
    contributingLogicalCompletionKeys: [], invalidatedLogicalCompletionKeys: [], calculatedAt: timestamp, ...overrides,
  }
}

function qualification(
  threshold: 'daily_goal' | 'perfect_day',
  state: 'qualified' | 'unqualified',
  sourceTransitionId: string,
  at: number,
): ThresholdEventDocumentV1 {
  const id = threshold === 'daily_goal'
    ? dailyGoalQualificationEventId(familyId, childId, dayKey, sourceTransitionId)
    : perfectDayQualificationEventId(familyId, childId, dayKey, sourceTransitionId)
  return {
    id,
    event: {
      schemaVersion: 1, familyId, childId, eventType: `${threshold}_qualification_changed`, xpDelta: 0,
      sourceType: 'daily_progress', sourceId: sourceTransitionId, idempotencyKey: id, dayKey, timezone: 'Europe/London',
      sourceTransitionId, qualificationState: state, causalGroupId: `gamification_transition_v1|${sourceTransitionId}`,
      effectiveAt: at, transitionRank: threshold === 'daily_goal' ? 2 : 5, configSchemaVersion: 1,
      createdBy: 'gamification-engine-v1', createdAt: at,
    },
  }
}

function bonus(id: string, event: Partial<GamificationEventV1>): ThresholdEventDocumentV1 {
  const sourceTransitionId = event.sourceTransitionId ?? 'approval_v1|monday'
  const effectiveAt = event.effectiveAt ?? 1
  return {
    id,
    event: {
      schemaVersion: 1, familyId, childId, eventType: 'perfect_day_awarded', xpDelta: 50,
      sourceType: 'daily_progress', sourceId: sourceTransitionId, idempotencyKey: id, dayKey, timezone: 'Europe/London',
      sourceTransitionId, causalGroupId: `gamification_transition_v1|${sourceTransitionId}`,
      effectiveAt, transitionRank: 3, configSchemaVersion: 1, createdBy: 'gamification-engine-v1', createdAt: effectiveAt,
      ...event,
    },
  }
}

describe('daily threshold event identities and plans', () => {
  it('plans both 100% bonuses and zero-XP qualified transitions with deterministic identities', () => {
    const sourceTransitionId = 'approval_v1|task_v1|child-1|task-1|day:2026-07-22'
    const events = planThresholdEvents({ progress: progress(), sourceTransitionId, effectiveAt: timestamp, existingEvents: [] })

    expect(events.map(({ id, event }) => [id, event.eventType, event.xpDelta, event.transitionRank])).toEqual([
      [dailyGoalEventId(familyId, childId, dayKey), 'daily_goal_awarded', 25, 0],
      [dailyGoalQualificationEventId(familyId, childId, dayKey, sourceTransitionId), 'daily_goal_qualification_changed', 0, 2],
      [perfectDayEventId(familyId, childId, dayKey), 'perfect_day_awarded', 50, 3],
      [perfectDayQualificationEventId(familyId, childId, dayKey, sourceTransitionId), 'perfect_day_qualification_changed', 0, 5],
    ])
    for (const { event } of events) {
      expect(event.causalGroupId).toBe(`gamification_transition_v1|${sourceTransitionId}`)
      expect(event.effectiveAt).toBe(timestamp)
      expect(event.sourceTransitionId).toBe(sourceTransitionId)
    }
  })

  it('emits deterministic zero-XP unqualified finalization transitions only for an eligible missed day', () => {
    const sourceTransitionId = 'finalization_v1|child-1:2026-07-22'
    expect(planThresholdEvents({
      progress: progress({ approvedPoints: 0, progressPercentage: 0, dailyGoalReached: false, perfectDayReached: false, finalized: true }),
      sourceTransitionId, effectiveAt: timestamp, existingEvents: [],
    }).map(({ id, event }) => [id, event.qualificationState, event.xpDelta])).toEqual([
      [dailyGoalQualificationEventId(familyId, childId, dayKey, sourceTransitionId), 'unqualified', 0],
      [perfectDayQualificationEventId(familyId, childId, dayKey, sourceTransitionId), 'unqualified', 0],
    ])
    expect(planThresholdEvents({
      progress: progress({ approvedPoints: 0, progressPercentage: 0, dailyGoalReached: false, perfectDayReached: false, finalized: false }),
      sourceTransitionId, effectiveAt: timestamp, existingEvents: [],
    })).toEqual([])
    expect(planThresholdEvents({
      progress: progress({ eligiblePoints: 0, approvedPoints: 0, dailyGoalReached: false, perfectDayReached: false, finalized: true }),
      sourceTransitionId, effectiveAt: timestamp, existingEvents: [],
    })).toEqual([])
  })

  it('uses compensation once, references its causal award, and makes same-day recovery qualification-only', () => {
    const approval = 'approval_v1|first'
    const initial = planThresholdEvents({ progress: progress(), sourceTransitionId: approval, effectiveAt: 1, existingEvents: [] })
    const reversal = 'invalidation_v1|reversal-1'
    const lost = planThresholdEvents({
      progress: progress({ approvedPoints: 0, progressPercentage: 0, dailyGoalReached: false, perfectDayReached: false, finalized: true }),
      sourceTransitionId: reversal, effectiveAt: 2, existingEvents: initial,
    })
    expect(lost.filter(({ event }) => event.xpDelta < 0).map(({ id, event }) => [id, event.causalEventId])).toEqual([
      [dailyGoalRevocationEventId(familyId, childId, dayKey), dailyGoalEventId(familyId, childId, dayKey)],
      [perfectDayRevocationEventId(familyId, childId, dayKey), perfectDayEventId(familyId, childId, dayKey)],
    ])
    const recovery = 'approval_v1|recovery'
    const restored = planThresholdEvents({ progress: progress(), sourceTransitionId: recovery, effectiveAt: 3, existingEvents: [...initial, ...lost] })
    expect(restored.map(({ id, event }) => [id, event.eventType, event.xpDelta])).toEqual([
      [dailyGoalQualificationEventId(familyId, childId, dayKey, recovery), 'daily_goal_qualification_changed', 0],
      [perfectDayQualificationEventId(familyId, childId, dayKey, recovery), 'perfect_day_qualification_changed', 0],
    ])
    expect(planThresholdEvents({ progress: progress(), sourceTransitionId: recovery, effectiveAt: 3, existingEvents: [...initial, ...lost, ...restored] })).toEqual([])
  })

  it('records every later loss/recovery with its own canonical source without awarding the bonus twice', () => {
    const initial = planThresholdEvents({ progress: progress(), sourceTransitionId: 'approval_v1|first', effectiveAt: 1, existingEvents: [] })
    const firstLoss = planThresholdEvents({
      progress: progress({ approvedPoints: 0, progressPercentage: 0, dailyGoalReached: false, perfectDayReached: false, finalized: true }),
      sourceTransitionId: 'invalidation_v1|first', effectiveAt: 2, existingEvents: initial,
    })
    const firstRecovery = planThresholdEvents({ progress: progress(), sourceTransitionId: 'approval_v1|recovery-1', effectiveAt: 3, existingEvents: [...initial, ...firstLoss] })
    const secondLoss = planThresholdEvents({
      progress: progress({ approvedPoints: 0, progressPercentage: 0, dailyGoalReached: false, perfectDayReached: false, finalized: true }),
      sourceTransitionId: 'invalidation_v1|second', effectiveAt: 4, existingEvents: [...initial, ...firstLoss, ...firstRecovery],
    })
    const secondRecovery = planThresholdEvents({ progress: progress(), sourceTransitionId: 'approval_v1|recovery-2', effectiveAt: 5, existingEvents: [...initial, ...firstLoss, ...firstRecovery, ...secondLoss] })

    expect([...firstRecovery, ...secondRecovery].map(({ id }) => id)).toEqual([
      dailyGoalQualificationEventId(familyId, childId, dayKey, 'approval_v1|recovery-1'),
      perfectDayQualificationEventId(familyId, childId, dayKey, 'approval_v1|recovery-1'),
      dailyGoalQualificationEventId(familyId, childId, dayKey, 'approval_v1|recovery-2'),
      perfectDayQualificationEventId(familyId, childId, dayKey, 'approval_v1|recovery-2'),
    ])
    expect([...initial, ...firstLoss, ...firstRecovery, ...secondLoss, ...secondRecovery]
      .filter(({ event }) => event.eventType.endsWith('_awarded'))).toHaveLength(2)
  })
})

describe('calculatePerfectDayCount', () => {
  it('rejects a causal group larger than the immutable eight-record cap', () => {
    const group = 'gamification_transition_v1|oversized'
    const events = Array.from({ length: 9 }, (_, index) => {
      const sourceTransitionId = `approval_v1|oversized-${index}`
      const document = qualification('perfect_day', 'qualified', sourceTransitionId, 1)
      return { ...document, event: { ...document.event, causalGroupId: group, transitionRank: index } }
    })

    expect(() => calculatePerfectDayCount(events)).toThrow(/at most 8/i)
  })

  it('rejects conflicting family metadata within one causal group', () => {
    const group = 'gamification_transition_v1|inconsistent-family'
    const first = qualification('perfect_day', 'qualified', 'approval_v1|metadata-1', 1)
    const second = qualification('perfect_day', 'unqualified', 'approval_v1|metadata-2', 1)

    expect(() => calculatePerfectDayCount([
      { ...first, event: { ...first.event, causalGroupId: group } },
      { ...second, event: { ...second.event, causalGroupId: group, familyId: 'other-family' } },
    ])).toThrow(/familyId/i)
  })

  it('counts latest immutable qualification state and never exposes a same-group transient qualification', () => {
    const source = 'approval_v1|already-invalid'
    const group = `gamification_transition_v1|${source}`
    const award = bonus(perfectDayEventId(familyId, childId, dayKey), { sourceTransitionId: source, causalGroupId: group, effectiveAt: 1, transitionRank: 3 })
    const revoke = bonus(perfectDayRevocationEventId(familyId, childId, dayKey), {
      eventType: 'perfect_day_revoked', xpDelta: -50, causalEventId: award.id, sourceTransitionId: source, causalGroupId: group,
      effectiveAt: 1, transitionRank: 4,
    })
    const unqualifiedSource = 'invalidation_v1|already-invalid'
    const unqualified = qualification('perfect_day', 'unqualified', unqualifiedSource, 1)
    expect(calculatePerfectDayCount([
      award,
      qualification('perfect_day', 'qualified', source, 1),
      revoke,
      { ...unqualified, event: { ...unqualified.event, causalGroupId: group, transitionRank: 6 } },
    ]))
      .toBe(0)
  })

  it('restores Perfect Day qualification through distinct loss/recovery sources without another bonus', () => {
    expect(calculatePerfectDayCount([
      qualification('perfect_day', 'qualified', 'approval_v1|first', 1),
      qualification('perfect_day', 'unqualified', 'invalidation_v1|first', 2),
      qualification('perfect_day', 'qualified', 'approval_v1|recovery-1', 3),
      qualification('perfect_day', 'unqualified', 'invalidation_v1|second', 4),
      qualification('perfect_day', 'qualified', 'approval_v1|recovery-2', 5),
    ])).toBe(1)
  })
})
