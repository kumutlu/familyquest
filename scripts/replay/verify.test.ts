import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { verifyReplay, type ReplayVerificationResult } from './verify'
import type { ReplayDryRunContext } from './run-dry-run'
import type { LegacyFamily } from '../../src/domain/gamification/v4/replay/sources'

const CTX: ReplayDryRunContext = { familyId: 'FAM1', updatedAt: '1970-01-01T00:00:00.000Z', projectionVersion: 1 }

function makeFamily(overrides: Partial<LegacyFamily> = {}): LegacyFamily {
  return {
    familyId: 'FAM1', taskCompletions: [], behaviours: [], dailyProgress: [], redemptions: [],
    reversals: [], avatarUnlocks: [], manualAdjustments: [], ...overrides,
  }
}

function checkPassed(result: ReplayVerificationResult, name: string): boolean {
  const c = result.checks.find((x) => x.name === name)
  expect(c, `missing check "${name}"`).toBeDefined()
  return c!.passed
}

function readSource(): string {
  return readFileSync(resolve(process.cwd(), 'scripts/replay/verify.ts'), 'utf8')
}

function richFamily(): LegacyFamily {
  return makeFamily({
    taskCompletions: [
      { id: 't1', taskId: 'ta', childId: 'm1', awardedPoints: 20, approvedAt: '2026-01-01T10:00:00.000Z', createdAt: '2026-01-01T10:00:00.000Z' },
      { id: 't2', taskId: 'tb', childId: 'm2', awardedPoints: 15, approvedAt: '2026-01-02T10:00:00.000Z', createdAt: '2026-01-02T10:00:00.000Z' },
      { id: 'est1', taskId: 'tc', childId: 'm1', approvedAt: '2026-01-03T10:00:00.000Z', createdAt: '2026-01-03T10:00:00.000Z' },
      { id: 'mal1', taskId: 'td', childId: 'm1', approvedAt: '2026-01-04T10:00:00.000Z', createdAt: '2026-01-04T10:00:00.000Z' },
    ],
    behaviours: [
      { id: 'b1', childId: 'm1', behaviourType: 'positive', pointsDelta: 20, createdAt: '2026-01-05T10:00:00.000Z' },
      { id: 'b2', childId: 'm2', behaviourType: 'negative', pointsDelta: -5, createdAt: '2026-01-06T10:00:00.000Z' },
    ],
    dailyProgress: [{ id: 'd1', childId: 'm1', dayKey: '2026-01-07', perfectDay: true, rewardPointsAward: 10, createdAt: '2026-01-07T20:00:00.000Z' }],
    redemptions: [{ id: 'r1', childId: 'm1', rewardId: 'rw1', cost: 10, createdAt: '2026-01-08T10:00:00.000Z' }],
    reversals: [{ id: 'rev1', childId: 'm1', kind: 'REV', originalSourceId: 't1', rewardPointsDelta: -20, createdAt: '2026-01-09T10:00:00.000Z' }],
    avatarUnlocks: [{ id: 'a1', childId: 'm1', avatarId: 'av1', costPoints: 5, createdAt: '2026-01-10T10:00:00.000Z' }],
    manualAdjustments: [{ id: 'man1', childId: 'm2', rpDelta: 3, xpDelta: 0, reason: 'correction', createdAt: '2026-01-11T10:00:00.000Z' }],
  })
}

const RICH_CTX: ReplayDryRunContext = { ...CTX, taskPointsLookup: (id) => (id === 'tc' ? 12 : null) }

describe('Task 2.5 — complete replay verification flow', () => {
  it('passes every invariant on a rich family with all source classes', () => {
    const result = verifyReplay(richFamily(), RICH_CTX)
    expect(result.passed).toBe(true)
    expect(result.checks.length).toBe(10)
    expect(result.reducerRebuildEqual).toBe(true)
    expect(result.walletDataIncluded).toBe(false)
    expect(result.hiddenFallbackUsed).toBe(false)
    expect(result.events.length).toBe(10)
    expect(result.report.counts.exact).toBe(9)
    expect(result.report.counts.estimated).toBe(1)
    expect(result.report.counts.malformed).toBe(1)
  })
})

describe('Task 2.5 — deterministic repeated execution', () => {
  it('produces identical replay output when run twice', () => {
    expect(checkPassed(verifyReplay(richFamily(), RICH_CTX), 'deterministicRepeated')).toBe(true)
  })
})

describe('Task 2.5 — shuffled input invariance', () => {
  it('produces identical replay output when source order is shuffled', () => {
    expect(checkPassed(verifyReplay(richFamily(), RICH_CTX), 'shuffledInvariance')).toBe(true)
  })
})

