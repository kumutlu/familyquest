/**
 * Gamification V4 — read-only legacy source readers (Task 2.1).
 *
 * Pure mappers from legacy gamification documents → replay input records.
 * These readers NEVER import wallet modules and NEVER write anything. They
 * only extract the raw reward snapshot and the identity/time fields needed by
 * the (later) classification + replay pipeline. No reducer logic is duplicated
 * here: the projection fold lives in `../reducer` and is reused downstream.
 * Wallet is completely out of scope.
 */

import { SOURCE_TYPE, type SourceTypeV4 } from '../types'

export interface LegacyTaskCompletion {
  readonly id: string
  readonly taskId: string
  readonly childId: string
  readonly awardedPoints?: number | null
  readonly effectSnapshot?: { pointsDelta?: number | null } | null
  readonly approvedAt?: string | null
  readonly createdAt?: string | null
}

export interface LegacyBehaviour {
  readonly id: string
  readonly childId: string
  readonly behaviourType: 'positive' | 'negative' | 'financial'
  readonly pointsDelta?: number | null
  readonly reason?: string | null
  readonly createdAt?: string | null
}

export interface LegacyDailyProgress {
  readonly id: string
  readonly childId: string
  readonly dayKey: string
  readonly perfectDay?: boolean | null
  readonly rewardPointsAward?: number | null
  readonly createdAt?: string | null
}

export interface LegacyRedemption {
  readonly id: string
  readonly childId: string
  readonly rewardId: string
  readonly cost?: number | null
  readonly effectSnapshot?: { pointsDelta?: number | null } | null
  readonly createdAt?: string | null
}

export interface LegacyReversal {
  readonly id: string
  readonly childId: string
  readonly kind: 'REV' | 'REFUND'
  readonly originalSourceId: string
  readonly rewardPointsDelta?: number | null
  readonly createdAt?: string | null
}

export interface LegacyAvatarUnlock {
  readonly id: string
  readonly childId: string
  readonly avatarId: string
  readonly costPoints?: number | null
  readonly createdAt?: string | null
}

export interface LegacyManualAdjustment {
  readonly id: string
  readonly childId: string
  readonly rpDelta?: number | null
  readonly xpDelta?: number | null
  readonly reason?: string | null
  readonly createdAt?: string | null
}

/** In-memory view of the legacy gamification collections for one family. */
export interface LegacyFamily {
  readonly familyId: string
  readonly taskCompletions: readonly LegacyTaskCompletion[]
  readonly behaviours: readonly LegacyBehaviour[]
  readonly dailyProgress: readonly LegacyDailyProgress[]
  readonly redemptions: readonly LegacyRedemption[]
  readonly reversals: readonly LegacyReversal[]
  readonly avatarUnlocks: readonly LegacyAvatarUnlock[]
  readonly manualAdjustments: readonly LegacyManualAdjustment[]
}

/** A single replay input record: only raw, un-classified facts. */
export interface ReplaySourceRecord {
  readonly sourceType: SourceTypeV4
  readonly sourceId: string
  readonly effectiveAt: string
  readonly createdAt: string
  readonly rawRewardSnapshot: number | null
  readonly raw: unknown
}

/** Thrown when a legacy document is missing a field required for replay. */
export class MalformedSourceError extends Error {
  constructor(
    public readonly sourceType: string,
    public readonly sourceId: string,
    reason: string,
  ) {
    super(`malformed ${sourceType} source ${sourceId}: ${reason}`)
    this.name = 'MalformedSourceError'
  }
}

function requireTimestamp(
  primary: string | null | undefined,
  fallback: string | null | undefined,
  sourceType: string,
  sourceId: string,
): string {
  const value = primary ?? fallback
  if (typeof value !== 'string' || value.length === 0) {
    throw new MalformedSourceError(sourceType, sourceId, 'missing effective timestamp')
  }
  return value
}

function record(
  sourceType: SourceTypeV4,
  sourceId: string,
  effectiveAt: string,
  createdAt: string,
  rawRewardSnapshot: number | null,
  raw: unknown,
): ReplaySourceRecord {
  return { sourceType, sourceId, effectiveAt, createdAt, rawRewardSnapshot, raw }
}

export function readTaskCompletions(family: LegacyFamily): ReplaySourceRecord[] {
  return family.taskCompletions.map((doc) => {
    if (!doc.id) throw new MalformedSourceError('task_completion', String(doc.id), 'missing id')
    if (!doc.taskId) throw new MalformedSourceError('task_completion', doc.id, 'missing taskId')
    if (!doc.childId) throw new MalformedSourceError('task_completion', doc.id, 'missing childId')
    const effectiveAt = requireTimestamp(doc.approvedAt, doc.createdAt, 'task_completion', doc.id)
    const createdAt = requireTimestamp(doc.createdAt, doc.approvedAt, 'task_completion', doc.id)
    const rawRewardSnapshot = doc.awardedPoints ?? doc.effectSnapshot?.pointsDelta ?? null
    return record(SOURCE_TYPE.TASK_COMPLETION, doc.id, effectiveAt, createdAt, rawRewardSnapshot, doc)
  })
}

