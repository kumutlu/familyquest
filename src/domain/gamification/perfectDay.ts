import { GAMIFICATION_CONFIG_V1 } from './config'
import { assertCausalGroupRecordCount, causalGroupIdForTransition, type DailyProgressV1, type GamificationEventV1 } from './types'
import { assertCausalGroupInvariants, compareCodeUnits, type GamificationEventDocumentV1 } from './streak'

export type ThresholdEventDocumentV1 = GamificationEventDocumentV1

export interface PlanThresholdEventsInputV1 {
  readonly progress: DailyProgressV1
  readonly sourceTransitionId: string
  readonly effectiveAt: number
  readonly existingEvents: readonly ThresholdEventDocumentV1[]
}

type Threshold = 'daily_goal' | 'perfect_day'

const transitionRanks: Readonly<Record<'daily_goal_awarded' | 'daily_goal_revoked' | 'daily_goal_qualification_changed' | 'perfect_day_awarded' | 'perfect_day_revoked' | 'perfect_day_qualification_changed', number>> = {
  daily_goal_awarded: 0,
  daily_goal_revoked: 1,
  daily_goal_qualification_changed: 2,
  perfect_day_awarded: 3,
  perfect_day_revoked: 4,
  perfect_day_qualification_changed: 5,
}

function assertComponent(value: string, label: string): void {
  if (value.length === 0 || value.includes('/')) throw new Error(`${label} must be non-empty and may not contain /`)
}

function encodeComponent(value: string, label: string): string {
  assertComponent(value, label)
  return encodeURIComponent(value)
}

function assertEpochMilliseconds(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('effectiveAt must be a non-negative safe integer epoch millisecond value')
}

export function dailyGoalEventId(familyId: string, childId: string, dayKey: string): string {
  return `daily_goal:${encodeComponent(familyId, 'familyId')}:${encodeComponent(childId, 'childId')}:${encodeComponent(dayKey, 'dayKey')}`
}

export function dailyGoalRevocationEventId(familyId: string, childId: string, dayKey: string): string {
  return `daily_goal_reversal:${encodeComponent(familyId, 'familyId')}:${encodeComponent(childId, 'childId')}:${encodeComponent(dayKey, 'dayKey')}`
}

export function perfectDayEventId(familyId: string, childId: string, dayKey: string): string {
  return `perfect_day:${encodeComponent(familyId, 'familyId')}:${encodeComponent(childId, 'childId')}:${encodeComponent(dayKey, 'dayKey')}`
}

export function perfectDayRevocationEventId(familyId: string, childId: string, dayKey: string): string {
  return `perfect_day_reversal:${encodeComponent(familyId, 'familyId')}:${encodeComponent(childId, 'childId')}:${encodeComponent(dayKey, 'dayKey')}`
}

function qualificationEventId(threshold: Threshold, familyId: string, childId: string, dayKey: string, sourceTransitionId: string): string {
  assertComponent(sourceTransitionId, 'sourceTransitionId')
  return `${threshold}_qualification:${encodeComponent(familyId, 'familyId')}:${encodeComponent(childId, 'childId')}:${encodeComponent(dayKey, 'dayKey')}:${sourceTransitionId}`
}

export function dailyGoalQualificationEventId(familyId: string, childId: string, dayKey: string, sourceTransitionId: string): string {
  return qualificationEventId('daily_goal', familyId, childId, dayKey, sourceTransitionId)
}

export function perfectDayQualificationEventId(familyId: string, childId: string, dayKey: string, sourceTransitionId: string): string {
  return qualificationEventId('perfect_day', familyId, childId, dayKey, sourceTransitionId)
}

function compareEvents(left: ThresholdEventDocumentV1, right: ThresholdEventDocumentV1): number {
  if (left.event.effectiveAt !== right.event.effectiveAt) return left.event.effectiveAt < right.event.effectiveAt ? -1 : 1
  const groupOrder = compareCodeUnits(left.event.causalGroupId, right.event.causalGroupId)
  if (groupOrder !== 0) return groupOrder
  if (left.event.transitionRank !== right.event.transitionRank) return left.event.transitionRank < right.event.transitionRank ? -1 : 1
  return compareCodeUnits(left.id, right.id)
}

function uniqueEvents(events: readonly ThresholdEventDocumentV1[]): ThresholdEventDocumentV1[] {
  const seenIds = new Set<string>()
  return events.filter(({ id }) => !seenIds.has(id) && (seenIds.add(id), true))
}

function qualificationByThreshold(
  events: readonly ThresholdEventDocumentV1[],
  threshold: Threshold,
  dayKey: string,
): 'qualified' | 'unqualified' | undefined {
  const unique = uniqueEvents(events)
  assertCausalGroupInvariants(unique.map(({ id, event }) => ({
    id, causalGroupId: event.causalGroupId, effectiveAt: event.effectiveAt, familyId: event.familyId, childId: event.childId,
  })))
  unique.sort(compareEvents)
  let state: 'qualified' | 'unqualified' | undefined
  for (let start = 0; start < unique.length;) {
    let end = start + 1
    while (end < unique.length && unique[end].event.causalGroupId === unique[start].event.causalGroupId) end += 1
    assertCausalGroupRecordCount(end - start)
    for (const { event } of unique.slice(start, end)) {
      if (event.eventType === `${threshold}_qualification_changed` && event.dayKey === dayKey && event.qualificationState !== undefined) {
        state = event.qualificationState
      }
    }
    start = end
  }
  return state
}

function eventWasEverPlanned(events: readonly ThresholdEventDocumentV1[], id: string): boolean {
  return events.some((document) => document.id === id)
}

