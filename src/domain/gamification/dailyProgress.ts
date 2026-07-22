import type {
  DailyEligibilitySnapshotV1,
  DailyProgressV1,
  EngineTimestamp,
  TaskCompletionStatus,
  TaskGamificationEffectV1,
} from './types'
import { logicalCompletionKey } from './xp'

const FALLBACK_TIMEZONE = 'Europe/London'

export interface DailyProgressCompletionEffectV1 {
  readonly completionId: string
  readonly status: TaskCompletionStatus
  readonly effect: TaskGamificationEffectV1
}

export interface CalculateDailyProgressInputV1 {
  readonly eligibilitySnapshot: DailyEligibilitySnapshotV1
  readonly eligibilitySnapshotId: string
  readonly completionEffects: readonly DailyProgressCompletionEffectV1[]
  readonly invalidatedLogicalCompletionKeys: readonly string[]
  readonly finalized: boolean
  readonly calculatedAt: EngineTimestamp
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function assertEpochMilliseconds(value: unknown, label: string): asserts value is EngineTimestamp {
  if (!isNonNegativeSafeInteger(value)) throw new Error(`${label} must be a non-negative safe integer epoch millisecond value`)
}

function resolvedTimezone(timezone: string | undefined): string {
  if (timezone === undefined || timezone.length === 0) return FALLBACK_TIMEZONE
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(0)
    return timezone
  } catch {
    return FALLBACK_TIMEZONE
  }
}

function dayKeyParts(dayKey: string): readonly [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey)
  if (match === null) throw new Error('family day key must use YYYY-MM-DD')

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error('family day key must be a valid Gregorian date')
  }
  return [year, month, day]
}

function formatDayKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Returns the Gregorian date in the family timezone, with London as the legacy fallback. */
export function familyDayKey(epochMilliseconds: EngineTimestamp, timezone: string | undefined): string {
  assertEpochMilliseconds(epochMilliseconds, 'epochMilliseconds')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolvedTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMilliseconds))
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((candidate) => candidate.type === type)?.value
    if (value === undefined) throw new Error(`Unable to format family day ${type}`)
    return value
  }

  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Adds calendar days to a Gregorian family day without converting through a local clock. */
