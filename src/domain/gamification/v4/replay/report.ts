/**
 * Gamification V4 — Task 2.3 replay report emitter (read-only).
 *
 * Consumes ONLY:
 *  - Task 2.1 replay readers (`ReplaySourceRecord`)
 *  - Task 2.2 classification results (`ClassificationResultV4`)
 *
 * Hard constraints (from the approved V4 plan + task brief):
 *  - Fully deterministic: identical inputs always yield a byte-identical
 *    report (rows are sorted by a stable key inside `emitReport`).
 *  - Never creates V4 events, never performs replay, never writes anything.
 *  - Never imports the database SDK or the payments module.
 *  - Never duplicates reducer / rebuild / ordering / level / streak /
 *    achievements / validators logic.
 *  - Never guesses: it only reports the classification already produced by
 *    Task 2.2 and the deterministic event id that Task 2.1/1.2 helpers derive.
 *
 * The emitter reuses the existing `eventIdFor` helper (Task 1.2) and the
 * `SOURCE_TYPE` constant (Task 1.1). It does NOT recompute reward values or
 * XP — those are the reducer's job at replay time.
 */

import { SOURCE_TYPE, type SourceTypeV4 } from '../types'
import { eventIdFor } from '../ids'
import type { ReplaySourceRecord } from './sources'
import type {
  ClassificationCategoryV4,
  ClassificationResultV4,
} from './classify'

export type { ClassificationCategoryV4 }

/** One per-event row in the replay report. */
export interface ReplayReportRow {
  /** The source document identity (legacy source id). */
  readonly sourceId: string
  /** The legacy source domain this row came from. */
  readonly sourceType: SourceTypeV4
  /** The raw legacy source document (read-only reference, never mutated). */
  readonly sourceDocument: unknown
  /** Deterministic V4 event id this source would map to (informational). */
  readonly eventId: string
  /** True only when the reward value is an estimated fallback. */
  readonly estimated: boolean
  /** Resolved reward-points delta, or null when undetermined. */
  readonly rewardPointsDelta: number | null
  /**
   * Informational mirror of the resolved reward delta. The authoritative XP is
   * derived by the reducer at replay time and is NEVER computed here, so this
   * column is a transparent 1:1 mirror of `rewardPointsDelta`, not a guess.
   */
  readonly xpDelta: number | null
  /** Effective timestamp of the source. */
  readonly timestamp: string
  /** Classification category assigned by Task 2.2. */
  readonly classification: ClassificationCategoryV4
  /** Structured reason for the classification. */
  readonly reason: string
  /** Structured evidence supporting the classification. */
  readonly evidence: string
}

/** Aggregate counts per classification category. */
export interface ReplayReportCounts {
  readonly exact: number
  readonly estimated: number
  readonly malformed: number
  readonly ambiguous: number
  readonly skipped: number
}

/** The fully aggregated, deterministic replay report. */
export interface ReplayReport {
  /** Total number of source records processed. */
  readonly totalSources: number
  /** Aggregate counts per classification category. */
  readonly counts: ReplayReportCounts
  /** Per-event rows, sorted deterministically. */
  readonly rows: readonly ReplayReportRow[]
  /** Aggregated reasons grouped by category (order preserved). */
  readonly reasonsByCategory: Readonly<Record<ClassificationCategoryV4, readonly string[]>>
  /** Aggregated evidence grouped by category (order preserved). */
  readonly evidenceByCategory: Readonly<Record<ClassificationCategoryV4, readonly string[]>>
}

const CATEGORY_KEYS: readonly ClassificationCategoryV4[] = [
  'exact',
  'estimated',
  'malformed',
  'ambiguous',
  'skipped',
]

function memberIdFor(source: ReplaySourceRecord): string {
  const raw = source.raw as { childId?: string } | null
  return raw?.childId ?? ''
}

/**
 * Map a legacy source type to the V4 event type it would produce. Pure and
 * deterministic; this is only used to derive the informational `eventId`
 * column and never creates an event.
 */
