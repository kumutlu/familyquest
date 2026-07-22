import { describe, expect, it } from 'vitest'
import { planApprovedTask, planTaskReversal, rebuildGamificationSummary } from './engine'
import type {
  DailyEligibilitySnapshotV1,
  TaskGamificationEffectV1,
} from './types'

const familyId = 'family-1'
const childId = 'child-1'
const dayKey = '2026-07-22'
const approvedAt = Date.UTC(2026, 6, 22, 12)
const logicalCompletionKey = 'task_v1|child-1|task-1|day:2026-07-22'

function effect(requiresApproval: boolean): TaskGamificationEffectV1 {
  return {
    schemaVersion: 1, familyId, childId, taskId: 'task-1', logicalCompletionKey,
    periodKey: 'day:2026-07-22', dayKey, timezone: 'Europe/London', pointsReward: 100,
    xpAward: 100, rewardPointsAward: 100, dailyWeight: 100, requiresApproval, approvedAt,
  }
}

function eligibility(): DailyEligibilitySnapshotV1 {
  return {
    schemaVersion: 1, familyId, childId, dayKey, timezone: 'Europe/London', dailyGoalPercentage: 80,
    taskWeights: { 'task-1': 100 }, eligibleTaskCount: 1, eligiblePoints: 100,
    effectiveAt: approvedAt - 1, causalGroupId: `eligibility:${dayKey}`, transitionRank: 0,
    createdAt: approvedAt - 1, createdBy: 'gamification-engine-v1',
  }
}

function approvalInput(requiresApproval: boolean, overrides: Record<string, unknown> = {}) {
  return {
    completionId: requiresApproval ? 'manual-document' : 'auto-document', effect: effect(requiresApproval),
    eligibilitySnapshot: eligibility(), eligibilitySnapshotId: `${childId}:${dayKey}`,
    completionEffects: [{ completionId: requiresApproval ? 'manual-document' : 'auto-document', status: 'approved' as const, effect: effect(requiresApproval) }],
    invalidatedLogicalCompletionKeys: [], existingEvents: [], finalized: true, processingAt: approvedAt,
    ...overrides,
  }
}

