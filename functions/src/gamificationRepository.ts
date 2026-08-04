import {
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore'
import { resolveGamificationConfig } from '../../src/domain/gamification/config'
import { addFamilyDays, calculateDailyProgress, familyDayKey } from '../../src/domain/gamification/dailyProgress'
import {
  planApprovedTask,
  planTaskReversal,
  rebuildGamificationSummary,
  type GamificationEventDocumentV1,
} from '../../src/domain/gamification/engine'
import { levelForXp } from '../../src/domain/gamification/level'
import {
  dailyGoalEventId,
  dailyGoalRevocationEventId,
  perfectDayEventId,
  perfectDayRevocationEventId,
  planThresholdEvents,
} from '../../src/domain/gamification/perfectDay'
import { DEFAULT_WEEKLY_CONTEXT } from '../../src/domain/gamification/v3/weeklyWindow'
import { BaselineMissingErrorV3, writeV3ShadowInTransaction } from './gamificationV3/integration'
import { mapTaskApproval } from './gamificationV3/sourceMappers/taskMapper'
import { mapDailyGoal, mapPerfectDay } from './gamificationV3/sourceMappers/dailyAwardMapper'
import {
  finalizationSourceTransitionId,
  type DailyEligibilitySnapshotV1,
  type DailyProgressV1,
  type GamificationEventV1,
  type GamificationSummaryV1,
  type SemanticCursorV1,
  type TaskGamificationEffectV1,
} from '../../src/domain/gamification/types'
import {
  GAMIFICATION_READY_STATUSES,
  type GamificationMigrationStatus,
} from '../../src/domain/gamification/migrationState'
import { logicalCompletionKey, taskXpEventId, taskXpReversalEventId } from '../../src/domain/gamification/xp'
import {
  authoritativePeriodKey,
  buildDailyEligibilitySnapshot,
  taskIsAwardableForChild,
  type RepositoryScheduledTask,
} from './dailyEligibilityAdapter'
import {
  DeterministicProcessorFailure,
  GAMIFICATION_PROCESSOR_VERSION,
  type GamificationProcessResult,
  type GamificationProcessorRepository,
  type ProcessApprovedCompletionArgs,
  type ProcessTaskInvalidationArgs,
  type ProcessorFailureRecord,
} from './gamificationProcessor'
import {
  mergeRebuildStreams,
  takeCompleteCausalGroups,
  type GamificationRepairRepository,
  type RebuildRecord,
  type RepairGamificationPageArgs,
  type RepairPageResult,
  type RepairPostCutoverPageArgs,
} from './gamificationRepair'
import type {
  FinalizeFamilyDayArgs,
  FinalizeFamilyDayResult,
  GamificationSchedulerRepository,
} from './gamificationScheduler'

type MigrationStatus = GamificationMigrationStatus

interface MigrationState {
  readonly status: MigrationStatus
  readonly cutoverAt?: number
  readonly repairCheckpoint?: string
  readonly repairBoundaryAt?: number
}

interface StoredCheckpoint {
  readonly schemaVersion: 1
  readonly familyId: string
  readonly childId: string
  readonly generationId: string
  readonly watermarkAt: Date | FirebaseFirestore.Timestamp
  readonly dirty: boolean
  readonly eligibilityCursor: StoredCursor | null
  readonly eventCursor: StoredCursor | null
  readonly pendingRecords: readonly StoredRebuildRecord[]
  readonly accumulatedEligibility: readonly DocumentData[]
  readonly accumulatedEvents: readonly { id: string; event: DocumentData }[]
}

interface StoredCursor {
  readonly effectiveAt: Date | FirebaseFirestore.Timestamp
  readonly causalGroupId: string
  readonly transitionRank: number
  readonly documentId: string
}

interface StoredRebuildRecord {
  readonly id: string
  readonly effectiveAt: Date | FirebaseFirestore.Timestamp
  readonly causalGroupId: string
  readonly transitionRank: number
  readonly stream: 'eligibility' | 'event'
  readonly value: DocumentData
}

const APPROVED_STATUSES: readonly MigrationStatus[] = GAMIFICATION_READY_STATUSES
const REBUILD_STREAM_LIMIT = 125

/**
 * Structured, one-shot diagnostic for a completion the processor refuses to
 * award. These are the failures that are otherwise completely silent: the user
 * sees a completed task and no points.
 */
function warnIgnoredCompletion(details: {
  readonly familyId: string
  readonly completionId: string
  readonly migrationStatus: MigrationStatus
  readonly reason: 'migration_not_ready'
}): void {
  console.warn('[gamification-ignored]', JSON.stringify(details))
}

function millis(value: unknown, label: string): number {
  if (value instanceof Date && Number.isSafeInteger(value.getTime()) && value.getTime() >= 0) return value.getTime()
  if (value !== null && typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const result = (value as { toMillis(): number }).toMillis()
    if (Number.isSafeInteger(result) && result >= 0) return result
  }
  throw new Error(`${label} must be an Admin Timestamp`)
}

function optionalMillis(value: unknown, label: string): number | undefined {
  return value === undefined || value === null ? undefined : millis(value, label)
}

function timestamp(value: number): Date {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('timestamp must be non-negative epoch milliseconds')
  return new Date(value)
}

function migrationState(family: DocumentData): MigrationState {
  const value = family.gamificationMigration
  if (value === null || typeof value !== 'object' || value.schemaVersion !== 1
    || !['inactive', 'prepared', 'baseline_complete', 'active'].includes(value.status)) {
    return { status: 'inactive' }
  }
  return {
    status: value.status,
    cutoverAt: optionalMillis(value.cutoverAt, 'gamificationMigration.cutoverAt'),
    repairCheckpoint: typeof value.repairCheckpoint === 'string' ? value.repairCheckpoint : undefined,
    repairBoundaryAt: optionalMillis(value.repairBoundaryAt, 'gamificationMigration.repairBoundaryAt'),
  }
}

function timezoneOf(family: DocumentData): string {
  const value = family.timezone
  if (typeof value !== 'string' || value.length === 0) return 'Europe/London'
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value }).format(0)
    return value
  } catch {
    return 'Europe/London'
  }
}

function dateParts(dayKey: string): readonly [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey)
  if (match === null) throw new Error('dayKey must use YYYY-MM-DD')
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** First instant whose formatted family-local date is dayKey. */
function localDayStart(dayKey: string, timezone: string): number {
  const [year, month, day] = dateParts(dayKey)
  const utcNoon = Date.UTC(year, month - 1, day, 12)
  let low = utcNoon - 36 * 60 * 60 * 1000
  let high = utcNoon + 36 * 60 * 60 * 1000
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (familyDayKey(middle, timezone) < dayKey) low = middle + 1
    else high = middle
  }
  if (familyDayKey(low, timezone) !== dayKey) throw new Error(`Unable to resolve local day start for ${dayKey}`)
  return low
}

