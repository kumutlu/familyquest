import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  runReplayDryRun,
  type ReplayDryRunContext,
} from './run-dry-run'
import type { LegacyFamily } from '../../src/domain/gamification/v4/replay/sources'

const CTX: ReplayDryRunContext = {
  familyId: 'FAM1',
  updatedAt: '1970-01-01T00:00:00.000Z',
  projectionVersion: 1,
}

function makeFamily(overrides: Partial<LegacyFamily> = {}): LegacyFamily {
  return {
    familyId: 'FAM1',
    taskCompletions: [],
    behaviours: [],
    dailyProgress: [],
    redemptions: [],
    reversals: [],
    avatarUnlocks: [],
    manualAdjustments: [],
    ...overrides,
  }
}

function shuffle<T>(input: readonly T[]): T[] {
  const arr = [...input]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function readSource(): string {
  return readFileSync(resolve(process.cwd(), 'scripts/replay/run-dry-run.ts'), 'utf8')
}

// The report (rows + counts) is deterministic and order-independent, so a plain
// signature of those fields is sufficient to prove "shuffled input -> identical
// report". replayedMembers determinism is covered by the Stage 1 reducer tests.
function signature(result: ReturnType<typeof runReplayDryRun>): string {
  return JSON.stringify({
    totalSources: result.totalSources,
    counts: result.counts,
    rows: result.rows,
    eventsBuilt: result.eventsBuilt,
  })
}

describe('Task 2.4 — replay dry-run produces a report', () => {
  it('produces a report and a replayed state from a non-empty family', () => {
    const family = makeFamily({
      taskCompletions: [
        { id: 't1', taskId: 'task-a', childId: 'm1', awardedPoints: 20, approvedAt: '2026-01-01T10:00:00.000Z', createdAt: '2026-01-01T10:00:00.000Z' },
      ],
    })
    const result = runReplayDryRun(family, CTX)
    expect(result.totalSources).toBe(1)
    expect(result.counts.exact).toBe(1)
    expect(result.rows.length).toBe(1)
    expect(result.eventsBuilt).toBe(1)
    expect(result.replayedMembers['m1']).toBeDefined()
    expect(result.replayedMembers['m1'].rewardPoints).toBe(20)
  })
})

describe('Task 2.4 — deterministic output', () => {
  function richFamily(): LegacyFamily {
    return makeFamily({
      taskCompletions: [
        { id: 't1', taskId: 'ta', childId: 'm1', awardedPoints: 20, approvedAt: '2026-01-01T10:00:00.000Z', createdAt: '2026-01-01T10:00:00.000Z' },
        { id: 't2', taskId: 'tb', childId: 'm2', awardedPoints: 15, approvedAt: '2026-01-02T10:00:00.000Z', createdAt: '2026-01-02T10:00:00.000Z' },
      ],
      behaviours: [
        { id: 'b1', childId: 'm1', behaviourType: 'positive', pointsDelta: 20, createdAt: '2026-01-03T10:00:00.000Z' },
        { id: 'b2', childId: 'm2', behaviourType: 'negative', pointsDelta: -5, createdAt: '2026-01-04T10:00:00.000Z' },
      ],
      redemptions: [
        { id: 'r1', childId: 'm1', rewardId: 'rw1', cost: 10, createdAt: '2026-01-05T10:00:00.000Z' },
      ],
    })
  }

  it('is byte-identical for the same input run twice', () => {
    const family = richFamily()
    expect(signature(runReplayDryRun(family, CTX))).toBe(signature(runReplayDryRun(family, CTX)))
  })

  it('is byte-identical for shuffled input', () => {
    const family = richFamily()
    const reference = signature(runReplayDryRun(family, CTX))
    const shuffled = makeFamily({
      taskCompletions: shuffle(family.taskCompletions),
      behaviours: shuffle(family.behaviours),
      redemptions: shuffle(family.redemptions),
    })
    expect(signature(runReplayDryRun(shuffled, CTX))).toBe(reference)
  })
})

describe('Task 2.4 — empty dataset', () => {
  it('handles an empty dataset without throwing', () => {
    const result = runReplayDryRun(makeFamily(), CTX)
    expect(result.totalSources).toBe(0)
    expect(result.counts).toEqual({ exact: 0, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 })
    expect(result.replayedMembers).toEqual({})
    expect(result.eventsBuilt).toBe(0)
  })
})

describe('Task 2.4 — malformed input handling (no silent failure)', () => {
  it('throws on reader-level malformed source (missing required field)', () => {
    const family = makeFamily({
      taskCompletions: [{ id: 't1', childId: 'm1', awardedPoints: 20, approvedAt: '2026-01-01T10:00:00.000Z', createdAt: '2026-01-01T10:00:00.000Z' }],
    })
    expect(() => runReplayDryRun(family, CTX)).toThrow()
  })

  it('reports classifier-level malformed without throwing and never guesses', () => {
    const family = makeFamily({
      taskCompletions: [{ id: 't1', taskId: 'task-a', childId: 'm1', approvedAt: '2026-01-01T10:00:00.000Z', createdAt: '2026-01-01T10:00:00.000Z' }],
    })
    const result = runReplayDryRun(family, CTX)
    expect(result.counts.malformed).toBe(1)
    expect(result.eventsBuilt).toBe(0)
    expect(result.replayedMembers).toEqual({})
  })
})

describe('Task 2.4 — classification counts preserved', () => {
  it('preserves exact/estimated/malformed/ambiguous/skipped counts', () => {
    const family = makeFamily({
      taskCompletions: [
        { id: 'exact1', taskId: 'ta', childId: 'm1', awardedPoints: 20, approvedAt: '2026-01-01T10:00:00.000Z', createdAt: '2026-01-01T10:00:00.000Z' },
        { id: 'est1', taskId: 'tb', childId: 'm1', approvedAt: '2026-01-02T10:00:00.000Z', createdAt: '2026-01-02T10:00:00.000Z' },
        { id: 'mal1', taskId: 'tc', childId: 'm1', approvedAt: '2026-01-03T10:00:00.000Z', createdAt: '2026-01-03T10:00:00.000Z' },
        { id: 'dup', taskId: 'td', childId: 'm1', awardedPoints: 5, approvedAt: '2026-01-04T10:00:00.000Z', createdAt: '2026-01-04T10:00:00.000Z' },
        { id: 'dup', taskId: 'td', childId: 'm1', awardedPoints: 5, approvedAt: '2026-01-04T10:00:00.000Z', createdAt: '2026-01-04T10:00:00.000Z' },
        { id: 'skipme', taskId: 'te', childId: 'm1', awardedPoints: 3, approvedAt: '2026-01-05T10:00:00.000Z', createdAt: '2026-01-05T10:00:00.000Z' },
      ],
    })
    const ctx: ReplayDryRunContext = {
      ...CTX,
      taskPointsLookup: (taskId) => (taskId === 'tb' ? 10 : null),
      skipIf: (s) => s.sourceId === 'skipme',
    }
    const result = runReplayDryRun(family, ctx)
    expect(result.counts.exact).toBe(1)
    expect(result.counts.estimated).toBe(1)
    expect(result.counts.malformed).toBe(1)
    expect(result.counts.ambiguous).toBe(2)
    expect(result.counts.skipped).toBe(1)
    expect(result.totalSources).toBe(6)
  })
})

describe('Task 2.4 — no Firestore imports', () => {
  it('does not import any Firestore SDK', () => {
    const src = readSource()
    for (const line of src.split('\n').filter((l) => l.trim().startsWith('import'))) {
      expect(line).not.toMatch(/firebase-admin|@google-cloud\/firestore|firebase\/firestore|firestore/)
    }
  })
})

describe('Task 2.4 — no wallet imports', () => {
  it('does not import any wallet / payments module', () => {
    const src = readSource()
    for (const line of src.split('\n').filter((l) => l.trim().startsWith('import'))) {
      expect(line).not.toMatch(/wallet|payment|allowance|pet\s*box|savings|money\s*transfer/i)
    }
  })
})

describe('Task 2.4 — no write methods / no production mutation path', () => {
  it('exposes no write methods and no gamification collection writes', () => {
    const src = readSource()
    expect(src).not.toMatch(/\.(set|update|add|delete|create|merge)\s*\(/)
    expect(src).not.toMatch(/collection\s*\(\s*['"]gamification|doc\s*\(\s*['"]gamification/)
    expect(src).not.toMatch(/admin\s*\./)
    expect(src).not.toMatch(/import\s+.*functions\//)
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+(write|persist|save|commit|mutate)/)
  })

  it('does not mutate its input family', () => {
    const family = makeFamily({
      taskCompletions: [{ id: 't1', taskId: 'ta', childId: 'm1', awardedPoints: 20, approvedAt: '2026-01-01T10:00:00.000Z', createdAt: '2026-01-01T10:00:00.000Z' }],
    })
    const snapshot = JSON.stringify(family)
    runReplayDryRun(family, CTX)
    expect(JSON.stringify(family)).toBe(snapshot)
  })
})