function event(
  id: string,
  progress: DailyProgressV1,
  sourceTransitionId: string,
  effectiveAt: number,
  eventType: GamificationEventV1['eventType'],
  xpDelta: number,
  transitionRank: number,
  qualificationState?: 'qualified' | 'unqualified',
  causalEventId?: string,
): ThresholdEventDocumentV1 {
  return {
    id,
    event: {
      schemaVersion: 1,
      familyId: progress.familyId,
      childId: progress.childId,
      eventType,
      xpDelta,
      sourceType: 'daily_progress',
      sourceId: sourceTransitionId,
      idempotencyKey: id,
      dayKey: progress.dayKey,
      timezone: progress.timezone,
      causalEventId,
      causalGroupId: causalGroupIdForTransition(sourceTransitionId),
      effectiveAt,
      transitionRank,
      configSchemaVersion: 1,
      createdBy: 'gamification-engine-v1',
      createdAt: effectiveAt,
      sourceTransitionId,
      qualificationState,
    },
  }
}

function planForThreshold(
  threshold: Threshold,
  reached: boolean,
  input: PlanThresholdEventsInputV1,
): ThresholdEventDocumentV1[] {
  const { progress, sourceTransitionId, effectiveAt, existingEvents } = input
  const familyId = progress.familyId
  const childId = progress.childId
  const dayKey = progress.dayKey
  const awardId = threshold === 'daily_goal'
    ? dailyGoalEventId(familyId, childId, dayKey)
    : perfectDayEventId(familyId, childId, dayKey)
  const revocationId = threshold === 'daily_goal'
    ? dailyGoalRevocationEventId(familyId, childId, dayKey)
    : perfectDayRevocationEventId(familyId, childId, dayKey)
  const qualificationId = qualificationEventId(threshold, familyId, childId, dayKey, sourceTransitionId)
  const priorQualification = qualificationByThreshold(existingEvents, threshold, dayKey)
  const qualificationType = `${threshold}_qualification_changed` as GamificationEventV1['eventType']
  const events: ThresholdEventDocumentV1[] = []

  if (reached) {
    if (!eventWasEverPlanned(existingEvents, awardId)) {
      events.push(event(
        awardId, progress, sourceTransitionId, effectiveAt, `${threshold}_awarded` as GamificationEventV1['eventType'],
        threshold === 'daily_goal' ? GAMIFICATION_CONFIG_V1.dailyGoalBonusXp : GAMIFICATION_CONFIG_V1.perfectDayBonusXp,
        transitionRanks[`${threshold}_awarded` as keyof typeof transitionRanks],
      ))
    }
    if (priorQualification !== 'qualified' && !eventWasEverPlanned(existingEvents, qualificationId)) {
      events.push(event(qualificationId, progress, sourceTransitionId, effectiveAt, qualificationType, 0,
        transitionRanks[qualificationType as keyof typeof transitionRanks], 'qualified'))
    }
    return events
  }

  // Only immutable finalization may make an otherwise-missing eligible day unqualified.
  if (!progress.finalized) return events
  if (eventWasEverPlanned(existingEvents, awardId) && !eventWasEverPlanned(existingEvents, revocationId)) {
    events.push(event(revocationId, progress, sourceTransitionId, effectiveAt, `${threshold}_revoked` as GamificationEventV1['eventType'],
      threshold === 'daily_goal' ? -GAMIFICATION_CONFIG_V1.dailyGoalBonusXp : -GAMIFICATION_CONFIG_V1.perfectDayBonusXp,
      transitionRanks[`${threshold}_revoked` as keyof typeof transitionRanks], undefined, awardId))
  }
  if (priorQualification !== 'unqualified' && !eventWasEverPlanned(existingEvents, qualificationId)) {
    events.push(event(qualificationId, progress, sourceTransitionId, effectiveAt, qualificationType, 0,
      transitionRanks[qualificationType as keyof typeof transitionRanks], 'unqualified'))
  }
  return events
}

/** Plans immutable threshold awards, compensations, and qualification transitions for one source transition. */
export function planThresholdEvents(input: PlanThresholdEventsInputV1): readonly ThresholdEventDocumentV1[] {
  const { progress, sourceTransitionId, effectiveAt } = input
  assertComponent(sourceTransitionId, 'sourceTransitionId')
  assertEpochMilliseconds(effectiveAt)
  if (progress.eligiblePoints === 0) return []

  return [
    ...planForThreshold('daily_goal', progress.dailyGoalReached, input),
    ...planForThreshold('perfect_day', progress.perfectDayReached, input),
  ].sort(compareEvents)
}

/** Replays the latest Perfect Day qualification for each immutable local day. */
export function calculatePerfectDayCount(events: readonly ThresholdEventDocumentV1[]): number {
  const unique = uniqueEvents(events)
  assertCausalGroupInvariants(unique.map(({ id, event }) => ({
    id, causalGroupId: event.causalGroupId, effectiveAt: event.effectiveAt, familyId: event.familyId, childId: event.childId,
  })))
  unique.sort(compareEvents)
  const qualificationByDay = new Map<string, 'qualified' | 'unqualified'>()

  for (let start = 0; start < unique.length;) {
    let end = start + 1
    while (end < unique.length && unique[end].event.causalGroupId === unique[start].event.causalGroupId) end += 1
    assertCausalGroupRecordCount(end - start)
    for (const { event } of unique.slice(start, end)) {
      if (event.eventType === 'perfect_day_qualification_changed' && event.dayKey !== undefined && event.qualificationState !== undefined) {
        qualificationByDay.set(event.dayKey, event.qualificationState)
      }
    }
    start = end
  }

  return [...qualificationByDay.values()].filter((state) => state === 'qualified').length
}