export function readBehaviours(family: LegacyFamily): ReplaySourceRecord[] {
  return family.behaviours.map((doc) => {
    if (!doc.id) throw new MalformedSourceError('behaviour', String(doc.id), 'missing id')
    if (!doc.childId) throw new MalformedSourceError('behaviour', doc.id, 'missing childId')
    if (!doc.behaviourType) throw new MalformedSourceError('behaviour', doc.id, 'missing behaviourType')
    const effectiveAt = requireTimestamp(doc.createdAt, null, 'behaviour', doc.id)
    const createdAt = requireTimestamp(doc.createdAt, null, 'behaviour', doc.id)
    const rawRewardSnapshot = doc.pointsDelta ?? null
    return record(SOURCE_TYPE.BEHAVIOUR, doc.id, effectiveAt, createdAt, rawRewardSnapshot, doc)
  })
}

export function readDailyPerfectDay(family: LegacyFamily): ReplaySourceRecord[] {
  return family.dailyProgress
    .filter((doc) => doc.perfectDay === true)
    .map((doc) => {
      if (!doc.id) throw new MalformedSourceError('perfect_day', String(doc.id), 'missing id')
      if (!doc.childId) throw new MalformedSourceError('perfect_day', doc.id, 'missing childId')
      if (!doc.dayKey) throw new MalformedSourceError('perfect_day', doc.id, 'missing dayKey')
      const effectiveAt = requireTimestamp(doc.createdAt, null, 'perfect_day', doc.id)
      const createdAt = requireTimestamp(doc.createdAt, null, 'perfect_day', doc.id)
      const rawRewardSnapshot = doc.rewardPointsAward ?? null
      return record(SOURCE_TYPE.PERFECT_DAY, doc.id, effectiveAt, createdAt, rawRewardSnapshot, doc)
    })
}

export function readRedemptions(family: LegacyFamily): ReplaySourceRecord[] {
  return family.redemptions.map((doc) => {
    if (!doc.id) throw new MalformedSourceError('reward_redemption', String(doc.id), 'missing id')
    if (!doc.childId) throw new MalformedSourceError('reward_redemption', doc.id, 'missing childId')
    if (!doc.rewardId) throw new MalformedSourceError('reward_redemption', doc.id, 'missing rewardId')
    const effectiveAt = requireTimestamp(doc.createdAt, null, 'reward_redemption', doc.id)
    const createdAt = requireTimestamp(doc.createdAt, null, 'reward_redemption', doc.id)
    const rawRewardSnapshot = doc.effectSnapshot?.pointsDelta ?? (doc.cost != null ? -doc.cost : null)
    return record(SOURCE_TYPE.REWARD_REDEMPTION, doc.id, effectiveAt, createdAt, rawRewardSnapshot, doc)
  })
}

export function readRefundsReversals(family: LegacyFamily): ReplaySourceRecord[] {
  return family.reversals.map((doc) => {
    if (!doc.id) throw new MalformedSourceError('reversal', String(doc.id), 'missing id')
    if (!doc.childId) throw new MalformedSourceError('reversal', doc.id, 'missing childId')
    if (!doc.kind) throw new MalformedSourceError('reversal', doc.id, 'missing kind')
    if (!doc.originalSourceId) throw new MalformedSourceError('reversal', doc.id, 'missing originalSourceId')
    const effectiveAt = requireTimestamp(doc.createdAt, null, 'reversal', doc.id)
    const createdAt = requireTimestamp(doc.createdAt, null, 'reversal', doc.id)
    const rawRewardSnapshot = doc.rewardPointsDelta ?? null
    return record(SOURCE_TYPE.REVERSAL, doc.id, effectiveAt, createdAt, rawRewardSnapshot, doc)
  })
}

export function readAvatarUnlocks(family: LegacyFamily): ReplaySourceRecord[] {
  return family.avatarUnlocks.map((doc) => {
    if (!doc.id) throw new MalformedSourceError('avatar', String(doc.id), 'missing id')
    if (!doc.childId) throw new MalformedSourceError('avatar', doc.id, 'missing childId')
    if (!doc.avatarId) throw new MalformedSourceError('avatar', doc.id, 'missing avatarId')
    const effectiveAt = requireTimestamp(doc.createdAt, null, 'avatar', doc.id)
    const createdAt = requireTimestamp(doc.createdAt, null, 'avatar', doc.id)
    const rawRewardSnapshot = doc.costPoints != null ? -doc.costPoints : null
    return record(SOURCE_TYPE.AVATAR, doc.id, effectiveAt, createdAt, rawRewardSnapshot, doc)
  })
}

export function readManualAdjustments(family: LegacyFamily): ReplaySourceRecord[] {
  return family.manualAdjustments.map((doc) => {
    if (!doc.id) throw new MalformedSourceError('manual', String(doc.id), 'missing id')
    if (!doc.childId) throw new MalformedSourceError('manual', doc.id, 'missing childId')
    const effectiveAt = requireTimestamp(doc.createdAt, null, 'manual', doc.id)
    const createdAt = requireTimestamp(doc.createdAt, null, 'manual', doc.id)
    const rawRewardSnapshot = doc.rpDelta ?? null
    return record(SOURCE_TYPE.MANUAL, doc.id, effectiveAt, createdAt, rawRewardSnapshot, doc)
  })
}
