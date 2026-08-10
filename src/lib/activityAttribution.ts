/**
 * Presentation-only attribution for activity/history rows.
 *
 * The dashboard feed historically rendered only the *actor* of a record, which
 * for approvals is the parent. Parents, however, primarily want to know WHICH
 * CHILD performed the action. This module derives that missing information from
 * data already present in the store (task completions, tasks, members) without
 * changing any business logic or write path.
 */

export interface AttributionPools {
  taskCompletions?: any[];
  tasks?: any[];
  familyMembers?: any[];
}

export interface ActivityAttribution {
  /** The member the activity is *about* (usually the child). */
  subjectId?: string;
  subjectName?: string;
  /** The parent/owner who approved or recorded it, when different from subject. */
  approverName?: string;
  taskTitle?: string;
  points?: number;
}

const TASK_APPROVAL_PREFIX = 'task_approval_';

export function pointsFromText(text?: string): number | undefined {
  if (!text) return undefined;
  const match = /([+-]?\d+)\s*(?:pts|points|puan)/i.exec(text);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

/** Resolve the task-completion id a feed item refers to, if any. */
export function completionIdFromFeedItem(item: any): string | null {
  if (item?.entityType === 'task_completion' && item?.entityId) return String(item.entityId);
  if (typeof item?.id === 'string' && item.id.startsWith(TASK_APPROVAL_PREFIX)) {
    return item.id.slice(TASK_APPROVAL_PREFIX.length) || null;
  }
  return null;
}

function memberName(pools: AttributionPools, id?: string): string | undefined {
  if (!id) return undefined;
  return pools.familyMembers?.find((member: any) => member.id === id)?.displayName;
}

/**
 * Derive "who did it / who approved it / what / how many points" for a feed item.
 * Every field is optional: legacy records simply resolve to fewer details and
 * the UI falls back to the raw activity text.
 */
export function attributeFeedItem(item: any, pools: AttributionPools = {}): ActivityAttribution {
  const completionId = completionIdFromFeedItem(item);
  const completion = completionId
    ? pools.taskCompletions?.find((entry: any) => entry.id === completionId)
    : undefined;

  const subjectId = completion?.assigneeId ?? item?.subjectId ?? item?.childId;
  const task = completion ? pools.tasks?.find((entry: any) => entry.id === completion.taskId) : undefined;

  const subjectName = memberName(pools, subjectId) ?? completion?.assigneeName ?? item?.childName;
  const approverName = item?.actorName && item?.actorId !== subjectId ? item.actorName : undefined;

  const points =
    (typeof completion?.awardedPoints === 'number' ? completion.awardedPoints : undefined) ??
    (typeof task?.pointsReward === 'number' ? task.pointsReward : undefined) ??
    pointsFromText(item?.text);

  return {
    ...(subjectId ? { subjectId } : {}),
    ...(subjectName ? { subjectName } : {}),
    ...(approverName ? { approverName } : {}),
    ...(task?.title ? { taskTitle: task.title } : {}),
    ...(points !== undefined ? { points } : {}),
  };
}

/**
 * Derive the same attribution for a reversible-history source document
 * (task completion, redemption, behaviour event, request…).
 */
export function attributeHistorySource(
  sourceKind: string,
  source: any,
  pools: AttributionPools = {},
): ActivityAttribution {
  const subjectId =
    source?.assigneeId ?? source?.childId ?? source?.userId ?? source?.requesterId ?? source?.fromChildId;
  const task = source?.taskId ? pools.tasks?.find((entry: any) => entry.id === source.taskId) : undefined;
  const points =
    (typeof source?.awardedPoints === 'number' ? source.awardedPoints : undefined) ??
    (typeof source?.effectSnapshot?.pointsDelta === 'number' ? source.effectSnapshot.pointsDelta : undefined) ??
    (sourceKind === 'task_completion' && typeof task?.pointsReward === 'number' ? task.pointsReward : undefined);

  const subjectName = memberName(pools, subjectId) ?? source?.childName ?? source?.assigneeName;
  const approverName = source?.reviewedByName ?? source?.approvedByName ?? source?.createdByName;

  return {
    ...(subjectId ? { subjectId } : {}),
    ...(subjectName ? { subjectName } : {}),
    ...(approverName && approverName !== subjectName ? { approverName } : {}),
    ...(task?.title ? { taskTitle: task.title } : {}),
    ...(points !== undefined && points !== 0 ? { points } : {}),
  };
}

/** Normalise the many timestamp shapes used across Firestore documents. */
export function toDateValue(value: any): Date | null {
  if (!value) return null;
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value);
  return date instanceof Date && !isNaN(date.getTime()) ? date : null;
}
