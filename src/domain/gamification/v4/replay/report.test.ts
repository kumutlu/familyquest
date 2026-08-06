/**
 * Gamification V4 — Task 2.3 replay report emitter tests.
 *
 * TDD-first: these tests fail before `report.ts` exists. They prove:
 *  - deterministic output (same input → identical report)
 *  - identical report for shuffled input (order independence)
 *  - empty input handling
 *  - exact / estimated / malformed / ambiguous / skipped counts
 *  - reason aggregation and evidence aggregation
 *  - read-only behaviour (inputs are never mutated)
 *  - no wallet imports and no Firestore imports in the implementation
 */

import { describe, it, expect } from 'vitest'

import {
  buildReportRows,
  emitReport,
  type ReplayReportRow,
} from './report'
import { SOURCE_TYPE, type SourceTypeV4 } from '../types'
import type { ReplaySourceRecord } from './sources'
import type { ClassificationResultV4, ClassificationCategoryV4 } from './classify'
// Static import-hygiene checks live in
// tools/architecture/v4-replay-import-hygiene.test.ts (Node-only APIs).


function rec(
  partial: Partial<ReplaySourceRecord> & { sourceType: SourceTypeV4; sourceId: string },
): ReplaySourceRecord {
  return {
    effectiveAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    rawRewardSnapshot: null,
    raw: { childId: 'member-1' },
    ...partial,
  }
}

function cls(partial: Partial<ClassificationResultV4>): ClassificationResultV4 {
  return {
    category: 'exact',
    reason: 'concrete reward snapshot present in legacy record',
    evidence: 'sourceId=x effectiveAt=2026-01-01',
    estimated: false,
    rewardPoints: 20,
    ...partial,
  }
}

function row(partial: Partial<ReplayReportRow>): ReplayReportRow {
  return {
    sourceId: 'x',
    sourceType: SOURCE_TYPE.TASK_COMPLETION,
    sourceDocument: { childId: 'member-1' },
    eventId: 'FAM::member-1::TASK_APPROVED::x',
    estimated: false,
    rewardPointsDelta: 20,
    xpDelta: 20,
    timestamp: '2026-01-01T00:00:00.000Z',
    classification: 'exact',
    reason: 'concrete reward snapshot present in legacy record',
    evidence: 'sourceId=x effectiveAt=2026-01-01',
    ...partial,
  }
}

describe('buildReportRows', () => {
  it('derives a deterministic event id from family + member + source', () => {
    const sources = [rec({ sourceType: SOURCE_TYPE.TASK_COMPLETION, sourceId: 's1', raw: { childId: 'm1', taskId: 't1', awardedPoints: 20 } })]
    const classes = [cls({ category: 'exact', rewardPoints: 20 })]
    const rows = buildReportRows('FAM', sources, classes)
    expect(rows).toHaveLength(1)
    expect(rows[0].eventId).toBe('FAM::m1::TASK_APPROVED::s1')
    expect(rows[0].rewardPointsDelta).toBe(20)
    expect(rows[0].xpDelta).toBe(20)
    expect(rows[0].timestamp).toBe('2026-01-01T00:00:00.000Z')
  })

  it('does not mutate the source records', () => {
    const sources = [rec({ sourceType: SOURCE_TYPE.BEHAVIOUR, sourceId: 'b1', raw: { childId: 'm2', behaviourType: 'positive', pointsDelta: 5 } })]
    const classes = [cls({ category: 'exact', rewardPoints: 5 })]
    const before = JSON.stringify(sources)
    buildReportRows('FAM', sources, classes)
    expect(JSON.stringify(sources)).toBe(before)
  })
})

