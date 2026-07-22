import { describe, expect, it } from 'vitest'
import {
  MAX_CAUSAL_GROUP_RECORDS,
  approvalSourceTransitionId,
  assertCausalGroupRecordCount,
  cancellationSourceTransitionId,
  causalGroupIdForTransition,
  finalizationSourceTransitionId,
  invalidationSourceTransitionId,
  type DailyEligibilitySnapshotV1,
  type DailyProgressV1,
  type EngineTimestamp,
  type GamificationEventV1,
  type GamificationSummaryV1,
  type RebuildCheckpointV1,
  type TaskCompletion,
  type TaskGamificationEffectV1,
  type ScheduledTask,
} from './types'

describe('gamification source transition IDs', () => {
  const logicalCompletionKey = 'task_v1|child-1|task-1|day:2026-07-22'

  it('builds every canonical source transition ID', () => {
    expect(approvalSourceTransitionId(logicalCompletionKey)).toBe(
      'approval_v1|task_v1|child-1|task-1|day:2026-07-22',
    )
    expect(invalidationSourceTransitionId('reversal-1')).toBe('invalidation_v1|reversal-1')
    expect(cancellationSourceTransitionId('completion-1', 1_753_139_200_000)).toBe(
      'cancellation_v1|completion-1|1753139200000',
    )
    expect(finalizationSourceTransitionId('child-1:2026-07-22')).toBe(
      'finalization_v1|child-1:2026-07-22',
    )
  })

  it('is stable for a retry of the same authoritative fact', () => {
    expect(cancellationSourceTransitionId('completion-1', 1234)).toBe(
      cancellationSourceTransitionId('completion-1', 1234),
    )
  })

  it('keeps repeated oscillation sources distinct', () => {
    expect(invalidationSourceTransitionId('reversal-1')).not.toBe(
      invalidationSourceTransitionId('reversal-2'),
    )
    expect(cancellationSourceTransitionId('completion-1', 1000)).not.toBe(
      cancellationSourceTransitionId('completion-1', 2000),
    )
  })

  it.each([
    () => approvalSourceTransitionId('task_v1|child/1|task-1|day:2026-07-22'),
    () => invalidationSourceTransitionId('reversal|1'),
    () => cancellationSourceTransitionId('completion/1', 1),
    () => finalizationSourceTransitionId('child-1|2026-07-22'),
  ])('rejects a delimiter in a source component', (buildTransition) => {
    expect(buildTransition).toThrow()
  })

  it('derives the canonical causal group from a transition', () => {
    expect(causalGroupIdForTransition('approval_v1|logical-key')).toBe(
      'gamification_transition_v1|approval_v1|logical-key',
    )
  })

  it('enforces the eight-record causal-group cap', () => {
    expect(MAX_CAUSAL_GROUP_RECORDS).toBe(8)
    expect(() => assertCausalGroupRecordCount(8)).not.toThrow()
    expect(() => assertCausalGroupRecordCount(9)).toThrow()
  })
})

describe('gamification contracts', () => {
  it('accepts the immutable event, effect, projection, and rebuild shapes', () => {
    const timestamp: EngineTimestamp = 1_753_139_200_000
    const event: GamificationEventV1 = {
      schemaVersion: 1, familyId: 'family-1', childId: 'child-1', eventType: 'xp_awarded',
      xpDelta: 25, sourceType: 'task_completion', sourceId: 'completion-1',
      idempotencyKey: 'task_xp:key', causalGroupId: 'group-1', effectiveAt: timestamp,
      transitionRank: 0, configSchemaVersion: 1, createdBy: 'gamification-engine-v1', createdAt: timestamp,
    }
    const effect: TaskGamificationEffectV1 = {
      schemaVersion: 1, familyId: 'family-1', childId: 'child-1', taskId: 'task-1',
      logicalCompletionKey: 'task_v1|child-1|task-1|day:2026-07-22', periodKey: 'day:2026-07-22',
      dayKey: '2026-07-22', timezone: 'Europe/London', pointsReward: 25, xpAward: 25,
      rewardPointsAward: 25, dailyWeight: 25, requiresApproval: false, approvedAt: timestamp,
    }
    const snapshot: DailyEligibilitySnapshotV1 = {
      schemaVersion: 1, familyId: 'family-1', childId: 'child-1', dayKey: '2026-07-22',
      timezone: 'Europe/London', dailyGoalPercentage: 80, taskWeights: { 'task-1': 25 },
      eligibleTaskCount: 1, eligiblePoints: 25, effectiveAt: timestamp, causalGroupId: 'group-1',
      transitionRank: 0, createdAt: timestamp, createdBy: 'gamification-engine-v1',
    }
    const progress: DailyProgressV1 = {
      schemaVersion: 1, familyId: 'family-1', childId: 'child-1', dayKey: '2026-07-22',
      timezone: 'Europe/London', eligibilitySnapshotId: 'child-1:2026-07-22', dailyGoalPercentage: 80,
      eligiblePoints: 25, approvedPoints: 25, eligibleTaskCount: 1, approvedTaskCount: 1,
      progressPercentage: 100, dailyGoalReached: true, perfectDayReached: true, finalized: false,
      contributingLogicalCompletionKeys: [effect.logicalCompletionKey], invalidatedLogicalCompletionKeys: [],
      calculatedAt: timestamp,
    }
    const summary: GamificationSummaryV1 = {
      schemaVersion: 1, familyId: 'family-1', childId: 'child-1', xpTotal: 25, level: 1,
      currentStreak: 1, bestStreak: 1, perfectDayCount: 1, lastQualifiedDayKey: '2026-07-22',
      projectionRevision: 1, foldedThrough: null, rebuildRequired: false, earliestDirtyCursor: null,
      projectionStatus: 'ready', updatedAt: timestamp,
    }
    const checkpoint: RebuildCheckpointV1 = {
      schemaVersion: 1, familyId: 'family-1', childId: 'child-1', generationId: 'generation-1',
      watermarkAt: timestamp, dirty: false, eligibilityCursor: null, eventCursor: null,
      pendingCausalGroupId: null, partialSummary: null,
    }
    const task: ScheduledTask = {
      id: 'task-1', familyId: 'family-1', childId: 'child-1', pointsReward: 25, requiresApproval: false,
    }
    const completion: TaskCompletion = {
      id: 'completion-1', familyId: 'family-1', childId: 'child-1', taskId: 'task-1',
      periodKey: 'day:2026-07-22', status: 'approved', completedAt: timestamp, approvedAt: timestamp,
    }
    expect({ event, effect, snapshot, progress, summary, checkpoint, task, completion }).toBeDefined()
  })
})
