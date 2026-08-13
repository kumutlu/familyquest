/** A UTC epoch-millisecond timestamp. Firestore adapters convert this to Timestamp. */
export type EngineTimestamp = number

export type GamificationEventTypeV1 =
  | 'xp_awarded'
  | 'xp_revoked'
  | 'daily_goal_awarded'
  | 'daily_goal_revoked'
  | 'daily_goal_qualification_changed'
  | 'perfect_day_awarded'
  | 'perfect_day_revoked'
  | 'perfect_day_qualification_changed'
  | 'legacy_xp_baseline'
  | 'behaviour_positive'
  | 'behaviour_negative'
  | 'behaviour_financial'

export type GamificationSourceTypeV1 = 'task_completion' | 'daily_progress' | 'migration' | 'behaviour_event'
export type GamificationCreatedByV1 =
  | 'gamification-engine-v1'
  | 'legacy-xp-migration-v1'
  | 'legacy-xp-normalizer-v1'
  | 'behaviour-processor-v1'
export type QualificationStateV1 = 'qualified' | 'unqualified'
export type TaskCompletionStatus = 'pending_approval' | 'approved' | 'rejected' | 'cancelled' | 'invalidated'
export type GamificationMigrationStatusV1 = 'inactive' | 'prepared' | 'baseline_complete' | 'active'

export interface SemanticCursorV1 {
  readonly effectiveAt: EngineTimestamp
  readonly causalGroupId: string
  readonly transitionRank: number
  readonly documentId: string
}

export interface GamificationEventV1 {
  readonly schemaVersion: 1
  readonly familyId: string
  readonly childId: string
  readonly eventType: GamificationEventTypeV1
  readonly xpDelta: number
  readonly sourceType: GamificationSourceTypeV1
  readonly sourceId: string
  readonly logicalCompletionKey?: string
  readonly idempotencyKey: string
  readonly dayKey?: string
  readonly timezone?: string
  readonly causalEventId?: string
  readonly causalGroupId: string
  readonly effectiveAt: EngineTimestamp
  readonly transitionRank: number
  readonly taskId?: string
  readonly configSchemaVersion: 1
  readonly createdBy: GamificationCreatedByV1
  readonly createdAt: EngineTimestamp
  readonly migratedAt?: EngineTimestamp
  readonly sourceTransitionId?: string
  readonly qualificationState?: QualificationStateV1
}

export interface TaskGamificationEffectV1 {
  readonly schemaVersion: 1
  readonly familyId: string
  readonly childId: string
  readonly taskId: string
  readonly logicalCompletionKey: string
  readonly periodKey: string
  readonly dayKey: string
  readonly timezone: string
  readonly pointsReward: number
  readonly xpAward: number
  readonly rewardPointsAward: number
  readonly dailyWeight: number
  readonly requiresApproval: boolean
  readonly approvedAt: EngineTimestamp
}

export interface DailyEligibilitySnapshotV1 {
  readonly schemaVersion: 1
  readonly familyId: string
  readonly childId: string
  readonly dayKey: string
  readonly timezone: string
  readonly dailyGoalPercentage: number
  readonly taskWeights: Readonly<Record<string, number>>
  readonly eligibleTaskCount: number
  readonly eligiblePoints: number
  readonly effectiveAt: EngineTimestamp
  readonly causalGroupId: string
  readonly transitionRank: 0
  readonly createdAt: EngineTimestamp
  readonly createdBy: 'gamification-engine-v1'
}

export interface DailyProgressV1 {
  readonly schemaVersion: 1
  readonly familyId: string
  readonly childId: string
  readonly dayKey: string
  readonly timezone: string
  readonly eligibilitySnapshotId: string
  readonly dailyGoalPercentage: number
  readonly eligiblePoints: number
  readonly approvedPoints: number
  readonly eligibleTaskCount: number
  readonly approvedTaskCount: number
  readonly progressPercentage: number
  readonly dailyGoalReached: boolean
  readonly perfectDayReached: boolean
  readonly finalized: boolean
  readonly contributingLogicalCompletionKeys: readonly string[]
  readonly invalidatedLogicalCompletionKeys: readonly string[]
  readonly calculatedAt: EngineTimestamp
}

