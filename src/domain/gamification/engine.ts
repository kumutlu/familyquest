import { GAMIFICATION_CONFIG_V1 } from './config'
import { calculateDailyProgress, type DailyProgressCompletionEffectV1 } from './dailyProgress'
import {
  calculatePerfectDayCount,
  dailyGoalEventId,
  dailyGoalQualificationEventId,
  dailyGoalRevocationEventId,
  planThresholdEvents,
  perfectDayEventId,
  perfectDayQualificationEventId,
  perfectDayRevocationEventId,
} from './perfectDay'
import { calculateStreak, compareCodeUnits, type GamificationEventDocumentV1 as StreakEventDocumentV1 } from './streak'
import {
  approvalSourceTransitionId,
  cancellationSourceTransitionId,
  causalGroupIdForTransition,
  invalidationSourceTransitionId,
  type DailyEligibilitySnapshotV1,
  type DailyProgressV1,
  type EngineTimestamp,
  type GamificationEventV1,
  type GamificationSummaryV1,
  type QualificationStateV1,
  type SemanticCursorV1,
  type TaskGamificationEffectV1,
} from './types'
import { levelForXp } from './level'
import { foldXpEvents, logicalCompletionKey, taskXpEventId, taskXpReversalEventId, type XpEventDocumentV1 } from './xp'

export type GamificationEventDocumentV1 = StreakEventDocumentV1

export interface GamificationWritePlan {
  readonly events: readonly GamificationEventDocumentV1[]
  readonly progress: DailyProgressV1
  readonly summary: GamificationSummaryV1
}

interface SharedTaskPlanInputV1 {
  readonly completionId: string
  readonly effect: TaskGamificationEffectV1
  readonly eligibilitySnapshot: DailyEligibilitySnapshotV1
  readonly eligibilitySnapshotId: string
  readonly completionEffects: readonly DailyProgressCompletionEffectV1[]
  readonly invalidatedLogicalCompletionKeys: readonly string[]
  readonly existingEvents: readonly GamificationEventDocumentV1[]
  readonly existingEligibilitySnapshots?: readonly DailyEligibilitySnapshotV1[]
  readonly finalized: boolean
  readonly processingAt: EngineTimestamp
}

export interface PlanApprovedTaskInputV1 extends SharedTaskPlanInputV1 {
  /** A later immutable fact that restores a same-day threshold without re-awarding task XP. */
  readonly qualificationSourceTransitionId?: string
}

export interface PlanTaskReversalInputV1 extends SharedTaskPlanInputV1 {
  readonly immutableReversalId?: string
  readonly authoritativeStatusChangedAt?: EngineTimestamp
}

export interface RebuildGamificationSummaryInputV1 {
  readonly events: readonly GamificationEventDocumentV1[]
  readonly eligibilitySnapshots: readonly DailyEligibilitySnapshotV1[]
  readonly processingAt: EngineTimestamp
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be non-empty`)
}

function assertEpoch(value: unknown, label: string): asserts value is EngineTimestamp {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative safe integer epoch millisecond value`)
}

function assertNonNegativeSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative safe integer`)
}

function assertLogicalKey(value: string, label: string): void {
  const parts = value.split('|')
  if (parts.length !== 4 || parts[0] !== 'task_v1') throw new Error(`${label} must use task_v1 canonical form`)
  for (const part of parts.slice(1)) {
    if (part.length === 0 || part.includes('/') || part.includes('|')) throw new Error(`${label} has an invalid component`)
  }
}

function assertEffect(effect: TaskGamificationEffectV1): void {
  if (effect.schemaVersion !== 1) throw new Error('immutable effect has an unsupported schema version')
  assertString(effect.familyId, 'immutable effect familyId')
  assertString(effect.childId, 'immutable effect childId')
  assertString(effect.taskId, 'immutable effect taskId')
  assertString(effect.periodKey, 'immutable effect periodKey')
  assertString(effect.dayKey, 'immutable effect dayKey')
  assertString(effect.timezone, 'immutable effect timezone')
  assertLogicalKey(effect.logicalCompletionKey, 'immutable effect logicalCompletionKey')
  if (effect.logicalCompletionKey !== logicalCompletionKey(effect.childId, effect.taskId, effect.periodKey)) {
    throw new Error('immutable effect logicalCompletionKey does not match its child/task/period identity')
  }
  assertNonNegativeSafeInteger(effect.pointsReward, 'immutable effect pointsReward')
  assertNonNegativeSafeInteger(effect.xpAward, 'immutable effect xpAward')
  assertNonNegativeSafeInteger(effect.rewardPointsAward, 'immutable effect rewardPointsAward')
  assertNonNegativeSafeInteger(effect.dailyWeight, 'immutable effect dailyWeight')
  assertEpoch(effect.approvedAt, 'immutable effect approvedAt')
  if (typeof effect.requiresApproval !== 'boolean') throw new Error('immutable effect requiresApproval must be boolean')
  if (effect.pointsReward !== effect.xpAward || effect.pointsReward !== effect.rewardPointsAward) {
    throw new Error('immutable effect reward, XP, and reward-point snapshots must agree')
  }
}

function assertEligibility(snapshot: DailyEligibilitySnapshotV1): void {
  if (snapshot.schemaVersion !== 1) throw new Error('eligibility snapshot has an unsupported schema version')
  assertString(snapshot.familyId, 'eligibility snapshot familyId')
  assertString(snapshot.childId, 'eligibility snapshot childId')
  assertString(snapshot.dayKey, 'eligibility snapshot dayKey')
  assertString(snapshot.timezone, 'eligibility snapshot timezone')
  assertEpoch(snapshot.effectiveAt, 'eligibility snapshot effectiveAt')
  assertEpoch(snapshot.createdAt, 'eligibility snapshot createdAt')
  if (!Number.isInteger(snapshot.dailyGoalPercentage) || snapshot.dailyGoalPercentage < 50 || snapshot.dailyGoalPercentage > 100) {
    throw new Error('eligibility snapshot has an invalid daily goal percentage')
  }
  let total = 0n
  for (const [taskId, weight] of Object.entries(snapshot.taskWeights)) {
    assertString(taskId, 'eligibility snapshot task ID')
    assertNonNegativeSafeInteger(weight, 'eligibility snapshot task weight')
    total += BigInt(weight)
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || snapshot.eligiblePoints !== Number(total)
    || snapshot.eligibleTaskCount !== Object.keys(snapshot.taskWeights).length) {
    throw new Error('eligibility snapshot aggregate fields do not match frozen weights')
  }
}

function assertEventDocument(document: GamificationEventDocumentV1): void {
  assertString(document.id, 'event document ID')
  const event = document.event
  if (event.schemaVersion !== 1) throw new Error('event has an unsupported schema version')
  assertString(event.familyId, 'event familyId')
  assertString(event.childId, 'event childId')
  assertString(event.idempotencyKey, 'event idempotencyKey')
  assertString(event.causalGroupId, 'event causalGroupId')
  assertEpoch(event.effectiveAt, 'event effectiveAt')
  assertEpoch(event.createdAt, 'event createdAt')
  if (!Number.isSafeInteger(event.xpDelta)) throw new Error('event xpDelta must be a safe integer')
  if (!Number.isInteger(event.transitionRank)) throw new Error('event transitionRank must be an integer')
}

function eventSemanticSnapshot(event: GamificationEventV1): string {
  const { createdAt: _createdAt, migratedAt: _migratedAt, ...semanticEvent } = event
  const entries = Object.entries(semanticEvent).filter(([, value]) => value !== undefined).sort(([a], [b]) => compareCodeUnits(a, b))
  return JSON.stringify(entries)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function uniqueEligibilitySnapshots(snapshots: readonly DailyEligibilitySnapshotV1[]): DailyEligibilitySnapshotV1[] {
  const byIdentity = new Map<string, DailyEligibilitySnapshotV1>()
  for (const snapshot of snapshots) {
    assertEligibility(snapshot)
    const identity = `${snapshot.familyId}\u0000${snapshot.childId}\u0000${snapshot.dayKey}`
    const prior = byIdentity.get(identity)
    if (prior !== undefined && canonicalJson(prior) !== canonicalJson(snapshot)) {
      throw new Error(`Conflicting immutable snapshot for ${snapshot.familyId}/${snapshot.childId}/${snapshot.dayKey}`)
    }
    if (prior === undefined) byIdentity.set(identity, snapshot)
  }
  return [...byIdentity.values()]
}

function documentsById(events: readonly GamificationEventDocumentV1[]): Map<string, GamificationEventDocumentV1> {
  const byId = new Map<string, GamificationEventDocumentV1>()
  for (const document of events) {
    assertEventDocument(document)
    const existing = byId.get(document.id)
    if (existing !== undefined && eventSemanticSnapshot(existing.event) !== eventSemanticSnapshot(document.event)) {
      throw new Error(`Event integrity error: conflicting immutable event ${document.id}`)
    }
    if (existing === undefined) byId.set(document.id, document)
  }
  return byId
}

function assertSharedInput(input: SharedTaskPlanInputV1): void {
  assertString(input.completionId, 'completionId')
  assertEpoch(input.processingAt, 'processingAt')
  assertString(input.eligibilitySnapshotId, 'eligibilitySnapshotId')
  assertEffect(input.effect)
  assertEligibility(input.eligibilitySnapshot)
  if (input.effect.familyId !== input.eligibilitySnapshot.familyId || input.effect.childId !== input.eligibilitySnapshot.childId
    || input.effect.dayKey !== input.eligibilitySnapshot.dayKey || input.effect.timezone !== input.eligibilitySnapshot.timezone) {
    throw new Error('immutable effect does not match the authoritative eligibility snapshot')
  }
  for (const key of input.invalidatedLogicalCompletionKeys) assertLogicalKey(key, 'invalidated logical completion key')
  for (const completionEffect of input.completionEffects) {
    assertString(completionEffect.completionId, 'completion effect completionId')
    if (!['pending_approval', 'approved', 'rejected', 'cancelled', 'invalidated'].includes(completionEffect.status)) {
      throw new Error('completion effect status must be a supported task completion status')
    }
    assertEffect(completionEffect.effect)
    if (completionEffect.effect.familyId !== input.effect.familyId || completionEffect.effect.childId !== input.effect.childId) {
      throw new Error('completion effect does not match the plan family/child')
    }
  }
  documentsById(input.existingEvents)
  for (const snapshot of input.existingEligibilitySnapshots ?? []) assertEligibility(snapshot)
}

function taskAward(effect: TaskGamificationEffectV1, sourceTransitionId: string, causalGroupId: string, effectiveAt: number): GamificationEventDocumentV1 {
  const id = taskXpEventId(effect.logicalCompletionKey)
  return {
    id,
    event: {
      schemaVersion: 1, familyId: effect.familyId, childId: effect.childId, eventType: 'xp_awarded', xpDelta: effect.xpAward,
      sourceType: 'task_completion', sourceId: effect.logicalCompletionKey, logicalCompletionKey: effect.logicalCompletionKey,
      idempotencyKey: id, causalGroupId, effectiveAt, transitionRank: 0, taskId: effect.taskId,
      configSchemaVersion: 1, createdBy: 'gamification-engine-v1', createdAt: effectiveAt, sourceTransitionId,
    },
  }
}

function taskRevocation(
  effect: TaskGamificationEffectV1,
  sourceTransitionId: string,
  causalGroupId: string,
  effectiveAt: number,
): GamificationEventDocumentV1 {
  const id = taskXpReversalEventId(effect.logicalCompletionKey)
  return {
    id,
    event: {
      schemaVersion: 1, familyId: effect.familyId, childId: effect.childId, eventType: 'xp_revoked', xpDelta: -effect.xpAward,
      sourceType: 'task_completion', sourceId: sourceTransitionId, logicalCompletionKey: effect.logicalCompletionKey,
      idempotencyKey: id, causalEventId: taskXpEventId(effect.logicalCompletionKey), causalGroupId, effectiveAt, transitionRank: 1,
      taskId: effect.taskId, configSchemaVersion: 1, createdBy: 'gamification-engine-v1', createdAt: effectiveAt, sourceTransitionId,
    },
  }
}

function qualificationEvent(
  kind: 'daily_goal' | 'perfect_day',
  state: QualificationStateV1,
  effect: TaskGamificationEffectV1,
  sourceTransitionId: string,
  causalGroupId: string,
  effectiveAt: number,
  transitionRank: number,
): GamificationEventDocumentV1 {
  const id = kind === 'daily_goal'
    ? dailyGoalQualificationEventId(effect.familyId, effect.childId, effect.dayKey, sourceTransitionId)
    : perfectDayQualificationEventId(effect.familyId, effect.childId, effect.dayKey, sourceTransitionId)
  return {
    id,
    event: {
      schemaVersion: 1, familyId: effect.familyId, childId: effect.childId, eventType: `${kind}_qualification_changed`, xpDelta: 0,
      sourceType: 'daily_progress', sourceId: sourceTransitionId, idempotencyKey: id, dayKey: effect.dayKey, timezone: effect.timezone,
      causalGroupId, effectiveAt, transitionRank, configSchemaVersion: 1, createdBy: 'gamification-engine-v1', createdAt: effectiveAt,
      sourceTransitionId, qualificationState: state,
    },
  }
}

function atomicRepairEvents(effect: TaskGamificationEffectV1): readonly GamificationEventDocumentV1[] {
  const approvalTransition = approvalSourceTransitionId(effect.logicalCompletionKey)
  const approvalGroup = causalGroupIdForTransition(approvalTransition)
  const repairTransition = invalidationSourceTransitionId(`repair:${encodeURIComponent(effect.logicalCompletionKey)}`)
  const effectiveAt = effect.approvedAt
  return [
    taskAward(effect, approvalTransition, approvalGroup, effectiveAt),
    taskRevocation(effect, repairTransition, approvalGroup, effectiveAt),
    qualificationEvent('daily_goal', 'qualified', effect, approvalTransition, approvalGroup, effectiveAt, 2),
    qualificationEvent('daily_goal', 'unqualified', effect, repairTransition, approvalGroup, effectiveAt, 3),
    qualificationEvent('perfect_day', 'qualified', effect, approvalTransition, approvalGroup, effectiveAt, 4),
    qualificationEvent('perfect_day', 'unqualified', effect, repairTransition, approvalGroup, effectiveAt, 5),
  ]
}

function progressFor(input: SharedTaskPlanInputV1): DailyProgressV1 {
  return calculateDailyProgress({
    eligibilitySnapshot: input.eligibilitySnapshot, eligibilitySnapshotId: input.eligibilitySnapshotId,
    completionEffects: input.completionEffects, invalidatedLogicalCompletionKeys: input.invalidatedLogicalCompletionKeys,
    finalized: input.finalized, calculatedAt: input.processingAt,
  })
}

function mergeSnapshots(input: SharedTaskPlanInputV1): DailyEligibilitySnapshotV1[] {
  return uniqueEligibilitySnapshots([...(input.existingEligibilitySnapshots ?? []), input.eligibilitySnapshot])
}

function planSummary(input: SharedTaskPlanInputV1, events: readonly GamificationEventDocumentV1[]): GamificationSummaryV1 {
  return rebuildGamificationSummary({ events: [...input.existingEvents, ...events], eligibilitySnapshots: mergeSnapshots(input), processingAt: input.processingAt })
}

function onlyUnwritten(
  existing: ReadonlyMap<string, GamificationEventDocumentV1>,
  planned: readonly GamificationEventDocumentV1[],
): GamificationEventDocumentV1[] {
  for (const document of planned) {
    const prior = existing.get(document.id)
    if (prior !== undefined && eventSemanticSnapshot(prior.event) !== eventSemanticSnapshot(document.event)) {
      throw new Error(`Event integrity error: existing ${document.id} does not match the immutable write plan`)
    }
  }
  return planned.filter((document) => !existing.has(document.id))
}

function assertExpectedExisting(
  existing: ReadonlyMap<string, GamificationEventDocumentV1>,
  expected: GamificationEventDocumentV1,
): void {
  const prior = existing.get(expected.id)
  if (prior !== undefined && eventSemanticSnapshot(prior.event) !== eventSemanticSnapshot(expected.event)) {
    throw new Error(`Event integrity error: existing ${expected.id} does not match its immutable semantic plan`)
  }
}

function assertRepairGroup(
  existing: ReadonlyMap<string, GamificationEventDocumentV1>,
  causalGroupId: string,
  expected: readonly GamificationEventDocumentV1[],
): void {
  const expectedById = new Map(expected.map((document) => [document.id, document]))
  for (const document of existing.values()) {
    if (document.event.causalGroupId !== causalGroupId) continue
    const expectedDocument = expectedById.get(document.id)
    if (expectedDocument === undefined) {
      throw new Error(`Event integrity error: unexpected immutable event ${document.id} in atomic repair group`)
    }
    if (eventSemanticSnapshot(document.event) !== eventSemanticSnapshot(expectedDocument.event)) {
      throw new Error(`Event integrity error: existing ${document.id} does not match the atomic repair group`)
    }
  }
}

function assertReusableTransitionEvent(
  document: GamificationEventDocumentV1,
  expected: Pick<GamificationEventV1,
    'eventType' | 'xpDelta' | 'sourceType' | 'logicalCompletionKey' | 'dayKey' | 'timezone' | 'causalEventId' | 'transitionRank' | 'taskId'>,
): void {
  const event = document.event
  if (document.id !== event.idempotencyKey || event.eventType !== expected.eventType || event.xpDelta !== expected.xpDelta
    || event.sourceType !== expected.sourceType || event.logicalCompletionKey !== expected.logicalCompletionKey
    || event.dayKey !== expected.dayKey || event.timezone !== expected.timezone || event.causalEventId !== expected.causalEventId
    || event.transitionRank !== expected.transitionRank || event.taskId !== expected.taskId || event.configSchemaVersion !== 1
    || event.createdBy !== 'gamification-engine-v1' || event.sourceTransitionId === undefined || event.sourceId !== event.sourceTransitionId
    || event.causalGroupId !== causalGroupIdForTransition(event.sourceTransitionId)) {
    throw new Error(`Event integrity error: existing ${document.id} has invalid immutable accounting fields`)
  }
}

function assertReusableThresholdEvents(
  existing: ReadonlyMap<string, GamificationEventDocumentV1>,
  progress: DailyProgressV1,
): void {
  const base = { logicalCompletionKey: undefined, dayKey: progress.dayKey, timezone: progress.timezone, taskId: undefined }
  const checks: readonly [string, Pick<GamificationEventV1,
    'eventType' | 'xpDelta' | 'sourceType' | 'logicalCompletionKey' | 'dayKey' | 'timezone' | 'causalEventId' | 'transitionRank' | 'taskId'>][] = [
    [dailyGoalEventId(progress.familyId, progress.childId, progress.dayKey), { ...base, eventType: 'daily_goal_awarded', xpDelta: GAMIFICATION_CONFIG_V1.dailyGoalBonusXp, sourceType: 'daily_progress', causalEventId: undefined, transitionRank: 0 }],
    [dailyGoalRevocationEventId(progress.familyId, progress.childId, progress.dayKey), { ...base, eventType: 'daily_goal_revoked', xpDelta: -GAMIFICATION_CONFIG_V1.dailyGoalBonusXp, sourceType: 'daily_progress', causalEventId: dailyGoalEventId(progress.familyId, progress.childId, progress.dayKey), transitionRank: 1 }],
    [perfectDayEventId(progress.familyId, progress.childId, progress.dayKey), { ...base, eventType: 'perfect_day_awarded', xpDelta: GAMIFICATION_CONFIG_V1.perfectDayBonusXp, sourceType: 'daily_progress', causalEventId: undefined, transitionRank: 3 }],
    [perfectDayRevocationEventId(progress.familyId, progress.childId, progress.dayKey), { ...base, eventType: 'perfect_day_revoked', xpDelta: -GAMIFICATION_CONFIG_V1.perfectDayBonusXp, sourceType: 'daily_progress', causalEventId: perfectDayEventId(progress.familyId, progress.childId, progress.dayKey), transitionRank: 4 }],
  ]
  for (const [id, expected] of checks) {
    const document = existing.get(id)
    if (document !== undefined) assertReusableTransitionEvent(document, expected)
  }
  for (const document of existing.values()) {
    if ((document.event.eventType === 'daily_goal_qualification_changed' || document.event.eventType === 'perfect_day_qualification_changed')
      && document.event.dayKey === progress.dayKey) {
      const rank = document.event.eventType === 'daily_goal_qualification_changed' ? 2 : 5
      assertReusableTransitionEvent(document, { ...base, eventType: document.event.eventType, xpDelta: 0,
        sourceType: 'daily_progress', causalEventId: undefined, transitionRank: rank })
      if (document.event.qualificationState !== 'qualified' && document.event.qualificationState !== 'unqualified') {
        throw new Error(`Event integrity error: existing ${document.id} has an invalid qualification state`)
      }
    }
  }
}

/** Plans one approved occurrence using frozen facts only; manual and auto paths deliberately share it. */
export function planApprovedTask(input: PlanApprovedTaskInputV1): Readonly<GamificationWritePlan> {
  assertSharedInput(input)
  const existing = documentsById(input.existingEvents)
  const approvalTransition = approvalSourceTransitionId(input.effect.logicalCompletionKey)
  const approvalGroup = causalGroupIdForTransition(approvalTransition)
  const effectiveAt = input.effect.approvedAt
  const expectedAward = taskAward(input.effect, approvalTransition, approvalGroup, effectiveAt)
  assertExpectedExisting(existing, expectedAward)
  const invalidated = input.invalidatedLogicalCompletionKeys.includes(input.effect.logicalCompletionKey)

  if (invalidated) {
    const planned = atomicRepairEvents(input.effect)
    assertRepairGroup(existing, approvalGroup, planned)
    const events = onlyUnwritten(existing, planned)
    const progress = progressFor(input)
    return Object.freeze({ events: Object.freeze(events), progress, summary: planSummary(input, events) })
  }

  const progress = progressFor(input)
  assertReusableThresholdEvents(existing, progress)
  const existingAward = existing.has(taskXpEventId(input.effect.logicalCompletionKey))
  if (input.qualificationSourceTransitionId !== undefined && !existingAward) {
    throw new Error('a qualification recovery source requires an existing immutable task award')
  }
  if (input.qualificationSourceTransitionId !== undefined) assertString(input.qualificationSourceTransitionId, 'qualificationSourceTransitionId')
  const thresholdTransition = input.qualificationSourceTransitionId ?? approvalTransition
  const thresholdEffectiveAt = input.qualificationSourceTransitionId === undefined ? effectiveAt : input.processingAt
  const planned = [
    ...(existingAward ? [] : [expectedAward]),
    ...planThresholdEvents({ progress, sourceTransitionId: thresholdTransition, effectiveAt: thresholdEffectiveAt, existingEvents: input.existingEvents }),
  ]
  const events = onlyUnwritten(existing, planned)
  return Object.freeze({ events: Object.freeze(events), progress, summary: planSummary(input, events) })
}

/** Plans a compensation only when its immutable award is already present. */
export function planTaskReversal(input: PlanTaskReversalInputV1): Readonly<GamificationWritePlan> {
  assertSharedInput(input)
  const existing = documentsById(input.existingEvents)
  const reversalTransition = input.immutableReversalId !== undefined
    ? invalidationSourceTransitionId(input.immutableReversalId)
    : cancellationSourceTransitionId(input.completionId, input.authoritativeStatusChangedAt ?? input.processingAt)
  const awardId = taskXpEventId(input.effect.logicalCompletionKey)
  const reversalId = taskXpReversalEventId(input.effect.logicalCompletionKey)
  const progress = progressFor(input)

  if (!existing.has(awardId)) {
    return Object.freeze({ events: Object.freeze([]), progress, summary: planSummary(input, []) })
  }

  assertExpectedExisting(existing, taskAward(input.effect, approvalSourceTransitionId(input.effect.logicalCompletionKey),
    causalGroupIdForTransition(approvalSourceTransitionId(input.effect.logicalCompletionKey)), input.effect.approvedAt))
  const existingReversal = existing.get(reversalId)
  const repair = atomicRepairEvents(input.effect)
  const repairReversal = repair.find((document) => document.id === reversalId)
  if (existingReversal !== undefined && repairReversal !== undefined
    && existingReversal.event.sourceTransitionId === repairReversal.event.sourceTransitionId
    && existingReversal.event.causalGroupId === repairReversal.event.causalGroupId) {
    assertRepairGroup(existing, repairReversal.event.causalGroupId, repair)
    const events = onlyUnwritten(existing, repair)
    return Object.freeze({ events: Object.freeze(events), progress, summary: planSummary(input, events) })
  }
  if (existingReversal !== undefined) {
    assertReusableTransitionEvent(existingReversal, {
      eventType: 'xp_revoked', xpDelta: -input.effect.xpAward, sourceType: 'task_completion',
      logicalCompletionKey: input.effect.logicalCompletionKey, dayKey: undefined, timezone: undefined,
      causalEventId: awardId, transitionRank: 1, taskId: input.effect.taskId,
    })
  }
  assertReusableThresholdEvents(existing, progress)

  const group = causalGroupIdForTransition(reversalTransition)
  // A reversal removes a previously observed qualification even before finalization;
  // finalization only creates misses where no compensation fact exists.
  const compensationProgress = progress.finalized ? progress : { ...progress, finalized: true }
  const planned = [
    ...(existing.has(reversalId) ? [] : [taskRevocation(input.effect, reversalTransition, group, input.processingAt)]),
    ...planThresholdEvents({ progress: compensationProgress, sourceTransitionId: reversalTransition, effectiveAt: input.processingAt, existingEvents: input.existingEvents }),
  ]
  const events = onlyUnwritten(existing, planned)
  return Object.freeze({ events: Object.freeze(events), progress, summary: planSummary(input, events) })
}

function cursorForEvent(document: GamificationEventDocumentV1): SemanticCursorV1 {
  return { effectiveAt: document.event.effectiveAt, causalGroupId: document.event.causalGroupId, transitionRank: document.event.transitionRank, documentId: document.id }
}

function cursorForSnapshot(snapshot: DailyEligibilitySnapshotV1): SemanticCursorV1 {
  return {
    effectiveAt: snapshot.effectiveAt, causalGroupId: snapshot.causalGroupId, transitionRank: snapshot.transitionRank,
    documentId: `daily_eligibility:${snapshot.familyId}:${snapshot.childId}:${snapshot.dayKey}`,
  }
}

function compareCursor(left: SemanticCursorV1, right: SemanticCursorV1): number {
  if (left.effectiveAt !== right.effectiveAt) return left.effectiveAt < right.effectiveAt ? -1 : 1
  const group = compareCodeUnits(left.causalGroupId, right.causalGroupId)
  if (group !== 0) return group
  if (left.transitionRank !== right.transitionRank) return left.transitionRank < right.transitionRank ? -1 : 1
  return compareCodeUnits(left.documentId, right.documentId)
}

/** Rebuilds the cache entirely from immutable events and eligibility facts. */
export function rebuildGamificationSummary(input: RebuildGamificationSummaryInputV1): Readonly<GamificationSummaryV1> {
  assertEpoch(input.processingAt, 'processingAt')
  const eligibilitySnapshots = uniqueEligibilitySnapshots(input.eligibilitySnapshots)
  const familyIds = new Set<string>()
  const childIds = new Set<string>()
  for (const document of input.events) {
    assertEventDocument(document)
    familyIds.add(document.event.familyId)
    childIds.add(document.event.childId)
  }
  for (const snapshot of eligibilitySnapshots) {
    familyIds.add(snapshot.familyId)
    childIds.add(snapshot.childId)
  }
  if (familyIds.size !== 1 || childIds.size !== 1) throw new Error('Summary rebuild requires immutable facts for exactly one family and child')

  const events = [...documentsById(input.events).values()]
  const xpTotal = foldXpEvents(events as readonly XpEventDocumentV1[])
  const streak = calculateStreak({ eligibilitySnapshots, events })
  const cursors = [...events.map(cursorForEvent), ...eligibilitySnapshots.map(cursorForSnapshot)].sort(compareCursor)
  return Object.freeze({
    schemaVersion: 1, familyId: [...familyIds][0], childId: [...childIds][0], xpTotal,
    level: levelForXp(xpTotal, GAMIFICATION_CONFIG_V1.xpPerLevel), currentStreak: streak.currentStreak,
    bestStreak: streak.bestStreak, perfectDayCount: calculatePerfectDayCount(events), lastQualifiedDayKey: streak.lastQualifiedDayKey,
    projectionRevision: 0, foldedThrough: cursors.at(-1) ?? null, rebuildRequired: false, earliestDirtyCursor: null,
    projectionStatus: 'ready', updatedAt: input.processingAt,
  })
}