export function addFamilyDays(dayKey: string, dayCount: number): string {
  if (!Number.isSafeInteger(dayCount)) throw new Error('dayCount must be a safe integer')
  const [year, month, day] = dayKeyParts(dayKey)
  const date = new Date(Date.UTC(year, month - 1, day + dayCount))
  if (Number.isNaN(date.getTime())) throw new Error('family day is outside the supported date range')
  return formatDayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function canonicalEffect(effect: TaskGamificationEffectV1): string {
  return JSON.stringify([
    effect.schemaVersion,
    effect.familyId,
    effect.childId,
    effect.taskId,
    effect.logicalCompletionKey,
    effect.periodKey,
    effect.dayKey,
    effect.timezone,
    effect.pointsReward,
    effect.xpAward,
    effect.rewardPointsAward,
    effect.dailyWeight,
    effect.requiresApproval,
    effect.approvedAt,
  ])
}

function assertEligibilitySnapshot(snapshot: DailyEligibilitySnapshotV1): void {
  if (snapshot.schemaVersion !== 1) throw new Error('Unsupported daily eligibility snapshot schema version')
  if (!Number.isInteger(snapshot.dailyGoalPercentage) || snapshot.dailyGoalPercentage < 50 || snapshot.dailyGoalPercentage > 100) {
    throw new Error('daily eligibility snapshot has an invalid daily goal percentage')
  }
  dayKeyParts(snapshot.dayKey)
  if (snapshot.familyId.length === 0 || snapshot.childId.length === 0 || snapshot.timezone.length === 0) {
    throw new Error('daily eligibility snapshot identity fields must be non-empty')
  }

  let eligiblePoints = 0n
  for (const [taskId, weight] of Object.entries(snapshot.taskWeights)) {
    if (taskId.length === 0 || !isNonNegativeSafeInteger(weight)) {
      throw new Error('daily eligibility snapshot has an invalid task weight')
    }
    eligiblePoints += BigInt(weight)
  }
  if (eligiblePoints > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('daily eligibility snapshot eligible points exceed safe integer range')
  }
  if (snapshot.eligibleTaskCount !== Object.keys(snapshot.taskWeights).length || snapshot.eligiblePoints !== Number(eligiblePoints)) {
    throw new Error('daily eligibility snapshot aggregate fields conflict with frozen task weights')
  }
}

function isValidEffectForSnapshot(
  effect: TaskGamificationEffectV1,
  snapshot: DailyEligibilitySnapshotV1,
): boolean {
  let canonicalLogicalCompletionKey: string
  try {
    canonicalLogicalCompletionKey = logicalCompletionKey(effect.childId, effect.taskId, effect.periodKey)
  } catch {
    return false
  }

  return effect.schemaVersion === 1
    && effect.familyId === snapshot.familyId
    && effect.childId === snapshot.childId
    && effect.dayKey === snapshot.dayKey
    && effect.timezone === snapshot.timezone
    && effect.taskId.length > 0
    && effect.logicalCompletionKey === canonicalLogicalCompletionKey
    && effect.periodKey.length > 0
    && typeof effect.requiresApproval === 'boolean'
    && isNonNegativeSafeInteger(effect.pointsReward)
    && isNonNegativeSafeInteger(effect.xpAward)
    && isNonNegativeSafeInteger(effect.rewardPointsAward)
    && isNonNegativeSafeInteger(effect.dailyWeight)
    && isNonNegativeSafeInteger(effect.approvedAt)
    && effect.pointsReward === effect.xpAward
    && effect.pointsReward === effect.rewardPointsAward
    && Object.hasOwn(snapshot.taskWeights, effect.taskId)
}

function numberFromSafeBigInt(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds safe integer range`)
  return Number(value)
}

/**
 * Folds immutable completion effects over one authoritative eligibility snapshot.
 * It deliberately contains no task schedule, assignment, or recurrence policy.
 */
export function calculateDailyProgress(input: CalculateDailyProgressInputV1): Readonly<DailyProgressV1> {
  const { eligibilitySnapshot: snapshot } = input
  assertEligibilitySnapshot(snapshot)
  if (input.eligibilitySnapshotId.length === 0) throw new Error('eligibilitySnapshotId must be non-empty')
  assertEpochMilliseconds(input.calculatedAt, 'calculatedAt')

  const invalidatedKeys = [...new Set(input.invalidatedLogicalCompletionKeys)].sort()
  const invalidatedKeySet = new Set(invalidatedKeys)
  const effectsByLogicalKey = new Map<string, TaskGamificationEffectV1>()
  const logicalKeyByTaskId = new Map<string, string>()

  for (const completionEffect of input.completionEffects) {
    if (completionEffect.status !== 'approved') continue
    const { effect } = completionEffect
    if (!isValidEffectForSnapshot(effect, snapshot)) continue

    const existing = effectsByLogicalKey.get(effect.logicalCompletionKey)
    if (existing !== undefined) {
      if (canonicalEffect(existing) !== canonicalEffect(effect)) {
        throw new Error(`Daily progress integrity error: conflicting effect snapshot for ${effect.logicalCompletionKey}`)
      }
      continue
    }
    const existingLogicalKey = logicalKeyByTaskId.get(effect.taskId)
    if (existingLogicalKey !== undefined && existingLogicalKey !== effect.logicalCompletionKey) {
      throw new Error(`Daily progress integrity error: multiple logical occurrences for frozen task ${effect.taskId}`)
    }
    effectsByLogicalKey.set(effect.logicalCompletionKey, effect)
    logicalKeyByTaskId.set(effect.taskId, effect.logicalCompletionKey)
  }

  let approvedPoints = 0n
  const contributingKeys: string[] = []
  for (const [logicalCompletionKey, effect] of effectsByLogicalKey) {
    if (invalidatedKeySet.has(logicalCompletionKey)) continue
    approvedPoints += BigInt(Math.min(effect.dailyWeight, snapshot.taskWeights[effect.taskId]))
    contributingKeys.push(logicalCompletionKey)
  }

  const eligiblePoints = snapshot.eligiblePoints
  const approvedPointsNumber = numberFromSafeBigInt(approvedPoints, 'approved points')
  const eligiblePointsBigInt = BigInt(eligiblePoints)
  const progressPercentage = eligiblePoints === 0
    ? 0
    : numberFromSafeBigInt((approvedPoints * 100n) / eligiblePointsBigInt, 'progress percentage')
  const dailyGoalReached = eligiblePoints > 0
    && approvedPoints * 100n >= eligiblePointsBigInt * BigInt(snapshot.dailyGoalPercentage)
  const perfectDayReached = eligiblePoints > 0 && approvedPoints === eligiblePointsBigInt

  return {
    schemaVersion: 1,
    familyId: snapshot.familyId,
    childId: snapshot.childId,
    dayKey: snapshot.dayKey,
    timezone: snapshot.timezone,
    eligibilitySnapshotId: input.eligibilitySnapshotId,
    dailyGoalPercentage: snapshot.dailyGoalPercentage,
    eligiblePoints,
    approvedPoints: approvedPointsNumber,
    eligibleTaskCount: snapshot.eligibleTaskCount,
    approvedTaskCount: contributingKeys.length,
    progressPercentage,
    dailyGoalReached,
    perfectDayReached,
    finalized: input.finalized,
    contributingLogicalCompletionKeys: contributingKeys.sort(),
    invalidatedLogicalCompletionKeys: invalidatedKeys,
    calculatedAt: input.calculatedAt,
  }
}