function taskFromDocument(document: QueryDocumentSnapshot | DocumentSnapshot): RepositoryScheduledTask {
  const data = document.data() ?? {}
  return {
    id: document.id,
    // An empty or missing assignee means the task is shared/family-wide.
    assigneeId: typeof data.assigneeId === 'string' && data.assigneeId.length > 0 ? data.assigneeId : undefined,
    pointsReward: data.pointsReward,
    requiresApproval: typeof data.requiresApproval === 'boolean' ? data.requiresApproval : undefined,
    type: typeof data.type === 'string' ? data.type : undefined,
    isActive: data.isActive === true,
    status: typeof data.status === 'string' ? data.status : undefined,
    archived: data.archived === true,
    isArchived: data.isArchived === true,
    deleted: data.deleted === true,
    disabled: data.disabled === true,
    archivedAt: optionalMillis(data.archivedAt, `task ${document.id} archivedAt`),
    deletedAt: optionalMillis(data.deletedAt, `task ${document.id} deletedAt`),
    disabledAt: optionalMillis(data.disabledAt, `task ${document.id} disabledAt`),
    createdAt: optionalMillis(data.createdAt, `task ${document.id} createdAt`),
    effectiveFrom: typeof data.effectiveFrom === 'string' ? data.effectiveFrom : undefined,
    effectiveTo: typeof data.effectiveTo === 'string' ? data.effectiveTo : undefined,
    effectiveFromAt: typeof data.effectiveFrom === 'string' ? undefined : optionalMillis(data.effectiveFrom, `task ${document.id} effectiveFrom`),
    effectiveToAt: typeof data.effectiveTo === 'string' ? undefined : optionalMillis(data.effectiveTo, `task ${document.id} effectiveTo`),
    dueDate: typeof data.dueDate === 'string' ? data.dueDate : undefined,
    dueWeekday: Number.isInteger(data.dueWeekday) ? data.dueWeekday : undefined,
    customDays: Array.isArray(data.customDays) ? data.customDays : undefined,
  }
}

/**
 * Tasks a child may be awarded for on this day: assigned to them, or shared
 * (no assigneeId). Tasks assigned to a different child are excluded.
 */
function awardableTasks(documents: readonly QueryDocumentSnapshot[], childId: string): readonly RepositoryScheduledTask[] {
  return documents.map(taskFromDocument).filter(task => taskIsAwardableForChild(task, childId))
}

function effectFromData(data: DocumentData): TaskGamificationEffectV1 {
  const effect = data as Record<string, unknown>
  return {
    schemaVersion: 1,
    familyId: String(effect.familyId),
    childId: String(effect.childId),
    taskId: String(effect.taskId),
    logicalCompletionKey: String(effect.logicalCompletionKey),
    periodKey: String(effect.periodKey),
    dayKey: String(effect.dayKey),
    timezone: String(effect.timezone),
    pointsReward: Number(effect.pointsReward),
    xpAward: Number(effect.xpAward),
    rewardPointsAward: Number(effect.rewardPointsAward),
    dailyWeight: Number(effect.dailyWeight),
    requiresApproval: effect.requiresApproval === true,
    approvedAt: millis(effect.approvedAt, 'gamificationEffectSnapshot.approvedAt'),
  }
}

function effectToData(effect: TaskGamificationEffectV1): DocumentData {
  return { ...effect, approvedAt: timestamp(effect.approvedAt) }
}

function eligibilityFromData(data: DocumentData): DailyEligibilitySnapshotV1 {
  return {
    schemaVersion: 1,
    familyId: data.familyId,
    childId: data.childId,
    dayKey: data.dayKey,
    timezone: data.timezone,
    dailyGoalPercentage: data.dailyGoalPercentage,
    taskWeights: data.taskWeights ?? {},
    eligibleTaskCount: data.eligibleTaskCount,
    eligiblePoints: data.eligiblePoints,
    effectiveAt: millis(data.effectiveAt, 'daily eligibility effectiveAt'),
    causalGroupId: data.causalGroupId,
    transitionRank: 0,
    createdAt: millis(data.createdAt, 'daily eligibility createdAt'),
    createdBy: 'gamification-engine-v1',
  }
}

function eligibilityToData(snapshot: DailyEligibilitySnapshotV1): DocumentData {
  return { ...snapshot, effectiveAt: timestamp(snapshot.effectiveAt), createdAt: timestamp(snapshot.createdAt) }
}

function eventFromDocument(document: DocumentSnapshot | QueryDocumentSnapshot): GamificationEventDocumentV1 {
  const data = document.data()!
  const event: GamificationEventV1 = {
    ...data,
    effectiveAt: millis(data.effectiveAt, `event ${document.id} effectiveAt`),
    createdAt: millis(data.createdAt, `event ${document.id} createdAt`),
    ...(data.migratedAt !== undefined ? { migratedAt: millis(data.migratedAt, `event ${document.id} migratedAt`) } : {}),
  } as GamificationEventV1
  return { id: document.id, event }
}

function eventToData(event: GamificationEventV1): DocumentData {
  return withoutUndefined({
    ...event,
    effectiveAt: timestamp(event.effectiveAt),
    createdAt: timestamp(event.createdAt),
    ...(event.migratedAt !== undefined ? { migratedAt: timestamp(event.migratedAt) } : {}),
  }) as DocumentData
}

function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUndefined)
  if (value !== null && typeof value === 'object' && !(value instanceof Date)
    && typeof (value as { toMillis?: unknown }).toMillis !== 'function') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, withoutUndefined(entry)]))
  }
  return value
}

function cursorFromData(value: unknown): SemanticCursorV1 | null {
  if (value === null || value === undefined || typeof value !== 'object') return null
  const data = value as DocumentData
  return {
    effectiveAt: millis(data.effectiveAt, 'summary cursor effectiveAt'),
    causalGroupId: data.causalGroupId,
    transitionRank: data.transitionRank,
    documentId: data.documentId,
  }
}

function cursorToData(value: SemanticCursorV1 | null): DocumentData | null {
  return value === null ? null : { ...value, effectiveAt: timestamp(value.effectiveAt) }
}

function progressFromData(data: DocumentData): DailyProgressV1 {
  return { ...data, calculatedAt: millis(data.calculatedAt, 'daily progress calculatedAt') } as DailyProgressV1
}

function progressToData(progress: DailyProgressV1, events: readonly GamificationEventDocumentV1[] = []): DocumentData {
  const latest = (eventType: GamificationEventV1['eventType']) => [...events]
    .filter(document => document.event.eventType === eventType && document.event.dayKey === progress.dayKey)
    .sort((left, right) => compareCursor(cursorForEvent(left), cursorForEvent(right))).at(-1)
  const dailyGoalQualification = latest('daily_goal_qualification_changed')
  const perfectDayQualification = latest('perfect_day_qualification_changed')
  return withoutUndefined({
    ...progress,
    calculatedAt: timestamp(progress.calculatedAt),
    ...(dailyGoalQualification === undefined ? {} : {
      latestDailyGoalQualification: { id: dailyGoalQualification.id, event: eventToData(dailyGoalQualification.event) },
    }),
    ...(perfectDayQualification === undefined ? {} : {
      latestPerfectDayQualification: { id: perfectDayQualification.id, event: eventToData(perfectDayQualification.event) },
    }),
  }) as DocumentData
}

function qualificationEventsFromProgress(data: DocumentData | undefined): GamificationEventDocumentV1[] {
  if (data === undefined) return []
  const result: GamificationEventDocumentV1[] = []
  for (const field of ['latestDailyGoalQualification', 'latestPerfectDayQualification']) {
    const value = data[field]
    if (value !== null && typeof value === 'object' && typeof value.id === 'string' && value.event !== undefined) {
      result.push({ id: value.id, event: eventFromData(value.event) })
    }
  }
  return result
}

function thresholdEventIds(familyId: string, childId: string, dayKey: string): readonly string[] {
  return [
    dailyGoalEventId(familyId, childId, dayKey),
    dailyGoalRevocationEventId(familyId, childId, dayKey),
    perfectDayEventId(familyId, childId, dayKey),
    perfectDayRevocationEventId(familyId, childId, dayKey),
  ]
}

function summaryFromData(data: DocumentData): GamificationSummaryV1 {
  return {
    ...data,
    foldedThrough: cursorFromData(data.foldedThrough),
    earliestDirtyCursor: cursorFromData(data.earliestDirtyCursor),
    updatedAt: millis(data.updatedAt, 'summary updatedAt'),
  } as GamificationSummaryV1
}

function summaryToData(summary: GamificationSummaryV1): DocumentData {
  return {
    ...summary,
    foldedThrough: cursorToData(summary.foldedThrough),
    earliestDirtyCursor: cursorToData(summary.earliestDirtyCursor),
    updatedAt: timestamp(summary.updatedAt),
  }
}