describe('gamification write engine', () => {
  it('gives manual and auto approvals the same immutable task and bonus effects', () => {
    const manual = planApprovedTask(approvalInput(true))
    const automatic = planApprovedTask(approvalInput(false))

    expect(manual.events.map(({ id, event }) => [id, event.eventType, event.xpDelta]))
      .toEqual(automatic.events.map(({ id, event }) => [id, event.eventType, event.xpDelta]))
    expect(rebuildGamificationSummary({ events: manual.events, eligibilitySnapshots: [eligibility()], processingAt: approvedAt }))
      .toMatchObject({ xpTotal: 175, level: 1, currentStreak: 1, bestStreak: 1, perfectDayCount: 1 })
  })

  it('deduplicates two completion documents for one logical occurrence', () => {
    const first = planApprovedTask(approvalInput(true))
    const retry = planApprovedTask(approvalInput(false, { existingEvents: first.events }))

    expect(retry.events).toEqual([])
    expect(rebuildGamificationSummary({ events: [...first.events, ...retry.events], eligibilitySnapshots: [eligibility()], processingAt: approvedAt }))
      .toMatchObject({ xpTotal: 175 })
  })

  it.each([
    ['wrong task XP delta', (event: { xpDelta: number }) => ({ ...event, xpDelta: 99 })],
    ['wrong task event type', (event: { eventType: string }) => ({ ...event, eventType: 'daily_goal_awarded' })],
  ])('rejects an existing task event ID with %s instead of suppressing the correct award', (_label, forge) => {
    const approved = planApprovedTask(approvalInput(true))
    const forged = {
      ...approved.events[0],
      event: forge(approved.events[0].event),
    }

    expect(() => planApprovedTask(approvalInput(true, { existingEvents: [forged] }))).toThrow(/integrity/i)
  })

  it('rejects a forged threshold event that would otherwise suppress its deterministic bonus', () => {
    const approved = planApprovedTask(approvalInput(true))
    const forged = approved.events.map((document) => document.event.eventType === 'daily_goal_awarded'
      ? { ...document, event: { ...document.event, xpDelta: 24 } }
      : document)

    expect(() => planApprovedTask(approvalInput(true, { existingEvents: forged }))).toThrow(/integrity/i)
  })

  it('compensates a later reversal and preserves the genuinely reached historical best', () => {
    const approved = planApprovedTask(approvalInput(true))
    const reversed = planTaskReversal({
      completionId: 'manual-document', effect: effect(true), immutableReversalId: 'reversal-1',
      eligibilitySnapshot: eligibility(), eligibilitySnapshotId: `${childId}:${dayKey}`,
      completionEffects: [{ completionId: 'manual-document', status: 'approved', effect: effect(true) }],
      invalidatedLogicalCompletionKeys: [logicalCompletionKey], existingEvents: approved.events,
      finalized: true, processingAt: approvedAt + 1,
    })

    expect(reversed.events.filter(({ event }) => event.xpDelta < 0).map(({ event }) => event.xpDelta)).toEqual([-100, -25, -50])
    expect(reversed.events.filter(({ event }) => event.qualificationState === 'unqualified')).toHaveLength(2)
    expect(reversed.events.every(({ event }) => event.causalGroupId.endsWith('invalidation_v1|reversal-1'))).toBe(true)
    expect(rebuildGamificationSummary({ events: [...approved.events, ...reversed.events], eligibilitySnapshots: [eligibility()], processingAt: approvedAt + 1 }))
      .toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 1, perfectDayCount: 0 })
  })

  it('compensates a post-award reversal even when the day is not finalized', () => {
    const approved = planApprovedTask(approvalInput(true, { finalized: false }))
    const reversed = planTaskReversal({
      completionId: 'manual-document', effect: effect(true), immutableReversalId: 'unfinalized-reversal',
      eligibilitySnapshot: eligibility(), eligibilitySnapshotId: `${childId}:${dayKey}`,
      completionEffects: [{ completionId: 'manual-document', status: 'approved', effect: effect(true) }],
      invalidatedLogicalCompletionKeys: [logicalCompletionKey], existingEvents: approved.events,
      finalized: false, processingAt: approvedAt + 1,
    })

    expect(reversed.events.filter(({ event }) => event.eventType.endsWith('_revoked')).map(({ event }) => event.xpDelta))
      .toEqual([-100, -25, -50])
    expect(reversed.events.filter(({ event }) => event.qualificationState === 'unqualified')).toHaveLength(2)
  })

  it('records each same-day loss and recovery while awarding each bonus only once', () => {
    const approved = planApprovedTask(approvalInput(true))
    const firstLoss = planTaskReversal({
      completionId: 'manual-document', effect: effect(true), immutableReversalId: 'loss-1',
      eligibilitySnapshot: eligibility(), eligibilitySnapshotId: `${childId}:${dayKey}`,
      completionEffects: [{ completionId: 'manual-document', status: 'approved', effect: effect(true) }],
      invalidatedLogicalCompletionKeys: [logicalCompletionKey], existingEvents: approved.events, finalized: true, processingAt: approvedAt + 1,
    })
    const firstRecovery = planApprovedTask(approvalInput(true, {
      existingEvents: [...approved.events, ...firstLoss.events], processingAt: approvedAt + 2,
      qualificationSourceTransitionId: 'recovery_v1|first',
    }))
    const secondLoss = planTaskReversal({
      completionId: 'manual-document', effect: effect(true), immutableReversalId: 'loss-2', eligibilitySnapshot: eligibility(),
      eligibilitySnapshotId: `${childId}:${dayKey}`, completionEffects: [{ completionId: 'manual-document', status: 'approved', effect: effect(true) }],
      invalidatedLogicalCompletionKeys: [logicalCompletionKey], existingEvents: [...approved.events, ...firstLoss.events, ...firstRecovery.events], finalized: true, processingAt: approvedAt + 3,
    })
    const secondRecovery = planApprovedTask(approvalInput(true, {
      existingEvents: [...approved.events, ...firstLoss.events, ...firstRecovery.events, ...secondLoss.events], processingAt: approvedAt + 4,
      qualificationSourceTransitionId: 'recovery_v1|second',
    }))
    const all = [...approved.events, ...firstLoss.events, ...firstRecovery.events, ...secondLoss.events, ...secondRecovery.events]

    expect(all.filter(({ event }) => event.eventType.endsWith('_awarded'))).toHaveLength(3)
    expect([...firstRecovery.events, ...secondRecovery.events].every(({ event }) => event.xpDelta === 0 && event.qualificationState === 'qualified')).toBe(true)
    expect(rebuildGamificationSummary({ events: all, eligibilitySnapshots: [eligibility()], processingAt: approvedAt + 4 }))
      .toMatchObject({ currentStreak: 1, perfectDayCount: 1 })
  })

  it('repairs reversal-before-award as one net-zero causal group and makes retries no-ops', () => {
    const reversalFirst = planTaskReversal({
      completionId: 'manual-document', effect: effect(true), immutableReversalId: 'already-invalid', eligibilitySnapshot: eligibility(),
      eligibilitySnapshotId: `${childId}:${dayKey}`, completionEffects: [{ completionId: 'manual-document', status: 'approved', effect: effect(true) }],
      invalidatedLogicalCompletionKeys: [logicalCompletionKey], existingEvents: [], finalized: true, processingAt: approvedAt,
    })
    expect(reversalFirst.events).toEqual([])
    const repaired = planApprovedTask(approvalInput(true, { invalidatedLogicalCompletionKeys: [logicalCompletionKey], processingAt: approvedAt + 1 }))
    const retry = planApprovedTask(approvalInput(true, { invalidatedLogicalCompletionKeys: [logicalCompletionKey], existingEvents: repaired.events, processingAt: approvedAt + 1 }))

    expect(repaired.events).toHaveLength(6)
    expect(new Set(repaired.events.map(({ event }) => event.causalGroupId)).size).toBe(1)
    expect(repaired.events.filter(({ event }) => event.xpDelta < 0).map(({ event }) => event.xpDelta)).toEqual([-100])
    expect(retry.events).toEqual([])
    expect(rebuildGamificationSummary({ events: repaired.events, eligibilitySnapshots: [eligibility()], processingAt: approvedAt + 1 }))
      .toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 0, perfectDayCount: 0 })
  })

  it('makes valid already-invalid repairs no-ops through both approval and reversal entry points', () => {
    const repaired = planApprovedTask(approvalInput(true, { invalidatedLogicalCompletionKeys: [logicalCompletionKey] }))
    const approvalRetry = planApprovedTask(approvalInput(true, {
      invalidatedLogicalCompletionKeys: [logicalCompletionKey], existingEvents: repaired.events,
    }))
    const reversalRetry = planTaskReversal({
      completionId: 'manual-document', effect: effect(true), immutableReversalId: 'already-invalid', eligibilitySnapshot: eligibility(),
      eligibilitySnapshotId: `${childId}:${dayKey}`, completionEffects: [{ completionId: 'manual-document', status: 'approved', effect: effect(true) }],
      invalidatedLogicalCompletionKeys: [logicalCompletionKey], existingEvents: repaired.events, finalized: true, processingAt: approvedAt,
    })

    expect(approvalRetry.events).toEqual([])
    expect(reversalRetry.events).toEqual([])
    expect(approvalRetry.summary).toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 0, perfectDayCount: 0 })
    expect(reversalRetry.summary).toMatchObject({ xpTotal: 0, currentStreak: 0, bestStreak: 0, perfectDayCount: 0 })
  })

  it.each([
    ['forged task compensation', (event: { xpDelta: number }) => ({ ...event, xpDelta: -99 })],
    ['forged qualification payload', (event: { qualificationState?: string }) => ({ ...event, qualificationState: 'qualified' })],
  ])('rejects an already-invalid atomic-repair retry with %s', (_label, forge) => {
    const repaired = planApprovedTask(approvalInput(true, { invalidatedLogicalCompletionKeys: [logicalCompletionKey] }))
    const forged = repaired.events.map((document) => document.event.eventType === 'xp_revoked'
      ? { ...document, event: forge(document.event) }
      : document.event.eventType === 'daily_goal_qualification_changed' && document.event.qualificationState === 'unqualified'
        ? { ...document, event: forge(document.event) }
        : document)

    expect(() => planApprovedTask(approvalInput(true, {
      invalidatedLogicalCompletionKeys: [logicalCompletionKey], existingEvents: forged,
    }))).toThrow(/integrity/i)
    expect(() => planTaskReversal({
      completionId: 'manual-document', effect: effect(true), immutableReversalId: 'already-invalid', eligibilitySnapshot: eligibility(),
      eligibilitySnapshotId: `${childId}:${dayKey}`, completionEffects: [{ completionId: 'manual-document', status: 'approved', effect: effect(true) }],
      invalidatedLogicalCompletionKeys: [logicalCompletionKey], existingEvents: forged as never, finalized: true, processingAt: approvedAt,
    })).toThrow(/integrity/i)
  })

  it('rejects an unexpected but structurally valid event in an already-invalid repair group', () => {
    const repaired = planApprovedTask(approvalInput(true, { invalidatedLogicalCompletionKeys: [logicalCompletionKey] }))
    const template = repaired.events[0]
    const extra = {
      id: 'unexpected-repair-member',
      event: { ...template.event, idempotencyKey: 'unexpected-repair-member', xpDelta: 1 },
    }

    expect(() => planApprovedTask(approvalInput(true, {
      invalidatedLogicalCompletionKeys: [logicalCompletionKey], existingEvents: [...repaired.events, extra],
    }))).toThrow(/integrity/i)
  })

  it('rebuilds every summary field from shuffled immutable inputs without an old summary', () => {
    const approved = planApprovedTask(approvalInput(true))
    const summary = rebuildGamificationSummary({
      events: [...approved.events].reverse(), eligibilitySnapshots: [eligibility()], processingAt: approvedAt + 9,
    })

    expect(summary).toMatchObject({ xpTotal: 175, level: 1, currentStreak: 1, bestStreak: 1, perfectDayCount: 1, lastQualifiedDayKey: dayKey })
    expect(summary.updatedAt).toBe(approvedAt + 9)
  })

  it('rejects conflicting same-day immutable eligibility snapshots regardless of input order', () => {
    const first = eligibility()
    const conflict = { ...eligibility(), taskWeights: { 'task-1': 99 }, eligiblePoints: 99 }
    const approved = planApprovedTask(approvalInput(true))

    expect(() => rebuildGamificationSummary({
      events: approved.events, eligibilitySnapshots: [first, conflict], processingAt: approvedAt,
    })).toThrow(/conflicting immutable snapshot/i)
    expect(() => rebuildGamificationSummary({
      events: approved.events, eligibilitySnapshots: [conflict, first], processingAt: approvedAt,
    })).toThrow(/conflicting immutable snapshot/i)
  })

  it('rejects an invalid immutable source before returning any plan', () => {
    const invalidEffect = { ...effect(true), xpAward: 99 }
    expect(() => planApprovedTask(approvalInput(true, { effect: invalidEffect }))).toThrow(/immutable effect/i)
  })

  it('rejects an invalid runtime completion status before returning any plan', () => {
    const invalidStatus = {
      ...approvalInput(true),
      completionEffects: [{ completionId: 'manual-document', status: 'forged', effect: effect(true) }],
    }

    expect(() => planApprovedTask(invalidStatus as never)).toThrow(/completion effect status/i)
  })
})
