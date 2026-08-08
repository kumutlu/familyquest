import { GAMIFICATION_V3_SCHEMA_VERSION, type TaskApprovedEventV3 } from '../../../../src/domain/gamification/v3/event'
import { taskApprovedEventId } from '../../../../src/domain/gamification/v3/ids'

export interface TaskApprovalSource {
  readonly familyId: string
  readonly memberId: string
  readonly taskId: string
  readonly logicalCompletionKey: string
  readonly pointsReward: number
  readonly xpAward: number
  readonly approvedAt: string  // ISO-8601
  readonly createdAt: string   // ISO-8601
}

/** Pure mapper: legacy task approval → immutable TASK_APPROVED V3 event. */
export function mapTaskApproval(source: TaskApprovalSource): TaskApprovedEventV3 {
  const eventId = taskApprovedEventId(source.familyId, source.memberId, source.logicalCompletionKey)
  return {
    schemaVersion: GAMIFICATION_V3_SCHEMA_VERSION,
    eventId,
    eventType: 'TASK_APPROVED',
    familyId: source.familyId,
    memberId: source.memberId,
    sourceType: 'task_completion',
    sourceId: source.logicalCompletionKey,
    effectiveAt: source.approvedAt,
    createdAt: source.createdAt,
    rewardPointsDelta: source.pointsReward,
    xpDelta: source.xpAward,
    weeklyPointsDelta: source.pointsReward,
    idempotencyKey: eventId,
    metadata: { taskId: source.taskId },
  }
}