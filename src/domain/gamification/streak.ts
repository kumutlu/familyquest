import { addFamilyDays } from './dailyProgress'
import {
  assertCausalGroupRecordCount,
  type DailyEligibilitySnapshotV1,
  type GamificationEventV1,
} from './types'

export interface GamificationEventDocumentV1 {
  readonly id: string
  readonly event: GamificationEventV1
}

export interface CalculateStreakInputV1 {
  readonly eligibilitySnapshots: readonly DailyEligibilitySnapshotV1[]
  readonly events: readonly GamificationEventDocumentV1[]
}

export interface StreakProjectionV1 {
  readonly currentStreak: number
  readonly bestStreak: number
  readonly lastQualifiedDayKey: string | null
}

export interface CausalGroupRecordV1 {
  readonly id: string
  readonly causalGroupId: string
  readonly effectiveAt: number
  readonly familyId: string
  readonly childId: string
}

interface ReplayRecord extends CausalGroupRecordV1 {
  readonly transitionRank: number
  readonly event?: GamificationEventV1
}

/** Compares canonical identifiers by UTF-16 code units without locale collation. */
export function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function compareNumbers(left: number, right: number): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** A causal group is an atomic fact and cannot span children, families, or authoritative times. */
export function assertCausalGroupInvariants(records: readonly CausalGroupRecordV1[]): void {
  const metadataByGroup = new Map<string, Pick<CausalGroupRecordV1, 'effectiveAt' | 'familyId' | 'childId'>>()
  for (const record of records) {
    const existing = metadataByGroup.get(record.causalGroupId)
    if (existing === undefined) {
      metadataByGroup.set(record.causalGroupId, record)
      continue
    }
    if (existing.effectiveAt !== record.effectiveAt) {
      throw new Error(`Causal group ${record.causalGroupId} has inconsistent effectiveAt`)
    }
    if (existing.familyId !== record.familyId) {
      throw new Error(`Causal group ${record.causalGroupId} has inconsistent familyId`)
    }
    if (existing.childId !== record.childId) {
      throw new Error(`Causal group ${record.causalGroupId} has inconsistent childId`)
    }
  }
}

function compareRecords(left: ReplayRecord, right: ReplayRecord): number {
  return compareNumbers(left.effectiveAt, right.effectiveAt)
    || compareCodeUnits(left.causalGroupId, right.causalGroupId)
    || compareNumbers(left.transitionRank, right.transitionRank)
    || compareCodeUnits(left.id, right.id)
}

function eventRecords(events: readonly GamificationEventDocumentV1[]): ReplayRecord[] {
  const seenIds = new Set<string>()
  const records: ReplayRecord[] = []
  for (const { id, event } of events) {
    if (seenIds.has(id)) continue
    seenIds.add(id)
    records.push({
      id, causalGroupId: event.causalGroupId, effectiveAt: event.effectiveAt,
      familyId: event.familyId, childId: event.childId, transitionRank: event.transitionRank, event,
    })
  }
  return records
}

function eligibilityRecords(snapshots: readonly DailyEligibilitySnapshotV1[]): ReplayRecord[] {
  const seenDays = new Set<string>()
  const records: ReplayRecord[] = []
  for (const snapshot of snapshots) {
    if (seenDays.has(snapshot.dayKey)) continue
    seenDays.add(snapshot.dayKey)
    records.push({
      id: `daily_eligibility:${snapshot.familyId}:${snapshot.childId}:${snapshot.dayKey}`,
      causalGroupId: snapshot.causalGroupId,
      effectiveAt: snapshot.effectiveAt,
      familyId: snapshot.familyId,
      childId: snapshot.childId,
      transitionRank: snapshot.transitionRank,
    })
  }
  return records
}

function qualificationStateAfterReplay(
  snapshots: readonly DailyEligibilitySnapshotV1[],
  qualificationByDay: ReadonlyMap<string, 'qualified' | 'unqualified'>,
): Omit<StreakProjectionV1, 'bestStreak'> {
  const orderedSnapshots = [...snapshots]
    .filter((snapshot, index, all) => all.findIndex((candidate) => candidate.dayKey === snapshot.dayKey) === index)
    .sort((left, right) => compareCodeUnits(left.dayKey, right.dayKey))

  let currentStreak = 0
  let lastQualifiedDayKey: string | null = null
  let previousDayKey: string | null = null
  let unresolvedEligibleDay = false

  for (const snapshot of orderedSnapshots) {
    const hasCalendarGap = previousDayKey !== null && addFamilyDays(previousDayKey, 1) !== snapshot.dayKey
    if (hasCalendarGap) unresolvedEligibleDay = true

    if (snapshot.eligiblePoints === 0) {
      previousDayKey = snapshot.dayKey
      continue
    }

    const state = qualificationByDay.get(snapshot.dayKey)
    if (state === 'qualified') {
      currentStreak = currentStreak > 0 && !unresolvedEligibleDay ? currentStreak + 1 : 1
      lastQualifiedDayKey = snapshot.dayKey
      unresolvedEligibleDay = false
    } else if (state === 'unqualified') {
      currentStreak = 0
      lastQualifiedDayKey = null
      unresolvedEligibleDay = false
    } else {
      // No immutable transition is an unfinalized/unknown day, never a clock-derived miss.
      unresolvedEligibleDay = true
    }
    previousDayKey = snapshot.dayKey
  }

  return { currentStreak, lastQualifiedDayKey }
}

/**
 * Rebuilds streaks solely from immutable eligibility and qualification events.
 * Qualification effects are observed only once every record in their causal
 * group has been applied, preventing transient same-group streak gains.
 */
export function calculateStreak(input: CalculateStreakInputV1): StreakProjectionV1 {
  const snapshots = input.eligibilitySnapshots
  const records = [...eligibilityRecords(snapshots), ...eventRecords(input.events)]
  assertCausalGroupInvariants(records)
  records.sort(compareRecords)
  const qualificationByDay = new Map<string, 'qualified' | 'unqualified'>()
  let bestStreak = 0

  for (let start = 0; start < records.length;) {
    let end = start + 1
    while (end < records.length && records[end].causalGroupId === records[start].causalGroupId) end += 1
    assertCausalGroupRecordCount(end - start)

    for (const record of records.slice(start, end)) {
      const event = record.event
      if (event?.eventType !== 'daily_goal_qualification_changed' || event.dayKey === undefined || event.qualificationState === undefined) continue
      qualificationByDay.set(event.dayKey, event.qualificationState)
    }

    const observed = qualificationStateAfterReplay(snapshots, qualificationByDay)
    bestStreak = Math.max(bestStreak, observed.currentStreak)
    start = end
  }

  const current = qualificationStateAfterReplay(snapshots, qualificationByDay)
  return { ...current, bestStreak }
}
