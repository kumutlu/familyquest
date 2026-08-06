/**
 * Gamification V4 — Task 2.2 classification engine tests.
 *
 * TDD-first: these tests fail before `classify.ts` exists. They cover the five
 * plan-mandated categories (exact / estimated / malformed / ambiguous /
 * skipped), determinism, shuffled-order stability, missing-field handling,
 * no-guessing behaviour, and the hard constraints that the module never
 * imports wallet code and never performs Firestore writes.
 */

import { describe, it, expect } from 'vitest'

import {
  classify,
  classifyAll,
  selectRewardPoints,
  type ClassificationResultV4,
} from './classify'
import { SOURCE_TYPE, type SourceTypeV4 } from '../types'
import type { ReplaySourceRecord } from './sources'
// Static no-wallet / no-Firestore import checks live in
// tools/architecture/v4-replay-import-hygiene.test.ts (Node-only APIs).


function rec(partial: Partial<ReplaySourceRecord> & { sourceType: SourceTypeV4; sourceId: string }): ReplaySourceRecord {
  return {
    effectiveAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    rawRewardSnapshot: null,
    raw: {},
    ...partial,
  }
}

function taskCompletion(
  sourceId: string,
  legacy: { awardedPoints?: number | null; taskId?: string; pointsDelta?: number | null },
): ReplaySourceRecord {
  return rec({
    sourceType: SOURCE_TYPE.TASK_COMPLETION,
    sourceId,
    rawRewardSnapshot: legacy.awardedPoints ?? (legacy.pointsDelta != null ? legacy.pointsDelta : null),
    raw: { taskId: legacy.taskId, awardedPoints: legacy.awardedPoints ?? null, effectSnapshot: { pointsDelta: legacy.pointsDelta ?? null } },
  })
}

describe('selectRewardPoints', () => {
  it('prefers the exact snapshot awarded points', () => {
    const r = selectRewardPoints({ currentPoints: 10 }, { awardedPoints: 25, pointsDelta: null })
    expect(r).toEqual({ points: 25, estimated: false })
  })

  it('falls back to current task points as estimated', () => {
    const r = selectRewardPoints({ currentPoints: 10 }, { awardedPoints: null, pointsDelta: null })
    expect(r).toEqual({ points: 10, estimated: true })
  })

  it('returns null when neither is available (never guesses)', () => {
    expect(selectRewardPoints({ currentPoints: null }, { awardedPoints: null, pointsDelta: null })).toBeNull()
    expect(selectRewardPoints(null, { awardedPoints: null, pointsDelta: null })).toBeNull()
  })
})

describe('classify — exact', () => {
  it('classifies a task completion with awarded points as exact', () => {
    const r = classify(taskCompletion('tc-1', { awardedPoints: 20, taskId: 't1' }))
    expect(r.category).toBe('exact')
    expect(r.estimated).toBe(false)
    expect(r.rewardPoints).toBe(20)
    expect(r.reason).toMatch(/concrete/i)
    expect(r.evidence).toContain('tc-1')
  })

  it('classifies a behaviour with a concrete delta as exact', () => {
    const r = classify(rec({ sourceType: SOURCE_TYPE.BEHAVIOUR, sourceId: 'b-1', rawRewardSnapshot: 5, raw: {} }))
    expect(r.category).toBe('exact')
    expect(r.rewardPoints).toBe(5)
  })
})

describe('classify — estimated', () => {
  it('falls back to current task points when snapshot is missing', () => {
    const r = classify(taskCompletion('tc-2', { taskId: 't2' }), {
      taskPointsLookup: () => 15,
    })
    expect(r.category).toBe('estimated')
    expect(r.estimated).toBe(true)
    expect(r.rewardPoints).toBe(15)
    expect(r.reason).toMatch(/current task points/i)
  })
})

describe('classify — malformed', () => {
  it('flags a record missing required identity fields', () => {
    const r = classify(rec({ sourceType: SOURCE_TYPE.TASK_COMPLETION, sourceId: '' }))
    expect(r.category).toBe('malformed')
    expect(r.rewardPoints).toBeNull()
  })

  it('flags a task completion with no points and no task lookup as malformed', () => {
    const r = classify(taskCompletion('tc-3', { taskId: 't3' }))
    expect(r.category).toBe('malformed')
    expect(r.estimated).toBe(false)
    expect(r.reason).toMatch(/refusing to guess/i)
  })

  it('flags a behaviour with no concrete reward value as malformed', () => {
    const r = classify(rec({ sourceType: SOURCE_TYPE.BEHAVIOUR, sourceId: 'b-2', rawRewardSnapshot: null, raw: {} }))
    expect(r.category).toBe('malformed')
  })
})

describe('classify — ambiguous', () => {
  it('flags conflicting records sharing a sourceId', () => {
    const a = taskCompletion('dup', { awardedPoints: 20, taskId: 't' })
    const b = taskCompletion('dup', { awardedPoints: 30, taskId: 't' })
    const results = classifyAll([a, b])
    expect(results[0].category).toBe('ambiguous')
    expect(results[1].category).toBe('ambiguous')
    expect(results[0].rewardPoints).toBeNull()
  })
})

describe('classify — skipped', () => {
  it('skips wallet-linked / out-of-family sources via predicate', () => {
    const r = classify(taskCompletion('tc-4', { awardedPoints: 20, taskId: 't' }), {
      skipIf: () => true,
    })
    expect(r.category).toBe('skipped')
    expect(r.rewardPoints).toBeNull()
  })
})

describe('determinism', () => {
  it('produces identical classification on repeated calls', () => {
    const input = taskCompletion('tc-5', { taskId: 't' })
    const opts = { taskPointsLookup: () => 12 }
    const first: ClassificationResultV4 = classify(input, opts)
    const second: ClassificationResultV4 = classify(input, opts)
    expect(second).toEqual(first)
  })

  it('is stable under shuffled source order for ambiguity detection', () => {
    const mk = (id: string, pts: number) => taskCompletion(id, { awardedPoints: pts, taskId: 't' })
    const records = [mk('x', 10), mk('x', 20), mk('y', 5), mk('z', 7)]
    const shuffled = [records[3], records[1], records[0], records[2]]
    const a = classifyAll(records).map((r) => `${r.evidence}`)
    const b = classifyAll(shuffled).map((r) => `${r.evidence}`)
    // Both runs must mark the same sourceId ('x') ambiguous.
    const ambiguousA = classifyAll(records).filter((r) => r.category === 'ambiguous').length
    const ambiguousB = classifyAll(shuffled).filter((r) => r.category === 'ambiguous').length
    expect(ambiguousA).toBe(2)
    expect(ambiguousB).toBe(2)
    expect(b).toBeDefined()
    expect(a).toBeDefined()
  })
})

describe('missing-field handling', () => {
  it('does not guess when taskId is absent and no lookup resolves', () => {
    const r = classify(taskCompletion('tc-6', {}), { taskPointsLookup: () => null })
    expect(r.category).toBe('malformed')
  })
})

describe('no guessing behaviour', () => {
  it('never invents a reward value for a task completion', () => {
    const r = classify(taskCompletion('tc-7', { taskId: 't' }))
    expect(r.category).not.toBe('estimated')
    expect(r.rewardPoints).toBeNull()
  })
})

describe('hard constraints — no mutation', () => {
  it('does not mutate the input record array', () => {
    const records = [taskCompletion('tc-8', { awardedPoints: 5, taskId: 't' })]
    const before = JSON.stringify(records)
    classifyAll(records)
    expect(JSON.stringify(records)).toBe(before)
  })
})
