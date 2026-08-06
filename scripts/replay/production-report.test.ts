import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  runProductionReplay,
  emitProductionReportMarkdown,
  emitProductionReportJson,
  summarizeWalletSnapshot,
  sumSourceArrays,
  decideReportExitCode,
  type ProductionFamilyInput,
  type DisplayedMemberState,
  type WalletSnapshotManifest,
} from './production-report'
import type { LegacyFamily } from '../../src/domain/gamification/v4/replay/sources'

const CTX_UPDATED_AT = '1970-01-01T00:00:00.000Z'

function makeFamily(familyId: string, overrides: Partial<LegacyFamily> = {}): LegacyFamily {
  return {
    familyId,
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

function makeDisplayed(overrides: Partial<DisplayedMemberState> = {}): DisplayedMemberState {
  return {
    rewardPoints: 0,
    xpTotal: 0,
    level: 1,
    currentStreak: 0,
    bestStreak: 0,
    unlockedAchievementIds: [],
    unlockedAvatarIds: [],
    ...overrides,
  }
}

function readSource(): string {
  return readFileSync(resolve(process.cwd(), 'scripts/replay/production-report.ts'), 'utf8')
}

function richFamily(familyId: string): LegacyFamily {
  return makeFamily(familyId, {
    taskCompletions: [
      { id: 't1', taskId: 'ta', childId: 'm1', awardedPoints: 20, approvedAt: '2026-01-01T10:00:00.000Z', createdAt: '2026-01-01T10:00:00.000Z' },
      { id: 'est1', taskId: 'tb', childId: 'm2', approvedAt: '2026-01-02T10:00:00.000Z', createdAt: '2026-01-02T10:00:00.000Z' },
    ],
    behaviours: [
      { id: 'b1', childId: 'm1', behaviourType: 'positive', pointsDelta: 20, createdAt: '2026-01-03T10:00:00.000Z' },
      { id: 'b2', childId: 'm2', behaviourType: 'negative', pointsDelta: -5, createdAt: '2026-01-04T10:00:00.000Z' },
    ],
    redemptions: [{ id: 'r1', childId: 'm1', rewardId: 'rw1', cost: 10, createdAt: '2026-01-05T10:00:00.000Z' }],
  })
}

const RICH_OPTS = {
  updatedAt: CTX_UPDATED_AT,
  taskPointsLookup: (_familyId: string, taskId: string) => (taskId === 'tb' ? 12 : null),
}

describe('Task 3.1 — production replay report aggregates every family', () => {
  it('produces per-family totals and per-member replayed state', () => {
    const families: ProductionFamilyInput[] = [
      { family: richFamily('FAM_A') },
      { family: richFamily('FAM_B') },
    ]
    const report = runProductionReplay(families, RICH_OPTS)
    expect(report.totalFamilies).toBe(2)
    expect(report.families.map((f) => f.familyId)).toEqual(['FAM_A', 'FAM_B'])
    const famA = report.families.find((f) => f.familyId === 'FAM_A')!
    expect(famA.members['m1']).toBeDefined()
    expect(famA.members['m1'].replayed.rewardPoints).toBe(30) // task 20 + behaviour 20 - redemption 10
    expect(famA.members['m2']).toBeDefined()
    expect(famA.members['m2'].replayed.rewardPoints).toBe(7) // estimated 12 - negative 5
  })
})

describe('Task 3.1 — classification counts aggregated', () => {
  it('sums exact/estimated/malformed/ambiguous/skipped across families', () => {
    const families: ProductionFamilyInput[] = [
      { family: richFamily('FAM_A') },
      {
        family: makeFamily('FAM_B', {
          taskCompletions: [
            { id: 'mal1', taskId: 'tc', childId: 'm1', approvedAt: '2026-01-01T10:00:00.000Z', createdAt: '2026-01-01T10:00:00.000Z' },
            { id: 'dup', taskId: 'td', childId: 'm1', awardedPoints: 5, approvedAt: '2026-01-02T10:00:00.000Z', createdAt: '2026-01-02T10:00:00.000Z' },
            { id: 'dup', taskId: 'td', childId: 'm1', awardedPoints: 5, approvedAt: '2026-01-02T10:00:00.000Z', createdAt: '2026-01-02T10:00:00.000Z' },
          ],
        }),
      },
    ]
    const report = runProductionReplay(families, RICH_OPTS)
    // FAM_A: 2 exact (t1,b1) + 1 estimated (est1) + 1 exact (b2) + 1 exact (r1) = 4 exact, 1 estimated
    // FAM_B: 1 malformed (mal1) + 2 ambiguous (dup)
    expect(report.counts.exact).toBe(4)
    expect(report.counts.estimated).toBe(1)
    expect(report.counts.malformed).toBe(1)
    expect(report.counts.ambiguous).toBe(2)
    expect(report.counts.skipped).toBe(0)
    expect(report.totalSources).toBe(8)
    expect(report.totalEventsBuilt).toBe(5) // exact + estimated only
  })
})

describe('Task 3.1 — difference vs displayed', () => {
  it('computes replayed − displayed per member when displayed provided', () => {
    const families: ProductionFamilyInput[] = [
      {
        family: makeFamily('FAM_A', {
          taskCompletions: [
            { id: 't1', taskId: 'ta', childId: 'm1', awardedPoints: 20, approvedAt: '2026-01-01T10:00:00.000Z', createdAt: '2026-01-01T10:00:00.000Z' },
          ],
        }),
        displayed: {
          m1: makeDisplayed({ rewardPoints: 10, xpTotal: 5, level: 1, currentStreak: 0, bestStreak: 0 }),
        },
      },
    ]
    const report = runProductionReplay(families, { updatedAt: CTX_UPDATED_AT })
    const m = report.families[0].members['m1']
    expect(m.displayed).toBeDefined()
    expect(m.diff).toBeDefined()
    expect(m.diff!.rewardPoints).toBe(10) // 20 - 10
    expect(m.diff!.xpTotal).toBe(15) // 20 - 5
    expect(m.diff!.level).toBe(m.replayed.level - 1)
  })

  it('omits diff when displayed not provided', () => {
    const families: ProductionFamilyInput[] = [
      {
        family: makeFamily('FAM_A', {
          taskCompletions: [
            { id: 't1', taskId: 'ta', childId: 'm1', awardedPoints: 20, approvedAt: '2026-01-01T10:00:00.000Z', createdAt: '2026-01-01T10:00:00.000Z' },
          ],
        }),
      },
    ]
    const report = runProductionReplay(families, { updatedAt: CTX_UPDATED_AT })
    const m = report.families[0].members['m1']
    expect(m.displayed).toBeUndefined()
    expect(m.diff).toBeUndefined()
    expect(report.families[0].displayedProvided).toBe(false)
  })
})

describe('Task 3.1 — wallet shown only as hashes', () => {
  const manifest: WalletSnapshotManifest = {
    tool: 'wallet-snapshot',
    globalSha256: 'globalhash',
    totalCount: 2,
    collections: {
      wallets: { count: 2, sha256: 'wallethash', docs: { 'families/F/wallets/c': 'SECRET_BALANCE_999' } },
    },
  }

  it('summarizes to hashes only (drops the docs map)', () => {
    const summary = summarizeWalletSnapshot(manifest)
    expect(summary).not.toBeNull()
    expect(summary!.globalSha256).toBe('globalhash')
    expect(summary!.totalCount).toBe(2)
    expect(summary!.collections[0].name).toBe('wallets')
    expect(summary!.collections[0].count).toBe(2)
    expect(summary!.collections[0].sha256).toBe('wallethash')
    expect((summary!.collections[0] as Record<string, unknown>).docs).toBeUndefined()
  })

  it('embeds only hashes in the report and never leaks wallet values', () => {
    const families: ProductionFamilyInput[] = [{ family: richFamily('FAM_A') }]
    const report = runProductionReplay(families, { ...RICH_OPTS, walletSnapshot: manifest })
    expect(report.walletSnapshot).not.toBeNull()
    expect(report.walletSnapshot!.globalSha256).toBe('globalhash')
    const md = emitProductionReportMarkdown(report)
    expect(md).toContain('globalhash')
    expect(md).toContain('wallethash')
    expect(md).not.toContain('SECRET_BALANCE_999')
  })

  it('reports null wallet snapshot when none supplied', () => {
    const report = runProductionReplay([{ family: richFamily('FAM_A') }], RICH_OPTS)
    expect(report.walletSnapshot).toBeNull()
  })
})

describe('Task 3.1 — emitters contain every required metric', () => {
  it('markdown + json include gate, totals, and wallet hashes', () => {
    const manifest: WalletSnapshotManifest = {
      globalSha256: 'globalhash',
      totalCount: 1,
      collections: { wallets: { count: 1, sha256: 'wallethash' } },
    }
    const families: ProductionFamilyInput[] = [{ family: richFamily('FAM_A') }]
    const report = runProductionReplay(families, { ...RICH_OPTS, walletSnapshot: manifest })
    const md = emitProductionReportMarkdown(report)
    const json = emitProductionReportJson(report)
    for (const out of [md, json]) {
      expect(out).toContain('GATE_1_REACHED')
      expect(out).toContain('exact')
      expect(out).toContain('estimated')
      expect(out).toContain('malformed')
      expect(out).toContain('ambiguous')
      expect(out).toContain('skipped')
    }
    expect(md).toContain('globalhash')
    expect(json).toContain('"gate": "GATE_1_REACHED"')
  })
})

describe('Task 3.1 — deterministic output', () => {
  it('is byte-identical for the same input run twice', () => {
    const families: ProductionFamilyInput[] = [{ family: richFamily('FAM_A') }]
    const a = emitProductionReportJson(runProductionReplay(families, RICH_OPTS))
    const b = emitProductionReportJson(runProductionReplay(families, RICH_OPTS))
    expect(a).toBe(b)
  })
})

describe('Task 3.1 — family-level replay error is recorded, not fatal', () => {
  it('records an error for a reader-malformed family and still reports others', () => {
    const families: ProductionFamilyInput[] = [
      {
        family: makeFamily('FAM_BAD', {
          // missing taskId → reader-level MalformedSourceError
          taskCompletions: [{ id: 't1', childId: 'm1', awardedPoints: 20, approvedAt: '2026-01-01T10:00:00.000Z', createdAt: '2026-01-01T10:00:00.000Z' }],
        }),
      },
      { family: richFamily('FAM_OK') },
    ]
    const report = runProductionReplay(families, RICH_OPTS)
    expect(report.totalFamilies).toBe(2)
    const bad = report.families.find((f) => f.familyId === 'FAM_BAD')!
    expect(bad.error).toBeDefined()
    expect(bad.members).toEqual({})
    const ok = report.families.find((f) => f.familyId === 'FAM_OK')!
    expect(ok.error).toBeUndefined()
    expect(ok.members['m1']).toBeDefined()
  })
})

describe('Task 3.1 — no Firestore imports', () => {
  it('does not import any Firestore SDK', () => {
    for (const line of readSource().split('\n').filter((l) => l.trim().startsWith('import'))) {
      expect(line).not.toMatch(/firebase-admin|@google-cloud\/firestore|firebase\/firestore|firestore/)
    }
  })
})

describe('Task 3.1 — no wallet imports', () => {
  it('does not import any wallet / payments module', () => {
    for (const line of readSource().split('\n').filter((l) => l.trim().startsWith('import'))) {
      expect(line).not.toMatch(/wallet|payment|allowance|pet\s*box|savings|money\s*transfer/i)
    }
  })
})

describe('Task 3.1 — no write methods / no production mutation path', () => {
  it('exposes no Firestore write methods and no gamification collection writes', () => {
    const src = readSource()
    expect(src).not.toMatch(/\.(set|update|add|delete|create|merge)\s*\(/)
    expect(src).not.toMatch(/collection\s*\(\s*['"]gamification|doc\s*\(\s*['"]gamification/)
    expect(src).not.toMatch(/admin\s*\./)
    expect(src).not.toMatch(/import\s+.*functions\//)
    expect(src).not.toMatch(/export\s+(async\s+)?function\s+(write|persist|save|commit|mutate)/)
  })

  it('does not mutate its input families', () => {
    const families: ProductionFamilyInput[] = [{ family: richFamily('FAM_A') }]
    const snapshot = JSON.stringify(families)
    runProductionReplay(families, RICH_OPTS)
    expect(JSON.stringify(families)).toBe(snapshot)
  })
})

describe('sumSourceArrays (displayed summaries are NOT sources)', () => {
  it('counts only the seven legacy source collections, never displayed', () => {
    const family = makeFamily('FAM_1', {
      taskCompletions: [{ id: 't1' } as never, { id: 't2' } as never],
      behaviours: [{ id: 'b1' } as never],
    })
    expect(sumSourceArrays(family)).toBe(3)
  })
})

describe('decideReportExitCode (Gate 1 hard failure)', () => {
  it('fails when families present but zero sources', () => {
    expect(decideReportExitCode({ totalFamilies: 42, totalSources: 0, expectedSources: 0 })).toBe(1)
  })
  it('fails when more sources are reported than exist in the fixtures (leak)', () => {
    // e.g. displayed gamification summaries accidentally counted as sources
    expect(decideReportExitCode({ totalFamilies: 42, totalSources: 200, expectedSources: 198 })).toBe(1)
  })
  it('passes for a valid non-zero replay with no leak', () => {
    expect(decideReportExitCode({ totalFamilies: 42, totalSources: 127, expectedSources: 198 })).toBe(0)
  })
})