function compareCursor(left: SemanticCursorV1, right: SemanticCursorV1): number {
  return left.effectiveAt - right.effectiveAt
    || (left.causalGroupId < right.causalGroupId ? -1 : left.causalGroupId > right.causalGroupId ? 1 : 0)
    || left.transitionRank - right.transitionRank
    || (left.documentId < right.documentId ? -1 : left.documentId > right.documentId ? 1 : 0)
}

function cursorForEvent(document: GamificationEventDocumentV1): SemanticCursorV1 {
  return { effectiveAt: document.event.effectiveAt, causalGroupId: document.event.causalGroupId, transitionRank: document.event.transitionRank, documentId: document.id }
}

function earliestCursor(cursors: readonly SemanticCursorV1[]): SemanticCursorV1 | null {
  return cursors.length === 0 ? null : [...cursors].sort(compareCursor)[0]
}

function latestCursor(cursors: readonly SemanticCursorV1[]): SemanticCursorV1 | null {
  return cursors.length === 0 ? null : [...cursors].sort(compareCursor).at(-1)!
}

function syntheticEffects(progress: DailyProgressV1 | undefined, snapshot: DailyEligibilitySnapshotV1): TaskGamificationEffectV1[] {
  if (progress === undefined) return []
  return progress.contributingLogicalCompletionKeys.map(key => {
    const [, childId, taskId, periodKey] = key.split('|')
    const weight = snapshot.taskWeights[taskId]
    return {
      schemaVersion: 1, familyId: snapshot.familyId, childId, taskId, logicalCompletionKey: key, periodKey,
      dayKey: snapshot.dayKey, timezone: snapshot.timezone, pointsReward: weight, xpAward: weight,
      rewardPointsAward: weight, dailyWeight: weight, requiresApproval: true, approvedAt: 0,
    }
  })
}

function eventMap(documents: readonly GamificationEventDocumentV1[]): GamificationEventDocumentV1[] {
  const byId = new Map<string, GamificationEventDocumentV1>()
  for (const document of documents) byId.set(document.id, document)
  return [...byId.values()]
}

function defaultSummary(familyId: string, childId: string, processingAt: number): GamificationSummaryV1 {
  return {
    schemaVersion: 1, familyId, childId, xpTotal: 0, level: 1, currentStreak: 0, bestStreak: 0,
    perfectDayCount: 0, lastQualifiedDayKey: null, projectionRevision: 0, foldedThrough: null,
    rebuildRequired: false, earliestDirtyCursor: null, projectionStatus: 'ready', updatedAt: processingAt,
  }
}

function projectSummary(
  current: GamificationSummaryV1 | undefined,
  familyId: string,
  childId: string,
  newEvents: readonly GamificationEventDocumentV1[],
  progress: DailyProgressV1,
  processingAt: number,
  additionalAuthorityCursors: readonly SemanticCursorV1[] = [],
): GamificationSummaryV1 {
  const base = current ?? defaultSummary(familyId, childId, processingAt)
  const eventCursors = newEvents.map(cursorForEvent)
  const cursors = [...eventCursors, ...additionalAuthorityCursors]
  const first = earliestCursor(cursors)
  const last = latestCursor(cursors)
  const historical = first !== null && base.foldedThrough !== null && compareCursor(first, base.foldedThrough) <= 0
  const affectsHistoricalDay = newEvents.some(document =>
    document.event.eventType.endsWith('_qualification_changed')
      && base.lastQualifiedDayKey !== null
      && document.event.dayKey !== undefined
      && document.event.dayKey < base.lastQualifiedDayKey)
  const existingDirty = base.rebuildRequired || base.earliestDirtyCursor !== null
  const dirtyCursor = earliestCursor([
    ...(base.earliestDirtyCursor === null ? [] : [base.earliestDirtyCursor]),
    ...(historical && first !== null ? [first] : []),
    ...(affectsHistoricalDay && first !== null ? [first] : []),
  ])
  const xpDelta = newEvents.reduce((total, document) => total + document.event.xpDelta, 0)
  const nextXp = base.xpTotal + xpDelta
  if (!Number.isSafeInteger(nextXp) || nextXp < 0) throw new Error('Gamification summary XP would become invalid')
  const perfectTransitions = newEvents.filter(document => document.event.eventType === 'perfect_day_qualification_changed')
  const perfectDelta = perfectTransitions.reduce((delta, document) => delta + (document.event.qualificationState === 'qualified' ? 1 : -1), 0)
  const dailyTransitions = newEvents.filter(document => document.event.eventType === 'daily_goal_qualification_changed')
  const latestDaily = dailyTransitions.at(-1)?.event.qualificationState
  let currentStreak = base.currentStreak
  let lastQualifiedDayKey = base.lastQualifiedDayKey
  if (!affectsHistoricalDay && latestDaily === 'unqualified') {
    currentStreak = 0
    lastQualifiedDayKey = null
  } else if (!affectsHistoricalDay && latestDaily === 'qualified') {
    if (base.lastQualifiedDayKey !== progress.dayKey) {
      currentStreak = base.lastQualifiedDayKey !== null && addFamilyDays(base.lastQualifiedDayKey, 1) === progress.dayKey
        ? base.currentStreak + 1 : 1
    }
    lastQualifiedDayKey = progress.dayKey
  }
  const dirty = existingDirty || historical || affectsHistoricalDay
  return {
    ...base,
    xpTotal: nextXp,
    level: levelForXp(nextXp, 1000),
    currentStreak,
    bestStreak: Math.max(base.bestStreak, currentStreak),
    perfectDayCount: Math.max(0, base.perfectDayCount + perfectDelta),
    lastQualifiedDayKey,
    projectionRevision: base.projectionRevision + 1,
    foldedThrough: historical ? base.foldedThrough : (last ?? base.foldedThrough),
    rebuildRequired: dirty,
    earliestDirtyCursor: dirtyCursor,
    projectionStatus: dirty ? 'rebuilding' : 'ready',
    updatedAt: processingAt,
  }
}

function immutableReservationMatches(data: DocumentData, identity: {
  familyId: string; childId: string; taskId: string; logicalCompletionKey: string; periodKey: string; dayKey: string
}): boolean {
  if (data.schemaVersion !== 1 || data.familyId !== identity.familyId || data.childId !== identity.childId
    || data.taskId !== identity.taskId || data.logicalCompletionKey !== identity.logicalCompletionKey
    || data.periodKey !== identity.periodKey || data.dayKey !== identity.dayKey
    || data.effectId !== taskXpEventId(identity.logicalCompletionKey) || data.effectSnapshot === undefined) return false
  try {
    const effect = effectFromData(data.effectSnapshot)
    return effect.familyId === identity.familyId && effect.childId === identity.childId && effect.taskId === identity.taskId
      && effect.logicalCompletionKey === identity.logicalCompletionKey && effect.periodKey === identity.periodKey && effect.dayKey === identity.dayKey
      && effect.pointsReward === effect.xpAward && effect.pointsReward === effect.rewardPointsAward
  } catch {
    return false
  }
}

function canonicalEffect(effect: TaskGamificationEffectV1): string {
  return JSON.stringify([
    effect.schemaVersion, effect.familyId, effect.childId, effect.taskId, effect.logicalCompletionKey,
    effect.periodKey, effect.dayKey, effect.timezone, effect.pointsReward, effect.xpAward,
    effect.rewardPointsAward, effect.dailyWeight, effect.requiresApproval, effect.approvedAt,
  ])
}

function notificationId(key: string): string { return `gamification_task_approved:${encodeURIComponent(key)}` }
function feedId(key: string): string { return `gamification_task_approved:${encodeURIComponent(key)}` }