export interface GamificationSummaryV1 {
  readonly schemaVersion: 1
  readonly familyId: string
  readonly childId: string
  readonly xpTotal: number
  readonly level: number
  readonly currentStreak: number
  readonly bestStreak: number
  readonly perfectDayCount: number
  readonly lastQualifiedDayKey: string | null
  readonly projectionRevision: number
  readonly foldedThrough: SemanticCursorV1 | null
  readonly rebuildRequired: boolean
  readonly earliestDirtyCursor: SemanticCursorV1 | null
  readonly projectionStatus: 'ready' | 'rebuild_required' | 'rebuilding' | 'failed'
  readonly rebuildGenerationId?: string | null
  readonly rebuildFailure?: string | null
  readonly updatedAt: EngineTimestamp
}

export interface ScheduledTask {
  readonly id: string
  readonly familyId: string
  readonly childId: string
  readonly pointsReward: number
  readonly requiresApproval: boolean
}

export interface TaskCompletion {
  readonly id: string
  readonly familyId: string
  readonly childId: string
  readonly taskId: string
  readonly periodKey: string
  readonly status: TaskCompletionStatus
  readonly completedAt: EngineTimestamp
  readonly approvedAt?: EngineTimestamp
}

export interface GamificationMigrationV1 {
  readonly schemaVersion: 1
  readonly status: GamificationMigrationStatusV1
  readonly cutoverAt?: EngineTimestamp
  readonly migratedAt?: EngineTimestamp
  readonly repairCheckpoint?: string
}

export interface RebuildCheckpointV1 {
  readonly schemaVersion: 1
  readonly familyId: string
  readonly childId: string
  readonly generationId: string
  readonly watermarkAt: EngineTimestamp
  readonly dirty: boolean
  readonly eligibilityCursor: SemanticCursorV1 | null
  readonly eventCursor: SemanticCursorV1 | null
  readonly pendingCausalGroupId: string | null
  readonly partialSummary: GamificationSummaryV1 | null
}

export const MAX_CAUSAL_GROUP_RECORDS = 8

export function assertCausalGroupRecordCount(recordCount: number): void {
  if (!Number.isInteger(recordCount) || recordCount < 0 || recordCount > MAX_CAUSAL_GROUP_RECORDS) {
    throw new Error(`A causal group may contain at most ${MAX_CAUSAL_GROUP_RECORDS} records`)
  }
}

function assertComponent(value: string, label: string): void {
  if (value.length === 0 || value.includes('/') || value.includes('|')) {
    throw new Error(`${label} must be non-empty and may not contain / or |`)
  }
}

function assertEpochMilliseconds(value: EngineTimestamp): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Timestamp must be a non-negative safe integer epoch millisecond value')
  }
}

function assertLogicalCompletionKey(value: string): void {
  const parts = value.split('|')
  if (parts.length !== 4 || parts[0] !== 'task_v1') {
    throw new Error('logicalCompletionKey must use the task_v1 canonical form')
  }
  for (const component of parts.slice(1)) assertComponent(component, 'logicalCompletionKey component')
}

export function approvalSourceTransitionId(logicalCompletionKey: string): string {
  assertLogicalCompletionKey(logicalCompletionKey)
  return `approval_v1|${logicalCompletionKey}`
}

export function invalidationSourceTransitionId(immutableReversalId: string): string {
  assertComponent(immutableReversalId, 'immutableReversalId')
  return `invalidation_v1|${immutableReversalId}`
}

export function cancellationSourceTransitionId(
  completionId: string,
  authoritativeStatusChangedAt: EngineTimestamp,
): string {
  assertComponent(completionId, 'completionId')
  assertEpochMilliseconds(authoritativeStatusChangedAt)
  return `cancellation_v1|${completionId}|${authoritativeStatusChangedAt}`
}

export function finalizationSourceTransitionId(eligibilitySnapshotId: string): string {
  assertComponent(eligibilitySnapshotId, 'eligibilitySnapshotId')
  return `finalization_v1|${eligibilitySnapshotId}`
}

export function causalGroupIdForTransition(sourceTransitionId: string): string {
  if (sourceTransitionId.length === 0) throw new Error('sourceTransitionId must be non-empty')
  return `gamification_transition_v1|${sourceTransitionId}`
}
