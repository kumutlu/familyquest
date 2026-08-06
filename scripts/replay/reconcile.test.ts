import { describe, expect, it } from 'vitest'

import {
  dropReasonFor,
  emitReconciliationMarkdown,
  gate1InputFor,
  reconcileAll,
  reconcileFamily,
  SOURCE_FIELDS,
  type FixtureFile,
} from './reconcile'
import { assertGate1Reconciliation, gate1ReconciliationChecks } from './verify'

function fixture(overrides: Partial<FixtureFile> & { familyId: string }): FixtureFile {
  return {
    taskCompletions: [],
    behaviours: [],
    dailyProgress: [],
    redemptions: [],
    reversals: [],
    avatarUnlocks: [],
    manualAdjustments: [],
    ...overrides,
  } as FixtureFile
}

const T0 = '2026-01-01T00:00:00.000Z'

describe('reconcile — per-source-type accounting', () => {
  it('accounts for every exported record with no silent loss', () => {
    const f = fixture({
      familyId: 'FAM',
      tasks: { taskB: 7 },
      taskCompletions: [
        { id: 'tcA', taskId: 'taskA', childId: 'c1', awardedPoints: 3, createdAt: T0, approvedAt: T0 },
        { id: 'tcB', taskId: 'taskB', childId: 'c1', createdAt: T0, approvedAt: T0 },
      ],
      dailyProgress: [
        { id: 'dpPerfect', childId: 'c1', dayKey: '2026-01-01', perfectDay: true, rewardPointsAward: 5, createdAt: T0 },
        { id: 'dpPlain', childId: 'c1', dayKey: '2026-01-02', perfectDay: false, createdAt: T0 },
      ],
    })

    const result = reconcileAll([f])

    expect(result.exported).toBe(4)
    expect(result.readerOutput).toBe(3)
    expect(result.dropped).toBe(1)
    expect(result.counts).toEqual({ exact: 2, estimated: 1, malformed: 0, ambiguous: 0, skipped: 0 })
    expect(result.eventBuilt).toBe(3)
    expect(result.balanced).toBe(true)
  })

  it('emits one dropped record per non-perfect daily progress row with a reason', () => {
    const f = fixture({
      familyId: 'FAM',
      dailyProgress: [{ id: 'dp1', childId: 'c1', dayKey: '2026-01-02', perfectDay: false, createdAt: T0 }],
    })
    const { dropped } = reconcileFamily(f)
    expect(dropped).toHaveLength(1)
    expect(dropped[0]).toMatchObject({ familyId: 'FAM', sourceId: 'dp1', stage: 'reader', intentional: true })
    expect(dropped[0].reason).toContain('perfectDay !== true')
    expect(dropped[0].evidence.length).toBeGreaterThan(0)
  })

  it('explains every estimated record with missing value and fallback', () => {
    const f = fixture({
      familyId: 'FAM',
      tasks: { taskB: 7 },
      taskCompletions: [{ id: 'tcB', taskId: 'taskB', childId: 'c1', createdAt: T0, approvedAt: T0 }],
    })
    const { estimated } = reconcileFamily(f)
    expect(estimated).toHaveLength(1)
    expect(estimated[0]).toMatchObject({
      familyId: 'FAM',
      sourceId: 'tcB',
      fallbackValue: 7,
      currentTaskValue: 7,
      historicalSnapshotValue: null,
    })
    expect(estimated[0].missingValue).toContain('awardedPoints')
    expect(estimated[0].designJustification.length).toBeGreaterThan(0)
  })

  it('classifies a task completion with neither snapshot nor task points as malformed (never guessed)', () => {
    const f = fixture({
      familyId: 'FAM',
      taskCompletions: [{ id: 'tcX', taskId: 'gone', childId: 'c1', createdAt: T0, approvedAt: T0 }],
    })
    const result = reconcileAll([f])
    expect(result.counts.malformed).toBe(1)
    expect(result.eventBuilt).toBe(0)
    expect(result.balanced).toBe(true)
  })

  it('is deterministic and input-order independent', () => {
    const a = fixture({ familyId: 'A', behaviours: [{ id: 'b1', childId: 'c', behaviourType: 'positive', pointsDelta: 2, createdAt: T0 }] })
    const b = fixture({ familyId: 'B', redemptions: [{ id: 'r1', childId: 'c', rewardId: 'rw', cost: 4, createdAt: T0 }] })
    expect(JSON.stringify(reconcileAll([a, b]))).toBe(JSON.stringify(reconcileAll([b, a])))
  })

  it('covers every fixture source array in the per-type table', () => {
    const result = reconcileAll([fixture({ familyId: 'FAM' })])
    expect(result.byField.map((f) => f.sourceField)).toEqual([...SOURCE_FIELDS])
  })

  it('flags an unknown drop as a bug, not an intentional filter', () => {
    expect(dropReasonFor('redemptions', { id: 'x' }).intentional).toBe(false)
    expect(dropReasonFor('dailyProgress', { id: 'x' }).intentional).toBe(true)
  })

  it('renders the required markdown table columns', () => {
    const md = emitReconciliationMarkdown(reconcileAll([fixture({ familyId: 'FAM' })]))
    expect(md).toContain('| source type | exported | reader output | classified | event built | dropped | reason |')
  })
})

describe('gate 1 hard assertions', () => {
  const base = {
    totalFamilies: 2,
    exportedSources: 10,
    reportedSources: 8,
    counts: { exact: 5, estimated: 3, malformed: 0, ambiguous: 0, skipped: 0 },
    filtered: [
      { sourceId: 'd1', reason: 'not a perfect day', evidence: 'id=d1' },
      { sourceId: 'd2', reason: 'not a perfect day', evidence: 'id=d2' },
    ],
  }

  it('passes when everything reconciles', () => {
    expect(gate1ReconciliationChecks(base).every((c) => c.passed)).toBe(true)
    expect(() => assertGate1Reconciliation(base)).not.toThrow()
  })

  it('fails on an unexplained count mismatch', () => {
    expect(() => assertGate1Reconciliation({ ...base, exportedSources: 11 })).toThrow(
      /UNEXPLAINED COUNT MISMATCH/,
    )
  })

  it('fails when families > 0 and sources == 0', () => {
    expect(() =>
      assertGate1Reconciliation({
        ...base,
        exportedSources: 0,
        reportedSources: 0,
        counts: { exact: 0, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 },
        filtered: [],
      }),
    ).toThrow(/familiesWithoutSources/)
  })

  it('fails when a dropped record lacks evidence', () => {
    expect(() =>
      assertGate1Reconciliation({
        ...base,
        filtered: [
          { sourceId: 'd1', reason: 'not a perfect day', evidence: 'id=d1' },
          { sourceId: 'd2', reason: '', evidence: '' },
        ],
      }),
    ).toThrow(/lack a reason\/evidence/)
  })

  it('derives a valid gate 1 input from a reconciliation result', () => {
    const result = reconcileAll([
      fixture({
        familyId: 'FAM',
        tasks: { t: 2 },
        taskCompletions: [{ id: 'tc', taskId: 't', childId: 'c', createdAt: T0, approvedAt: T0 }],
        dailyProgress: [{ id: 'dp', childId: 'c', dayKey: '2026-01-02', perfectDay: false, createdAt: T0 }],
      }),
    ])
    expect(() => assertGate1Reconciliation(gate1InputFor(result))).not.toThrow()
  })
})