describe('emitReport — determinism', () => {
  const sources: ReplaySourceRecord[] = [
    rec({ sourceType: SOURCE_TYPE.TASK_COMPLETION, sourceId: 'a', raw: { childId: 'm1', taskId: 't', awardedPoints: 10 } }),
    rec({ sourceType: SOURCE_TYPE.BEHAVIOUR, sourceId: 'b', raw: { childId: 'm1', behaviourType: 'positive', pointsDelta: 5 } }),
  ]
  const classes: ClassificationResultV4[] = [
    cls({ category: 'exact', rewardPoints: 10, reason: 'r-a', evidence: 'e-a' }),
    cls({ category: 'exact', rewardPoints: 5, reason: 'r-b', evidence: 'e-b' }),
  ]

  it('produces identical output for identical input', () => {
    const r1 = emitReport(buildReportRows('FAM', sources, classes))
    const r2 = emitReport(buildReportRows('FAM', sources, classes))
    expect(r1).toEqual(r2)
  })

  it('produces an identical report for shuffled input', () => {
    const ordered = buildReportRows('FAM', sources, classes)
    const r1 = emitReport(ordered)
    const shuffled = [ordered[1], ordered[0]]
    const r2 = emitReport(shuffled)
    expect(r2).toEqual(r1)
    expect(r2.rows.map((x) => x.sourceId)).toEqual(r1.rows.map((x) => x.sourceId))
  })
})

describe('emitReport — empty input', () => {
  it('returns zero totals and empty rows', () => {
    const report = emitReport([])
    expect(report.totalSources).toBe(0)
    expect(report.counts).toEqual({ exact: 0, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 })
    expect(report.rows).toEqual([])
    expect(report.reasonsByCategory).toEqual({ exact: [], estimated: [], malformed: [], ambiguous: [], skipped: [] })
    expect(report.evidenceByCategory).toEqual({ exact: [], estimated: [], malformed: [], ambiguous: [], skipped: [] })
  })
})

describe('emitReport — category counts', () => {
  function reportWith(categories: ClassificationCategoryV4[]): ReturnType<typeof emitReport> {
    const rows = categories.map((c, i) =>
      row({
        sourceId: `s${i}`,
        eventId: `FAM::m::E::s${i}`,
        classification: c,
        estimated: c === 'estimated',
        rewardPointsDelta: c === 'malformed' ? null : 1,
      }),
    )
    return emitReport(rows)
  }

  it('counts exact rows', () => {
    expect(reportWith(['exact', 'exact']).counts.exact).toBe(2)
  })

  it('counts estimated rows', () => {
    const r = reportWith(['estimated'])
    expect(r.counts.estimated).toBe(1)
    expect(r.rows[0].estimated).toBe(true)
  })

  it('counts malformed rows', () => {
    expect(reportWith(['malformed', 'exact']).counts.malformed).toBe(1)
  })

  it('counts ambiguous rows', () => {
    expect(reportWith(['ambiguous', 'ambiguous']).counts.ambiguous).toBe(2)
  })

  it('counts skipped rows', () => {
    expect(reportWith(['skipped']).counts.skipped).toBe(1)
  })

  it('totals equal the number of rows', () => {
    const r = reportWith(['exact', 'estimated', 'malformed', 'ambiguous', 'skipped'])
    const sum = r.counts.exact + r.counts.estimated + r.counts.malformed + r.counts.ambiguous + r.counts.skipped
    expect(sum).toBe(r.totalSources)
    expect(sum).toBe(5)
  })
})

describe('emitReport — reason and evidence aggregation', () => {
  it('aggregates reasons and evidence per category', () => {
    const rows = [
      row({ sourceId: 'a', eventId: 'FAM::m::E::a', classification: 'exact', reason: 'reason-a', evidence: 'evidence-a' }),
      row({ sourceId: 'b', eventId: 'FAM::m::E::b', classification: 'exact', reason: 'reason-b', evidence: 'evidence-b' }),
      row({ sourceId: 'c', eventId: 'FAM::m::E::c', classification: 'malformed', reason: 'reason-c', evidence: 'evidence-c' }),
    ]
    const report = emitReport(rows)
    expect(report.reasonsByCategory.exact).toEqual(['reason-a', 'reason-b'])
    expect(report.evidenceByCategory.exact).toEqual(['evidence-a', 'evidence-b'])
    expect(report.reasonsByCategory.malformed).toEqual(['reason-c'])
    expect(report.evidenceByCategory.malformed).toEqual(['evidence-c'])
  })
})

describe('emitReport — read-only behaviour', () => {
  it('does not mutate the input rows array or its elements', () => {
    const rows = [
      row({ sourceId: 'a', eventId: 'FAM::m::E::a' }),
      row({ sourceId: 'b', eventId: 'FAM::m::E::b' }),
    ]
    const snapshot = JSON.stringify(rows)
    emitReport(rows)
    expect(JSON.stringify(rows)).toBe(snapshot)
  })
})