export class AdminGamificationRepository implements
  GamificationProcessorRepository,
  GamificationRepairRepository,
  GamificationSchedulerRepository {
  constructor(private readonly db: Firestore) {}

  /**
   * Dead-letter record for a non-transient processor failure. Written once per
   * completion (merge), so a redelivered event does not fan out records, and
   * never marks the award as processed.
   */
  async recordProcessorFailure(record: ProcessorFailureRecord): Promise<void> {
    console.error('[gamification-processor-failure]', JSON.stringify(record))
    await this.db.doc(`families/${record.familyId}/gamification_processor_failures/${record.completionId}`).set({
      schemaVersion: 1,
      familyId: record.familyId,
      completionId: record.completionId,
      ...(record.childId !== undefined ? { childId: record.childId } : {}),
      ...(record.taskId !== undefined ? { taskId: record.taskId } : {}),
      reason: record.reason,
      failedAt: timestamp(record.failedAt),
      processorVersion: record.processorVersion ?? GAMIFICATION_PROCESSOR_VERSION,
      retryable: false,
    }, { merge: true })
  }

  async processApprovedCompletion(args: ProcessApprovedCompletionArgs): Promise<GamificationProcessResult> {
    const familyRef = this.db.doc(`families/${args.familyId}`)
    const completionRef = familyRef.collection('task_completions').doc(args.completionId)
    return this.db.runTransaction(async transaction => {
      const [familyDocument, completionDocument] = await Promise.all([
        transaction.get(familyRef), transaction.get(completionRef),
      ])
      if (!familyDocument.exists) throw new Error(`Family ${args.familyId} does not exist`)
      if (!completionDocument.exists) throw new Error(`Completion ${args.completionId} does not exist`)
      const family = familyDocument.data()!
      const completion = completionDocument.data()!
      if (completion.status !== 'approved') return { status: 'ignored' }
      const migration = migrationState(family)
      if (!APPROVED_STATUSES.includes(migration.status)) {
        // A family stuck outside the ready states awards nothing while task
        // completion still appears to succeed to the user. Make that visible.
        // One warning per ignored completion — the transaction runs once per
        // completion, so this cannot loop.
        warnIgnoredCompletion({
          familyId: args.familyId,
          completionId: args.completionId,
          migrationStatus: migration.status,
          reason: 'migration_not_ready',
        })
        return { status: 'ignored' }
      }
      if (migration.cutoverAt === undefined) throw new Error('Prepared gamification migration requires cutoverAt')
      const approvedAt = millis(completion.approvedAt, 'completion approvedAt')
      if (approvedAt < migration.cutoverAt) return { status: 'ignored' }
      const childId = completion.assigneeId
      const taskId = completion.taskId
      if (typeof childId !== 'string' || typeof taskId !== 'string') throw new Error('Completion identity is invalid')
      const taskRef = familyRef.collection('tasks').doc(taskId)
      const childRef = this.db.doc(`users/${childId}`)
      const [taskDocument, childDocument] = await Promise.all([
        transaction.get(taskRef), transaction.get(childRef),
      ])
      if (!taskDocument.exists) throw new Error(`Task ${taskId} does not exist`)
      if (!childDocument.exists) throw new Error(`Child ${childId} does not exist`)
      const child = childDocument.data()!
      if (child.familyId !== args.familyId || child.role !== 'child' || child.status === 'deleted' || child.status === 'disabled' || child.disabled === true) {
        throw new DeterministicProcessorFailure('child_not_active_in_family', { childId, taskId })
      }
      const completedAt = millis(completion.completedAt, 'completion completedAt')
      const timezone = timezoneOf(family)
      const dayKey = familyDayKey(completedAt, timezone)
      const task = taskFromDocument(taskDocument)
      // Shared/family-wide tasks (no assigneeId) may be completed by any active
      // child in the family; an assigned task must match the completion child.
      if (!taskIsAwardableForChild(task, childId)) {
        throw new DeterministicProcessorFailure('task_assigned_to_another_child', { childId, taskId })
      }
      if (typeof task.pointsReward !== 'number' || !Number.isSafeInteger(task.pointsReward) || task.pointsReward < 0) {
        throw new Error(`Task ${taskId} has an invalid reward`)
      }
      const periodKey = authoritativePeriodKey(task, dayKey)
      const logicalKey = logicalCompletionKey(childId, taskId, periodKey)
      const occurrenceRef = familyRef.collection('task_occurrences').doc(logicalKey)
      const eligibilityRef = familyRef.collection('daily_eligibility').doc(`${childId}:${dayKey}`)
      const progressRef = familyRef.collection('daily_progress').doc(`${childId}:${dayKey}`)
      const summaryRef = familyRef.collection('gamification_summaries').doc(childId)
      const checkpointRef = familyRef.collection('gamification_checkpoints').doc(childId)
      const reversalRef = familyRef.collection('reversals').doc(`task_completion__${args.completionId}`)
      const [occurrenceDocument, eligibilityDocument, progressDocument, summaryDocument, checkpointDocument, reversalDocument] = await Promise.all([
        transaction.get(occurrenceRef), transaction.get(eligibilityRef), transaction.get(progressRef), transaction.get(summaryRef),
        transaction.get(checkpointRef), transaction.get(reversalRef),
      ])
      if (occurrenceDocument.exists) {
        if (!immutableReservationMatches(occurrenceDocument.data()!, {
          familyId: args.familyId, childId, taskId, logicalCompletionKey: logicalKey, periodKey, dayKey,
        })) throw new Error(`Occurrence ${logicalKey} has conflicting immutable identity`)
        return { status: 'duplicate', logicalCompletionKey: logicalKey }
      }

      // The family task collection is read in full and filtered in memory:
      // Firestore cannot express "assigneeId == childId OR assigneeId missing".
      const tasks = await transaction.get(familyRef.collection('tasks'))
      const config = resolveGamificationConfig(family.gamification)
      const expectedSnapshot = buildDailyEligibilitySnapshot({
        familyId: args.familyId, childId, dayKey, timezone, dailyGoalPercentage: config.dailyGoalPercentage,
        tasks: awardableTasks(tasks.docs, childId), effectiveAt: localDayStart(dayKey, timezone), createdAt: args.processingAt,
      })
      const snapshot = eligibilityDocument.exists ? eligibilityFromData(eligibilityDocument.data()!) : expectedSnapshot
      if (snapshot.familyId !== args.familyId || snapshot.childId !== childId || snapshot.dayKey !== dayKey || snapshot.timezone !== timezone
        || snapshot.eligibleTaskCount !== Object.keys(snapshot.taskWeights).length
        || snapshot.eligiblePoints !== Object.values(snapshot.taskWeights).reduce((sum, weight) => sum + weight, 0)) {
        throw new Error(`Daily eligibility ${eligibilityRef.id} has conflicting immutable content`)
      }
      const frozenWeight = snapshot.taskWeights[taskId]
      if (frozenWeight === undefined && task.pointsReward !== 0) throw new Error('Approved completion is not eligible in the immutable daily snapshot')
      const effect: TaskGamificationEffectV1 = {
        schemaVersion: 1, familyId: args.familyId, childId, taskId, logicalCompletionKey: logicalKey, periodKey, dayKey, timezone,
        pointsReward: task.pointsReward, xpAward: task.pointsReward, rewardPointsAward: task.pointsReward,
        dailyWeight: frozenWeight ?? 0, requiresApproval: task.requiresApproval === true, approvedAt,
      }
      if (completion.awardedPoints !== undefined && completion.awardedPoints !== effect.rewardPointsAward) {
        throw new Error('Existing completion awardedPoints conflicts with the trusted reward plan')
      }
      if (completion.gamificationEffectSnapshot !== undefined
        && canonicalEffect(effectFromData(completion.gamificationEffectSnapshot)) !== canonicalEffect(effect)) {
        throw new Error('Existing completion gamification effect conflicts with the immutable trusted plan')
      }
      const progress = progressDocument.exists ? progressFromData(progressDocument.data()!) : undefined
      const [taskAwardDocument, taskReversalDocument, ...thresholdDocuments] = await Promise.all([
        transaction.get(familyRef.collection('gamification_events').doc(taskXpEventId(logicalKey))),
        transaction.get(familyRef.collection('gamification_events').doc(taskXpReversalEventId(logicalKey))),
        ...thresholdEventIds(args.familyId, childId, dayKey)
          .map(id => transaction.get(familyRef.collection('gamification_events').doc(id))),
      ])
      const existingEvents = eventMap([
        ...qualificationEventsFromProgress(progressDocument.data()),
        ...(taskAwardDocument.exists ? [eventFromDocument(taskAwardDocument)] : []),
        ...(taskReversalDocument.exists ? [eventFromDocument(taskReversalDocument)] : []),
        ...thresholdDocuments.filter(document => document.exists).map(eventFromDocument),
      ])
      const priorEffects = syntheticEffects(progress, snapshot)
      const invalidatedKeys = new Set(progress?.invalidatedLogicalCompletionKeys ?? [])
      if (reversalDocument.exists) invalidatedKeys.add(logicalKey)
      const plan = planApprovedTask({
        completionId: args.completionId,
        effect,
        eligibilitySnapshot: snapshot,
        eligibilitySnapshotId: eligibilityRef.id,
        completionEffects: [...priorEffects.filter(prior => prior.logicalCompletionKey !== effect.logicalCompletionKey)
          .map((prior, index) => ({ completionId: `trusted-prior-${index}`, status: 'approved' as const, effect: prior })),
          { completionId: args.completionId, status: 'approved', effect }],
        invalidatedLogicalCompletionKeys: [...invalidatedKeys],
        existingEvents,
        existingEligibilitySnapshots: [snapshot],
        finalized: progress?.finalized ?? false,
        processingAt: args.processingAt,
      })
      const summary = projectSummary(summaryDocument.exists ? summaryFromData(summaryDocument.data()!) : undefined,
        args.familyId, childId, plan.events, plan.progress, args.processingAt,
        eligibilityDocument.exists ? [] : [{
          effectiveAt: snapshot.effectiveAt, causalGroupId: snapshot.causalGroupId,
          transitionRank: snapshot.transitionRank, documentId: eligibilityRef.id,
        }])
      const alreadyInvalid = reversalDocument.exists
      const currentPoints = child.rewardPoints ?? 0
      if (!Number.isSafeInteger(currentPoints) || currentPoints < 0) throw new Error('Child rewardPoints is invalid')
      const nextPoints = alreadyInvalid ? currentPoints : currentPoints + effect.rewardPointsAward
      if (!Number.isSafeInteger(nextPoints)) throw new Error('Child rewardPoints would exceed the safe integer range')

      if (!eligibilityDocument.exists) transaction.create(eligibilityRef, eligibilityToData(snapshot))
      transaction.create(occurrenceRef, {
        schemaVersion: 1, familyId: args.familyId, childId, taskId, logicalCompletionKey: logicalKey, periodKey,
        completionId: args.completionId, dayKey, effectId: taskXpEventId(logicalKey), effectSnapshot: effectToData(effect), createdAt: timestamp(args.processingAt),
      })
      transaction.update(completionRef, {
        awardedPoints: effect.rewardPointsAward,
        effectSnapshot: {
          schemaVersion: 1, entityType: 'task_completion', familyId: args.familyId,
          actorId: typeof completion.reviewedBy === 'string' ? completion.reviewedBy : childId,
          childId, pointsDelta: effect.rewardPointsAward, xpAdjustment: 0,
        },
        gamificationEffectSnapshot: effectToData(effect),
        gamificationDayKey: dayKey,
        gamificationProcessedAt: timestamp(args.processingAt),
        ...(alreadyInvalid ? { gamificationRewardRevokedBy: reversalRef.id } : {}),
      })
      if (nextPoints !== currentPoints) transaction.update(childRef, { rewardPoints: nextPoints, lastTaskCompletionId: args.completionId })
      for (const document of plan.events) transaction.create(familyRef.collection('gamification_events').doc(document.id), eventToData(document.event))
      transaction.set(progressRef, progressToData(plan.progress, [...existingEvents, ...plan.events]))
      transaction.set(summaryRef, summaryToData(summary))
      if (checkpointDocument.exists && checkpointDocument.data()!.dirty !== true) transaction.update(checkpointRef, { dirty: true })
      transaction.create(familyRef.collection('feed').doc(feedId(logicalKey)), {
        actorId: typeof completion.reviewedBy === 'string' ? completion.reviewedBy : childId,
        actorName: typeof completion.reviewedByName === 'string' ? completion.reviewedByName : 'Parent',
        type: 'custom', text: `Task approved: ${taskDocument.data()!.title ?? taskId} (+${effect.rewardPointsAward} pts)`,
        visibleTo: [childId], timestamp: timestamp(args.processingAt), entityType: 'task_completion', entityId: args.completionId,
        createdAt: timestamp(args.processingAt),
      })
      transaction.create(familyRef.collection('notifications').doc(notificationId(logicalKey)), {
        familyId: args.familyId, type: 'task_approved', actorId: typeof completion.reviewedBy === 'string' ? completion.reviewedBy : childId,
        recipientIds: [childId], title: 'Task approved', body: `${taskDocument.data()!.title ?? 'Task'} was approved. +${effect.rewardPointsAward} points`,
        entityType: 'task_completion', entityId: args.completionId, actionUrl: '/tasks', dedupeKey: notificationId(logicalKey), createdAt: timestamp(args.processingAt),
      })
      // V3 shadow write — atomic with the transaction.
      // Duplicate processing is idempotent: writeV3ShadowInTransaction checks
      // for an existing event and returns early if one exists.
      // If the V3 baseline is missing, the shadow write is best-effort: the
      // authoritative legacy write above is unaffected and the V3 projection
      // can be repaired later.
      try {
        await writeV3ShadowInTransaction(transaction, (path) => this.db.doc(path), {
          familyId: args.familyId,
          memberId: childId,
          event: mapTaskApproval({
            familyId: args.familyId,
            memberId: childId,
            taskId,
            logicalCompletionKey: logicalKey,
            pointsReward: effect.rewardPointsAward,
            xpAward: effect.xpAward,
            approvedAt: new Date(approvedAt).toISOString(),
            createdAt: new Date(args.processingAt).toISOString(),
          }),
          weeklyContext: DEFAULT_WEEKLY_CONTEXT,
          asOf: new Date(args.processingAt).toISOString(),
        })
      } catch (error) {
        if (error instanceof BaselineMissingErrorV3) {
          console.warn('[gamification-v3-shadow-skipped]', JSON.stringify({
            familyId: args.familyId, memberId: childId, processor: 'processApprovedCompletion',
          }))
        } else {
          throw error
        }
      }
      return { status: 'processed', logicalCompletionKey: logicalKey }
    })
  }

  async processTaskInvalidation(args: ProcessTaskInvalidationArgs): Promise<GamificationProcessResult> {
    const familyRef = this.db.doc(`families/${args.familyId}`)
    const completionRef = familyRef.collection('task_completions').doc(args.completionId)
    return this.db.runTransaction(async transaction => {
      const [familyDocument, completionDocument] = await Promise.all([transaction.get(familyRef), transaction.get(completionRef)])
      if (!familyDocument.exists || !completionDocument.exists) throw new Error('Invalidation source does not exist')
      const family = familyDocument.data()!
      if (!APPROVED_STATUSES.includes(migrationState(family).status)) return { status: 'ignored' }
      const completion = completionDocument.data()!
      if (completion.gamificationEffectSnapshot === undefined) return { status: 'ignored' }
      const effect = effectFromData(completion.gamificationEffectSnapshot)
      if (effect.familyId !== args.familyId) throw new Error('Invalidation effect belongs to another family')
      const childRef = this.db.doc(`users/${effect.childId}`)
      const eligibilityRef = familyRef.collection('daily_eligibility').doc(`${effect.childId}:${effect.dayKey}`)
      const progressRef = familyRef.collection('daily_progress').doc(`${effect.childId}:${effect.dayKey}`)
      const summaryRef = familyRef.collection('gamification_summaries').doc(effect.childId)
      const checkpointRef = familyRef.collection('gamification_checkpoints').doc(effect.childId)
      const [childDocument, eligibilityDocument, progressDocument, summaryDocument, checkpointDocument] = await Promise.all([
        transaction.get(childRef), transaction.get(eligibilityRef), transaction.get(progressRef), transaction.get(summaryRef), transaction.get(checkpointRef),
      ])
      if (!childDocument.exists || childDocument.data()!.familyId !== args.familyId) throw new Error('Invalidation child belongs to another family')
      if (!eligibilityDocument.exists) throw new Error('Invalidation is missing immutable eligibility')
      const snapshot = eligibilityFromData(eligibilityDocument.data()!)
      const progress = progressDocument.exists ? progressFromData(progressDocument.data()!) : undefined
      const [taskAwardDocument, taskReversalDocument, ...thresholdDocuments] = await Promise.all([
        transaction.get(familyRef.collection('gamification_events').doc(taskXpEventId(effect.logicalCompletionKey))),
        transaction.get(familyRef.collection('gamification_events').doc(taskXpReversalEventId(effect.logicalCompletionKey))),
        ...thresholdEventIds(args.familyId, effect.childId, effect.dayKey)
          .map(id => transaction.get(familyRef.collection('gamification_events').doc(id))),
      ])
      const existingEvents = eventMap([
        ...qualificationEventsFromProgress(progressDocument.data()),
        ...(taskAwardDocument.exists ? [eventFromDocument(taskAwardDocument)] : []),
        ...(taskReversalDocument.exists ? [eventFromDocument(taskReversalDocument)] : []),
        ...thresholdDocuments.filter(document => document.exists).map(eventFromDocument),
      ])
      const invalidated = new Set(progress?.invalidatedLogicalCompletionKeys ?? [])
      invalidated.add(effect.logicalCompletionKey)
      const plan = planTaskReversal({
        completionId: args.completionId,
        effect,
        eligibilitySnapshot: snapshot,
        eligibilitySnapshotId: eligibilityRef.id,
        completionEffects: [...syntheticEffects(progress, snapshot).filter(prior => prior.logicalCompletionKey !== effect.logicalCompletionKey)
          .map((prior, index) => ({ completionId: `trusted-prior-${index}`, status: 'approved' as const, effect: prior })),
          { completionId: args.completionId, status: 'approved', effect }],
        invalidatedLogicalCompletionKeys: [...invalidated],
        existingEvents,
        existingEligibilitySnapshots: [snapshot],
        finalized: progress?.finalized ?? false,
        processingAt: args.processingAt,
        ...(args.immutableReversalId !== undefined ? { immutableReversalId: args.immutableReversalId } : {
          authoritativeStatusChangedAt: optionalMillis(completion.cancelledAt ?? completion.invalidatedAt, 'completion status change') ?? args.processingAt,
        }),
      })
      if (plan.events.length === 0 && taskReversalDocument.exists) return { status: 'duplicate', logicalCompletionKey: effect.logicalCompletionKey }
      const summary = projectSummary(summaryDocument.exists ? summaryFromData(summaryDocument.data()!) : undefined,
        args.familyId, effect.childId, plan.events, plan.progress, args.processingAt)
      const child = childDocument.data()!
      const currentPoints = child.rewardPoints ?? 0
      const legacyAlreadyReversed = args.immutableReversalId !== undefined && child.lastReversalId === args.immutableReversalId
      const processorAlreadyReversed = completion.gamificationRewardRevokedBy !== undefined
      if (!legacyAlreadyReversed && !processorAlreadyReversed) {
        const nextPoints = currentPoints - effect.rewardPointsAward
        if (!Number.isSafeInteger(nextPoints) || nextPoints < 0) throw new Error('Task invalidation would make rewardPoints invalid')
        transaction.update(childRef, { rewardPoints: nextPoints })
      }
      for (const document of plan.events) transaction.create(familyRef.collection('gamification_events').doc(document.id), eventToData(document.event))
      transaction.set(progressRef, progressToData(plan.progress, [...existingEvents, ...plan.events]))
      transaction.set(summaryRef, summaryToData(summary))
      transaction.update(completionRef, { gamificationRewardRevokedBy: args.immutableReversalId ?? `status:${completion.status}`, gamificationInvalidatedAt: timestamp(args.processingAt) })
      if (checkpointDocument.exists && checkpointDocument.data()!.dirty !== true) transaction.update(checkpointRef, { dirty: true })
      return { status: 'processed', logicalCompletionKey: effect.logicalCompletionKey }
    })
  }

  async listFamiliesForFinalization(_processingAt: number): Promise<readonly string[]> {
    return (await this.db.collection('families').get()).docs
      .filter(document => APPROVED_STATUSES.includes(migrationState(document.data()).status))
      .map(document => document.id)
  }

  async finalizeFamilyDay(args: FinalizeFamilyDayArgs): Promise<FinalizeFamilyDayResult> {
    const familyRef = this.db.doc(`families/${args.familyId}`)
    const family = await familyRef.get()
    if (!family.exists || !APPROVED_STATUSES.includes(migrationState(family.data()!).status)) return { snapshotsCreated: 0, daysFinalized: 0 }
    const timezone = timezoneOf(family.data()!)
    const currentDay = familyDayKey(args.processingAt, timezone)
    const dayKey = args.dayKey ?? familyDayKey(localDayStart(currentDay, timezone) - 1, timezone)
    const children = await this.db.collection('users').where('familyId', '==', args.familyId).where('role', '==', 'child').get()
    let snapshotsCreated = 0
    let daysFinalized = 0
    for (const child of children.docs) {
      if (child.data().status === 'deleted' || child.data().status === 'disabled' || child.data().disabled === true) continue
      const result = await this.finalizeChildDay(args.familyId, child.id, dayKey, args.processingAt)
      snapshotsCreated += result.snapshotCreated ? 1 : 0
      daysFinalized += result.finalized ? 1 : 0
    }
    await this.advancePreparedMigrationIfReady(args.familyId, args.processingAt)
    return { snapshotsCreated, daysFinalized }
  }

  private async finalizeChildDay(familyId: string, childId: string, dayKey: string, processingAt: number): Promise<{ snapshotCreated: boolean; finalized: boolean }> {
    const familyRef = this.db.doc(`families/${familyId}`)
    return this.db.runTransaction(async transaction => {
      const familyDocument = await transaction.get(familyRef)
      const family = familyDocument.data()!
      const timezone = timezoneOf(family)
      const eligibilityRef = familyRef.collection('daily_eligibility').doc(`${childId}:${dayKey}`)
      const progressRef = familyRef.collection('daily_progress').doc(`${childId}:${dayKey}`)
      const summaryRef = familyRef.collection('gamification_summaries').doc(childId)
      const checkpointRef = familyRef.collection('gamification_checkpoints').doc(childId)
      const [eligibilityDocument, progressDocument, summaryDocument, checkpointDocument, tasks] = await Promise.all([
        transaction.get(eligibilityRef), transaction.get(progressRef), transaction.get(summaryRef), transaction.get(checkpointRef),
        transaction.get(familyRef.collection('tasks')),
      ])
      const snapshot = eligibilityDocument.exists ? eligibilityFromData(eligibilityDocument.data()!) : buildDailyEligibilitySnapshot({
        familyId, childId, dayKey, timezone, dailyGoalPercentage: resolveGamificationConfig(family.gamification).dailyGoalPercentage,
        tasks: awardableTasks(tasks.docs, childId), effectiveAt: localDayStart(dayKey, timezone), createdAt: processingAt,
      })
      const priorProgress = progressDocument.exists ? progressFromData(progressDocument.data()!) : undefined
      if (priorProgress?.finalized === true) return { snapshotCreated: false, finalized: false }
      const progress = calculateDailyProgress({
        eligibilitySnapshot: snapshot, eligibilitySnapshotId: eligibilityRef.id,
        completionEffects: syntheticEffects(priorProgress, snapshot).map((effect, index) => ({ completionId: `trusted-${index}`, status: 'approved', effect })),
        invalidatedLogicalCompletionKeys: priorProgress?.invalidatedLogicalCompletionKeys ?? [], finalized: true, calculatedAt: processingAt,
      })
      const thresholdDocuments = await Promise.all(thresholdEventIds(familyId, childId, dayKey)
        .map(id => transaction.get(familyRef.collection('gamification_events').doc(id))))
      const existingEvents = eventMap([
        ...qualificationEventsFromProgress(progressDocument.data()),
        ...thresholdDocuments.filter(document => document.exists).map(eventFromDocument),
      ])
      const events = planThresholdEvents({
        progress, sourceTransitionId: finalizationSourceTransitionId(eligibilityRef.id), effectiveAt: processingAt, existingEvents,
      })
      const summary = projectSummary(summaryDocument.exists ? summaryFromData(summaryDocument.data()!) : undefined,
        familyId, childId, events, progress, processingAt,
        eligibilityDocument.exists ? [] : [{
          effectiveAt: snapshot.effectiveAt, causalGroupId: snapshot.causalGroupId,
          transitionRank: snapshot.transitionRank, documentId: eligibilityRef.id,
        }])
      if (!eligibilityDocument.exists) transaction.create(eligibilityRef, eligibilityToData(snapshot))
      for (const document of events) transaction.create(familyRef.collection('gamification_events').doc(document.id), eventToData(document.event))
      transaction.set(progressRef, progressToData(progress, [...existingEvents, ...events]))
      transaction.set(summaryRef, summaryToData(summary))
      if (checkpointDocument.exists && checkpointDocument.data()!.dirty !== true) transaction.update(checkpointRef, { dirty: true })
      // V3 shadow writes for DAILY_GOAL_AWARDED and PERFECT_DAY_AWARDED events.
      // These are emitted when the corresponding V2 threshold qualification events
      // are created with 'qualified' state, inside the same authoritative transaction.
      for (const document of events) {
        if (document.event.eventType === 'daily_goal_qualification_changed'
          && document.event.qualificationState === 'qualified') {
          await writeV3ShadowInTransaction(transaction, (path) => this.db.doc(path), {
            familyId,
            memberId: childId,
            event: mapDailyGoal({
              familyId,
              memberId: childId,
              dayKey,
              xpAward: 25,
              rewardPointsAward: 0,
              weeklyPointsAward: 0,
              awardedAt: new Date(processingAt).toISOString(),
            }),
            weeklyContext: DEFAULT_WEEKLY_CONTEXT,
            asOf: new Date(processingAt).toISOString(),
          })
        }
        if (document.event.eventType === 'perfect_day_qualification_changed'
          && document.event.qualificationState === 'qualified') {
          await writeV3ShadowInTransaction(transaction, (path) => this.db.doc(path), {
            familyId,
            memberId: childId,
            event: mapPerfectDay({
              familyId,
              memberId: childId,
              dayKey,
              xpAward: 50,
              rewardPointsAward: 0,
              weeklyPointsAward: 0,
              awardedAt: new Date(processingAt).toISOString(),
            }),
            weeklyContext: DEFAULT_WEEKLY_CONTEXT,
            asOf: new Date(processingAt).toISOString(),
          })
        }
      }
      return { snapshotCreated: !eligibilityDocument.exists, finalized: true }
    })
  }

  private async advancePreparedMigrationIfReady(familyId: string, processingAt: number): Promise<void> {
    const familyRef = this.db.doc(`families/${familyId}`)
    const family = await familyRef.get()
    if (!family.exists || migrationState(family.data()!).status !== 'prepared') return
    const children = await this.db.collection('users').where('familyId', '==', familyId).where('role', '==', 'child').get()
    for (const child of children.docs) {
      const lifetimeXp = child.data().lifetimeXP
      if (Number.isSafeInteger(lifetimeXp) && lifetimeXp > 0) {
        const baseline = await familyRef.collection('gamification_events').doc(`legacy_xp_baseline:${encodeURIComponent(familyId)}:${encodeURIComponent(child.id)}`).get()
        if (!baseline.exists) return
      }
      const summary = await familyRef.collection('gamification_summaries').doc(child.id).get()
      if (summary.exists && (summary.data()!.rebuildRequired === true || summary.data()!.projectionStatus !== 'ready')) return
    }
    await this.db.runTransaction(async transaction => {
      const latest = await transaction.get(familyRef)
      const state = migrationState(latest.data()!)
      if (state.status !== 'prepared') return
      transaction.update(familyRef, {
        gamificationMigration: {
          schemaVersion: 1, status: 'baseline_complete', cutoverAt: timestamp(state.cutoverAt!),
          migratedAt: timestamp(processingAt), repairBoundaryAt: timestamp(processingAt),
        },
      })
    })
  }

  async repairGamificationPage(args: RepairGamificationPageArgs): Promise<RepairPageResult> {
    const familyRef = this.db.doc(`families/${args.familyId}`)
    const checkpointRef = familyRef.collection('gamification_checkpoints').doc(args.childId)
    let checkpointDocument = await checkpointRef.get()
    let checkpoint: StoredCheckpoint
    let restarted = false
    if (!checkpointDocument.exists || checkpointDocument.data()!.dirty === true) {
      const generationId = `generation:${args.processingAt}:${args.childId}`
      checkpoint = {
        schemaVersion: 1, familyId: args.familyId, childId: args.childId, generationId,
        watermarkAt: timestamp(args.processingAt), dirty: false, eligibilityCursor: null, eventCursor: null,
        pendingRecords: [], accumulatedEligibility: [], accumulatedEvents: [],
      }
      await checkpointRef.set(checkpoint)
      checkpointDocument = await checkpointRef.get()
      restarted = true
    }
    checkpoint = checkpointDocument.data() as StoredCheckpoint
    const eligibilityQuery = this.rebuildQuery(familyRef.collection('daily_eligibility'), args.childId, checkpoint.watermarkAt, checkpoint.eligibilityCursor)
    const eventQuery = this.rebuildQuery(familyRef.collection('gamification_events'), args.childId, checkpoint.watermarkAt, checkpoint.eventCursor)
    const [eligibilityPage, eventPage] = await Promise.all([eligibilityQuery.get(), eventQuery.get()])
    const recordsRead = eligibilityPage.size + eventPage.size
    if (recordsRead > args.maxRecords) throw new Error('Rebuild page exceeded the 250-record hard limit')
    const eligibilityRecords = eligibilityPage.docs.map(document => this.rebuildRecord(document, 'eligibility'))
    const eventRecords = eventPage.docs.map(document => this.rebuildRecord(document, 'event'))
    const pending = checkpoint.pendingRecords.map(record => ({
      ...record, effectiveAt: millis(record.effectiveAt, 'pending rebuild effectiveAt'), value: record.value,
    } as RebuildRecord))
    const merged = mergeRebuildStreams(pending, mergeRebuildStreams(eligibilityRecords, eventRecords))
    const exhausted = eligibilityPage.size < REBUILD_STREAM_LIMIT && eventPage.size < REBUILD_STREAM_LIMIT
    const uncertainBoundaries = [
      ...(eligibilityPage.size === REBUILD_STREAM_LIMIT ? [eligibilityRecords.at(-1)!] : []),
      ...(eventPage.size === REBUILD_STREAM_LIMIT ? [eventRecords.at(-1)!] : []),
    ].sort((left, right) => left.effectiveAt - right.effectiveAt
      || (left.causalGroupId < right.causalGroupId ? -1 : left.causalGroupId > right.causalGroupId ? 1 : 0)
      || left.transitionRank - right.transitionRank
      || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    const safeBoundary = uncertainBoundaries[0]
    const safe = safeBoundary === undefined ? merged : merged.filter(record =>
      record.effectiveAt < safeBoundary.effectiveAt
      || (record.effectiveAt === safeBoundary.effectiveAt && (
        record.causalGroupId < safeBoundary.causalGroupId
        || (record.causalGroupId === safeBoundary.causalGroupId && (
          record.transitionRank < safeBoundary.transitionRank
          || (record.transitionRank === safeBoundary.transitionRank && record.id <= safeBoundary.id))))))
    const deferred = safeBoundary === undefined ? [] : merged.slice(safe.length)
    const grouped = takeCompleteCausalGroups(safe, exhausted && deferred.length === 0)
    const pendingNext = mergeRebuildStreams(grouped.pending, deferred)
    const completeEligibility = grouped.complete.filter(record => record.stream === 'eligibility').map(record => record.value as DocumentData)
    const completeEvents = grouped.complete.filter(record => record.stream === 'event').map(record => ({ id: record.id, event: record.value as DocumentData }))
    const next: StoredCheckpoint = {
      ...checkpoint,
      eligibilityCursor: eligibilityPage.empty ? checkpoint.eligibilityCursor : this.storedCursor(eligibilityPage.docs.at(-1)!),
      eventCursor: eventPage.empty ? checkpoint.eventCursor : this.storedCursor(eventPage.docs.at(-1)!),
      pendingRecords: pendingNext.map(record => ({ ...record, effectiveAt: timestamp(record.effectiveAt), value: record.value as DocumentData })),
      accumulatedEligibility: [...checkpoint.accumulatedEligibility, ...completeEligibility],
      accumulatedEvents: [...checkpoint.accumulatedEvents, ...completeEvents],
    }
    if (!exhausted || pendingNext.length > 0) {
      await checkpointRef.set(next)
      return { status: restarted ? 'restarted' : 'checkpointed', recordsRead, generationId: checkpoint.generationId }
    }
    const eligibility = next.accumulatedEligibility.map(eligibilityFromData)
    const events = next.accumulatedEvents.map(document => ({ id: document.id, event: eventFromData(document.event) }))
    const summary = eligibility.length === 0 && events.length === 0
      ? defaultSummary(args.familyId, args.childId, args.processingAt)
      : rebuildGamificationSummary({ eligibilitySnapshots: eligibility, events, processingAt: args.processingAt })
    await this.db.runTransaction(async transaction => {
      const latest = await transaction.get(checkpointRef)
      if (!latest.exists || latest.data()!.generationId !== checkpoint.generationId || latest.data()!.dirty === true) return
      const summaryRef = familyRef.collection('gamification_summaries').doc(args.childId)
      const prior = await transaction.get(summaryRef)
      transaction.set(summaryRef, summaryToData({ ...summary, projectionRevision: (prior.data()?.projectionRevision ?? 0) + 1 }))
      transaction.delete(checkpointRef)
    })
    return { status: 'published', recordsRead, generationId: checkpoint.generationId }
  }

  private rebuildQuery(collection: FirebaseFirestore.CollectionReference, childId: string, watermark: Date | FirebaseFirestore.Timestamp, cursor: StoredCursor | null) {
    let query: FirebaseFirestore.Query = collection
      .where('childId', '==', childId)
      .where('effectiveAt', '<=', watermark)
      .orderBy('effectiveAt')
      .orderBy('causalGroupId')
      .orderBy('transitionRank')
      .orderBy('__name__')
    if (cursor !== null) query = query.startAfter(cursor.effectiveAt, cursor.causalGroupId, cursor.transitionRank, cursor.documentId)
    return query.limit(REBUILD_STREAM_LIMIT)
  }

  private rebuildRecord(document: QueryDocumentSnapshot, stream: 'eligibility' | 'event'): RebuildRecord {
    const data = document.data()
    return {
      id: document.id, effectiveAt: millis(data.effectiveAt, `${stream} effectiveAt`), causalGroupId: data.causalGroupId,
      transitionRank: data.transitionRank, stream, value: data,
    }
  }

  private storedCursor(document: QueryDocumentSnapshot): StoredCursor {
    const data = document.data()
    return { effectiveAt: data.effectiveAt, causalGroupId: data.causalGroupId, transitionRank: data.transitionRank, documentId: document.id }
  }

  async repairPostCutoverPage(args: RepairPostCutoverPageArgs): Promise<RepairPageResult> {
    const familyRef = this.db.doc(`families/${args.familyId}`)
    const familyDocument = await familyRef.get()
    if (!familyDocument.exists) throw new Error(`Family ${args.familyId} does not exist`)
    const migration = migrationState(familyDocument.data()!)
    if (migration.status !== 'baseline_complete' && migration.status !== 'active') return { status: 'waiting', recordsRead: 0 }
    if (migration.status === 'active') return { status: 'active', recordsRead: 0 }
    if (migration.cutoverAt === undefined) throw new Error('baseline_complete migration is missing cutoverAt')
    const boundary = migration.repairBoundaryAt ?? args.processingAt
    let query: FirebaseFirestore.Query = familyRef.collection('task_completions')
      .where('approvedAt', '>=', timestamp(migration.cutoverAt))
      .where('approvedAt', '<=', timestamp(boundary))
      .orderBy('approvedAt')
      .orderBy('__name__')
    if (migration.repairCheckpoint !== undefined) {
      const prior = await familyRef.collection('task_completions').doc(migration.repairCheckpoint).get()
      if (prior.exists) query = query.startAfter(prior.data()!.approvedAt, prior.id)
    }
    const page = await query.limit(args.maxRecords).get()
    for (const completion of page.docs) {
      await this.processApprovedCompletion({ familyId: args.familyId, completionId: completion.id, processingAt: args.processingAt })
    }
    if (page.size === args.maxRecords) {
      await familyRef.update({
        'gamificationMigration.repairCheckpoint': page.docs.at(-1)!.id,
        'gamificationMigration.repairBoundaryAt': timestamp(boundary),
      })
      return { status: 'checkpointed', recordsRead: page.size }
    }
    await this.db.runTransaction(async transaction => {
      const latest = await transaction.get(familyRef)
      const state = migrationState(latest.data()!)
      if (state.status !== 'baseline_complete') return
      transaction.update(familyRef, {
        gamificationMigration: {
          schemaVersion: 1, status: 'active', cutoverAt: timestamp(state.cutoverAt!), migratedAt: timestamp(args.processingAt),
          repairBoundaryAt: timestamp(boundary), repairCheckpoint: page.docs.at(-1)?.id ?? state.repairCheckpoint ?? null,
        },
      })
    })
    return { status: 'active', recordsRead: page.size }
  }
}

function eventFromData(data: DocumentData): GamificationEventV1 {
  return {
    ...data,
    effectiveAt: millis(data.effectiveAt, 'event effectiveAt'),
    createdAt: millis(data.createdAt, 'event createdAt'),
    ...(data.migratedAt !== undefined ? { migratedAt: millis(data.migratedAt, 'event migratedAt') } : {}),
  } as GamificationEventV1
}