function eventTypeForSource(source: ReplaySourceRecord): string {
  switch (source.sourceType) {
    case SOURCE_TYPE.TASK_COMPLETION:
      return 'TASK_APPROVED'
    case SOURCE_TYPE.BEHAVIOUR: {
      const raw = source.raw as { behaviourType?: string } | null
      const bt = raw?.behaviourType
      if (bt === 'negative' || bt === 'financial') return 'BEHAVIOUR_NEGATIVE'
      return 'BEHAVIOUR_POSITIVE'
    }
    case SOURCE_TYPE.REWARD_REDEMPTION:
      return 'REWARD_REDEEMED'
    case SOURCE_TYPE.REVERSAL: {
      const raw = source.raw as { kind?: string } | null
      return raw?.kind === 'REFUND' ? 'REWARD_REFUNDED' : 'TASK_REVERSED'
    }
    case SOURCE_TYPE.DAILY_GOAL:
      return 'DAILY_GOAL_AWARDED'
    case SOURCE_TYPE.PERFECT_DAY:
      return 'PERFECT_DAY_AWARDED'
    case SOURCE_TYPE.AVATAR:
      return 'AVATAR_UNLOCKED'
    case SOURCE_TYPE.MANUAL:
    default:
      return 'MANUAL_ADJUSTMENT'
  }
}

/**
 * Build per-event report rows from Task 2.1 source records and their Task 2.2
 * classifications. The two arrays must be aligned (same order / length), which
 * is guaranteed by `classifyAll` returning exactly one result per input
 * record.
 *
 * Pure and deterministic. Does not mutate its inputs.
 */
export function buildReportRows(
  familyId: string,
  sources: readonly ReplaySourceRecord[],
  classifications: readonly ClassificationResultV4[],
): ReplayReportRow[] {
  const n = Math.min(sources.length, classifications.length)
  const rows: ReplayReportRow[] = []
  for (let i = 0; i < n; i++) {
    const source = sources[i]
    const classification = classifications[i]
    const memberId = memberIdFor(source)
    const eventType = eventTypeForSource(source)
    const eventId = eventIdFor(familyId, memberId, eventType, source.sourceId)
    const rewardPointsDelta = classification.rewardPoints
    rows.push({
      sourceId: source.sourceId,
      sourceType: source.sourceType,
      sourceDocument: source.raw,
      eventId,
      estimated: classification.estimated,
      rewardPointsDelta,
      xpDelta: rewardPointsDelta,
      timestamp: source.effectiveAt,
      classification: classification.category,
      reason: classification.reason,
      evidence: classification.evidence,
    })
  }
  return rows
}

function emptyCategoryMap(): Record<ClassificationCategoryV4, string[]> {
  return { exact: [], estimated: [], malformed: [], ambiguous: [], skipped: [] }
}

/**
 * Aggregate report rows into a deterministic `ReplayReport`. Rows are sorted by
 * a stable key (eventId → sourceId → reason → evidence) so that shuffled input
 * yields a byte-identical report. Does not mutate the input array.
 */
export function emitReport(rowsInput: readonly ReplayReportRow[]): ReplayReport {
  const rows = [...rowsInput].sort((a, b) => {
    if (a.eventId !== b.eventId) return a.eventId < b.eventId ? -1 : 1
    if (a.sourceId !== b.sourceId) return a.sourceId < b.sourceId ? -1 : 1
    if (a.reason !== b.reason) return a.reason < b.reason ? -1 : 1
    if (a.evidence !== b.evidence) return a.evidence < b.evidence ? -1 : 1
    return 0
  })

  const counts: ReplayReportCounts = {
    exact: 0,
    estimated: 0,
    malformed: 0,
    ambiguous: 0,
    skipped: 0,
  }
  const reasons = emptyCategoryMap()
  const evidence = emptyCategoryMap()

  for (const row of rows) {
    counts[row.classification] += 1
    reasons[row.classification] = [...reasons[row.classification], row.reason]
    evidence[row.classification] = [...evidence[row.classification], row.evidence]
  }

  return {
    totalSources: rows.length,
    counts,
    rows,
    reasonsByCategory: reasons,
    evidenceByCategory: evidence,
  }
}