describe('Task 2.5 — reducer/rebuild equality', () => {
  it('rebuildStateFromLedger() equals reduceGamificationEventsV4() for every member', () => {
    const result = verifyReplay(richFamily(), RICH_CTX)
    expect(checkPassed(result, 'reducerRebuildEquality')).toBe(true)
    expect(result.reducerRebuildEqual).toBe(true)
  })
})

describe('Task 2.5 — malformed exclusion', () => {
  it('never lets malformed sources enter replay state', () => {
    const result = verifyReplay(makeFamily({
      taskCompletions: [{ id: 'mal1', taskId: 'td', childId: 'm1', approvedAt: '2026-01-04T10:00:00.000Z', createdAt: '2026-01-04T10:00:00.000Z' }],
    }), CTX)
    expect(result.report.counts.malformed).toBe(1)
    expect(checkPassed(result, 'malformedExcluded')).toBe(true)
    expect(result.events.length).toBe(0)
    expect(result.replayedMembers).toEqual({})
  })
})

describe('Task 2.5 — ambiguous exclusion', () => {
  it('never lets ambiguous (duplicate sourceId) sources enter replay state', () => {
    const result = verifyReplay(makeFamily({
      taskCompletions: [
        { id: 'dup', taskId: 'td', childId: 'm1', awardedPoints: 5, approvedAt: '2026-01-04T10:00:00.000Z', createdAt: '2026-01-04T10:00:00.000Z' },
        { id: 'dup', taskId: 'td', childId: 'm1', awardedPoints: 5, approvedAt: '2026-01-04T10:00:00.000Z', createdAt: '2026-01-04T10:00:00.000Z' },
      ],
    }), CTX)
    expect(result.report.counts.ambiguous).toBe(2)
    expect(checkPassed(result, 'ambiguousExcluded')).toBe(true)
    expect(result.events.length).toBe(0)
  })
})

describe('Task 2.5 — skipped exclusion', () => {
  it('never lets skipped sources affect gamification state', () => {
    const result = verifyReplay(makeFamily({
      taskCompletions: [
        { id: 'keep', taskId: 'ta', childId: 'm1', awardedPoints: 20, approvedAt: '2026-01-01T10:00:00.000Z', createdAt: '2026-01-01T10:00:00.000Z' },
        { id: 'skipme', taskId: 'tb', childId: 'm1', awardedPoints: 3, approvedAt: '2026-01-02T10:00:00.000Z', createdAt: '2026-01-02T10:00:00.000Z' },
      ],
    }), { ...CTX, skipIf: (s) => s.sourceId === 'skipme' })
    expect(result.report.counts.skipped).toBe(1)
    expect(checkPassed(result, 'skippedExcluded')).toBe(true)
    expect(result.events.length).toBe(1)
    expect(result.replayedMembers['m1'].rewardPoints).toBe(20)
  })
})

describe('Task 2.5 — report reconciliation', () => {
  it('report counts match classified source totals and reconcile to the total', () => {
    const result = verifyReplay(richFamily(), RICH_CTX)
    expect(checkPassed(result, 'reportReconciliation')).toBe(true)
    expect(checkPassed(result, 'reportTotalsReconcile')).toBe(true)
    const c = result.report.counts
    expect(c.exact + c.estimated + c.malformed + c.ambiguous + c.skipped).toBe(result.report.totalSources)
  })
})

describe('Task 2.5 — no Firestore imports', () => {
  it('does not import any Firestore SDK', () => {
    for (const line of readSource().split('\n').filter((l) => l.trim().startsWith('import'))) {
      expect(line).not.toMatch(/firebase-admin|@google-cloud\/firestore|firebase\/firestore|firestore/)
    }
  })
})

describe('Task 2.5 — no wallet imports', () => {
  it('does not import any wallet / payments module', () => {
    for (const line of readSource().split('\n').filter((l) => l.trim().startsWith('import'))) {
      expect(line).not.toMatch(/wallet|payment|allowance|pet\s*box|savings|money\s*transfer/i)
    }
  })
})

describe('Task 2.5 — no write methods / no production mutation path', () => {
  it('exposes no write methods and no gamification collection writes', () => {
    const src = readSource()
    expect(src).not.toMatch(/\.(set|update|add|delete|create|merge)\s*\(/)
    expect(src).not.toMatch(/collection\s*\(\s*['"]gamification|doc\s*\(\s*['"]gamification/)
    expect(src).not.toMatch(/admin\s*\./)
    expect(src).not.toMatch(/import\s+.*functions\//)
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+(write|persist|save|commit|mutate)/)
  })

  it('does not mutate its input family', () => {
    const family = richFamily()
    const snapshot = JSON.stringify(family)
    verifyReplay(family, RICH_CTX)
    expect(JSON.stringify(family)).toBe(snapshot)
  })
})
