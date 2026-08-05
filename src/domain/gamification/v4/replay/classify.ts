/**
 * Gamification V4 — Task 2.2 classification engine (read-only).
 *
 * Deterministic classification of legacy replay source records into exactly one
 * of five categories: `exact`, `estimated`, `malformed`, `ambiguous`,
 * `skipped`.
 *
 * Hard rules (from the approved V4 plan):
 *  - Same input always produces the identical classification (no randomness,
 *    no clock, no I/O).
 *  - Missing values are NEVER guessed. Uncertainty is preserved.
 *  - Every classification carries a `reason` and `evidence` string.
 *  - No silent fallback: a record that cannot be resolved is `malformed`, not
 *    quietly coerced.
 *  - No wallet data is read or imported. No Firestore writes occur.
 *
 * This module reuses `ReplaySourceRecord` (Task 2.1) and `SOURCE_TYPE` /
 * `SourceTypeV4` (Task 1.1). It does NOT duplicate reducer / ordering / level
 * / streak / achievement logic.
 */

import { SOURCE_TYPE, type SourceTypeV4 } from '../types'
import type { LegacyTaskCompletion, ReplaySourceRecord } from './sources'

export type ClassificationCategoryV4 =
  | 'exact'
  | 'estimated'
  | 'malformed'
  | 'ambiguous'
  | 'skipped'

export interface ClassificationResultV4 {
  /** The classification category (the plan's `classify` return union). */
  readonly category: ClassificationCategoryV4
  /** Human-readable explanation of why this category was chosen. */
  readonly reason: string
  /** Concrete evidence (ids / values) supporting the classification. */
  readonly evidence: string
  /** True only when the reward value is an estimated fallback. */
  readonly estimated: boolean
  /** The resolved reward-points delta, or null when it cannot be determined. */
  readonly rewardPoints: number | null
}

/** Minimal view of a task definition used for the estimated fallback. */
export interface TaskPointsSource {
  readonly currentPoints: number | null
}

/** Minimal view of a legacy effect snapshot. */
export interface EffectSnapshotLike {
  readonly awardedPoints?: number | null
  readonly pointsDelta?: number | null
}

export interface ClassifyOptions {
  /** Resolve current task points by taskId (enables the `estimated` fallback). */
  readonly taskPointsLookup?: (taskId: string) => number | null
  /** Source ids that have conflicting records (marked `ambiguous`). */
  readonly conflictingSourceIds?: ReadonlySet<string>
  /** Predicate marking a source as `skipped` (wallet-linked / out-of-family). */
  readonly skipIf?: (source: ReplaySourceRecord) => boolean
}

/**
 * Select reward points from an effect snapshot if present (exact), otherwise
 * fall back to the task's current configured points (estimated). Returns null
 * when neither is available — callers must NOT guess a value.
 */
export function selectRewardPoints(
  task: TaskPointsSource | null,
  snapshot: EffectSnapshotLike | null,
): { points: number; estimated: boolean } | null {
  const snapshotPoints =
    snapshot && typeof snapshot.awardedPoints === 'number' ? snapshot.awardedPoints : null
  if (snapshotPoints !== null) {
    return { points: snapshotPoints, estimated: false }
  }
  const taskPoints = task && typeof task.currentPoints === 'number' ? task.currentPoints : null
  if (taskPoints !== null) {
    return { points: taskPoints, estimated: true }
  }
  return null
}

function evidenceFor(source: ReplaySourceRecord): string {
  return `sourceId=${source.sourceId} sourceType=${source.sourceType}`
}

/**
 * Classify a single replay source record. Pure and deterministic: identical
 * inputs always yield an identical result.
 */
export function classify(
  source: ReplaySourceRecord,
  opts: ClassifyOptions = {},
): ClassificationResultV4 {
  const { taskPointsLookup, conflictingSourceIds, skipIf } = opts

  if (skipIf && skipIf(source)) {
    return {
      category: 'skipped',
      reason: 'source excluded by skip predicate (wallet-linked or out-of-family)',
      evidence: evidenceFor(source),
      estimated: false,
      rewardPoints: null,
    }
  }

  if (!source.sourceId || !source.effectiveAt || !source.createdAt) {
    return {
      category: 'malformed',
      reason: 'missing required identity or timestamp field',
      evidence: `sourceId=${source.sourceId} effectiveAt=${source.effectiveAt} createdAt=${source.createdAt}`,
      estimated: false,
      rewardPoints: null,
    }
  }

  if (conflictingSourceIds && conflictingSourceIds.has(source.sourceId)) {
    return {
      category: 'ambiguous',
      reason: 'multiple conflicting source records share the same sourceId',
      evidence: evidenceFor(source),
      estimated: false,
      rewardPoints: null,
    }
  }

  if (source.sourceType === (SOURCE_TYPE.TASK_COMPLETION as SourceTypeV4)) {
    const legacy = source.raw as Partial<LegacyTaskCompletion>
    const selected = selectRewardPoints(
      taskPointsLookup ? { currentPoints: taskPointsLookup(legacy.taskId ?? '') } : null,
      { awardedPoints: legacy.awardedPoints ?? null, pointsDelta: legacy.effectSnapshot?.pointsDelta ?? null },
    )
    if (selected) {
      return {
        category: selected.estimated ? 'estimated' : 'exact',
        reason: selected.estimated
          ? 'task snapshot missing; fell back to current task points'
          : 'concrete awarded points present in legacy record',
        evidence: `${evidenceFor(source)} rewardPoints=${selected.points} estimated=${selected.estimated}`,
        estimated: selected.estimated,
        rewardPoints: selected.points,
      }
    }
    return {
      category: 'malformed',
      reason: 'no awarded points in snapshot and no current task points available; refusing to guess',
      evidence: `${evidenceFor(source)} awardedPoints=${legacy.awardedPoints} taskId=${legacy.taskId}`,
      estimated: false,
      rewardPoints: null,
    }
  }

  // All other source types require a concrete raw reward snapshot (no guessing).
  if (typeof source.rawRewardSnapshot === 'number') {
    return {
      category: 'exact',
      reason: 'concrete reward snapshot present in legacy record',
      evidence: `${evidenceFor(source)} rewardPoints=${source.rawRewardSnapshot}`,
      estimated: false,
      rewardPoints: source.rawRewardSnapshot,
    }
  }

  return {
    category: 'malformed',
    reason: 'missing concrete reward value and no fallback available; refusing to guess',
    evidence: `${evidenceFor(source)} rawRewardSnapshot=${source.rawRewardSnapshot}`,
    estimated: false,
    rewardPoints: null,
  }
}

/**
 * Classify a collection of source records, detecting ambiguity deterministically
 * by grouping on `sourceId`. Order-independent: shuffled input yields identical
 * per-sourceId classifications.
 */
export function classifyAll(
  records: readonly ReplaySourceRecord[],
  opts: ClassifyOptions = {},
): ClassificationResultV4[] {
  const counts = new Map<string, number>()
  for (const r of records) {
    if (!r.sourceId) continue
    counts.set(r.sourceId, (counts.get(r.sourceId) ?? 0) + 1)
  }
  const conflicting = new Set<string>()
  for (const [id, count] of counts) {
    if (count > 1) conflicting.add(id)
  }
  return records.map((r) => classify(r, { ...opts, conflictingSourceIds: conflicting }))
}
