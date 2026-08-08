import { describe, expect, it } from 'vitest'
import {
  BACKFILL_SOURCE,
  classifyCandidate,
  formatReport,
  parseArgs,
  planSummaryWrite,
  reconstructXp,
  runBackfill,
  type BackfillStore,
  type BehaviourEventRecord,
  type CompletionRecord,
  type FamilyRecord,
  type GamificationEventRecord,
  type MemberRecord,
  type SummaryRecord,
  type SummaryXpWrite,
} from './backfill-gamification-xp'

const CUTOVER = 1_700_000_000_000
const BEFORE = CUTOVER - 86_400_000
const AFTER = CUTOVER + 86_400_000
const NOW = CUTOVER + 10_000_000

interface World {
  families: FamilyRecord[]
  members: MemberRecord[]
  summaries: Record<string, SummaryRecord>
  completions: Record<string, CompletionRecord[]>
  behaviour: Record<string, BehaviourEventRecord[]>
  events: Record<string, GamificationEventRecord[]>
  rewardPoints: Record<string, number>
}

function completion(overrides: Partial<CompletionRecord> = {}): CompletionRecord {
  return {
    id: overrides.id ?? 'c1',
    assigneeId: overrides.assigneeId ?? 'child-1',
    status: overrides.status ?? 'approved',
    approvedAtMillis: overrides.approvedAtMillis ?? BEFORE,
    awardedPoints: 'awardedPoints' in overrides ? overrides.awardedPoints : 20,
    snapshotRewardPoints: overrides.snapshotRewardPoints,
    revoked: overrides.revoked ?? false,
  }
}

function summary(overrides: Partial<SummaryRecord> = {}): SummaryRecord {
  return {
    xpTotal: 0,
    level: 1,
    projectionStatus: 'ready',
    rebuildRequired: false,
    currentStreak: 0,
    bestStreak: 0,
    ...overrides,
  }
}

function member(overrides: Partial<MemberRecord> = {}): MemberRecord {
  return {
    id: 'child-1',
    familyId: 'family-1',
    displayName: 'Mnalium',
    role: 'child',
    lifetimeXP: 40,
    rewardPoints: 350,
    ...overrides,
  }
}

function world(overrides: Partial<World> = {}): World {
  return {
    families: [{ id: 'family-1', migrationStatus: 'active', cutoverAtMillis: CUTOVER }],
    members: [member()],
    summaries: { 'family-1/child-1': summary() },
    completions: {
      'family-1/child-1': [
        completion({ id: 'c1', awardedPoints: 20 }),
        completion({ id: 'c2', awardedPoints: 20 }),
      ],
    },
    behaviour: {},
    events: {},
    rewardPoints: { 'child-1': 350 },
    ...overrides,
  }
}

function store(state: World): BackfillStore & { writes: Array<{ key: string; write: SummaryXpWrite }> } {
  const writes: Array<{ key: string; write: SummaryXpWrite }> = []
  return {
    writes,
    async listFamilies() { return state.families },
    async listChildren(familyId) { return state.members.filter(m => m.familyId === familyId) },
    async getSummary(familyId, memberId) { return state.summaries[`${familyId}/${memberId}`] },
    async listApprovedCompletions(familyId, memberId) { return state.completions[`${familyId}/${memberId}`] ?? [] },
    async listBehaviourEvents(familyId, memberId) { return state.behaviour[`${familyId}/${memberId}`] ?? [] },
    async listGamificationEvents(familyId, memberId) { return state.events[`${familyId}/${memberId}`] ?? [] },
    async writeSummaryXp(familyId, memberId, write) {
      const key = `${familyId}/${memberId}`
      writes.push({ key, write })
      state.summaries[key] = {
        ...state.summaries[key],
        xpTotal: write.xpTotal,
        level: write.level,
        backfill: write.backfill,
      }
    },
  }
}

describe('reconstructXp', () => {
  it('sums only pre-cutover approved task rewards', () => {
    const outcome = reconstructXp({
      cutoverAtMillis: CUTOVER,
      completions: [
        completion({ id: 'a', awardedPoints: 20 }),
        completion({ id: 'b', awardedPoints: 5, approvedAtMillis: AFTER }),
        completion({ id: 'c', awardedPoints: 15, status: 'pending' }),
      ],
      behaviourEvents: [],
    })
    expect(outcome.reconstruction).toMatchObject({ taskXp: 20, behaviourXp: 0, reversalDelta: 0, reconstructedXp: 20 })
  })

  it('adds positive pre-cutover behaviour XP and ignores negative deltas', () => {
    const outcome = reconstructXp({
      cutoverAtMillis: CUTOVER,
      completions: [],
      behaviourEvents: [
        { id: 'b1', userId: 'child-1', pointsDelta: 10, timestampMillis: BEFORE, revoked: false },
        { id: 'b2', userId: 'child-1', pointsDelta: -10, timestampMillis: BEFORE, revoked: false },
        { id: 'b3', userId: 'child-1', pointsDelta: 7, timestampMillis: AFTER, revoked: false },
      ],
    })
    expect(outcome.reconstruction).toMatchObject({ behaviourXp: 10, reconstructedXp: 10 })
  })

  it('subtracts reversed awards through the reversal delta', () => {
    const outcome = reconstructXp({
      cutoverAtMillis: CUTOVER,
      completions: [
        completion({ id: 'a', awardedPoints: 20 }),
        completion({ id: 'b', awardedPoints: 30, revoked: true }),
      ],
      behaviourEvents: [],
    })
    expect(outcome.reconstruction).toMatchObject({ taskXp: 50, reversalDelta: -30, reconstructedXp: 20 })
  })

  it('refuses to guess when a completion has no authoritative reward snapshot', () => {
    const outcome = reconstructXp({
      cutoverAtMillis: CUTOVER,
      completions: [completion({ awardedPoints: undefined })],
      behaviourEvents: [],
    })
    expect(outcome.reconstruction).toBeUndefined()
    expect(outcome.unresolved).toBe('completion_missing_reward_snapshot')
  })
})

describe('classifyCandidate eligibility', () => {
  const family: FamilyRecord = { id: 'family-1', migrationStatus: 'active', cutoverAtMillis: CUTOVER }
  const base = {
    family,
    member: member(),
    summary: summary(),
    gamificationEvents: [] as GamificationEventRecord[],
    completions: [completion({ id: 'c1' }), completion({ id: 'c2' })],
    behaviourEvents: [] as BehaviourEventRecord[],
  }

  it('detects a zero-XP summary with pre-cutover history that reconciles exactly', () => {
    const report = classifyCandidate(base)
    expect(report).toMatchObject({
      familyId: 'family-1',
      memberId: 'child-1',
      displayName: 'Mnalium',
      legacyLifetimeXp: 40,
      currentXpTotal: 0,
      reconstructedTaskXp: 40,
      reconstructedBehaviourXp: 0,
      reversalDelta: 0,
      finalReconstructedXp: 40,
      reconciliation: 'reconciled_exact',
      action: 'write',
      skipReason: null,
    })
  })

  it.each([
    ['summary_missing', { summary: undefined }],
    ['projection_not_ready', { summary: summary({ projectionStatus: 'rebuilding' }) }],
    ['projection_not_ready', { summary: summary({ rebuildRequired: true }) }],
    ['summary_xp_already_populated', { summary: summary({ xpTotal: 120 }) }],
    ['not_a_child', { member: member({ role: 'parent' }) }],
    ['family_has_no_cutover', { family: { id: 'family-1', migrationStatus: 'inactive', cutoverAtMillis: undefined } }],
    ['no_pre_cutover_history', { completions: [completion({ approvedAtMillis: AFTER })] }],
  ])('skips with reason %s', (reason, override) => {
    expect(classifyCandidate({ ...base, ...override } as never).skipReason).toBe(reason)
  })

  it('skips members whose history is already represented by gamification events', () => {
    const report = classifyCandidate({
      ...base,
      gamificationEvents: [{ id: 'e1', childId: 'child-1', eventType: 'xp_awarded', xpDelta: 20 }],
    })
    expect(report.skipReason).toBe('gamification_events_already_present')
  })

  it('classifies but never writes an unresolved reconciliation', () => {
    const report = classifyCandidate({ ...base, member: member({ lifetimeXP: 999 }) })
    expect(report.action).toBe('skip')
    expect(report.skipReason).toBe('unresolved_reconciliation')
    expect(report.reconciliation).toBe('discrepancy_reconstructed_lower')
    expect(report.finalReconstructedXp).toBe(40)
    expect(report.legacyLifetimeXp).toBe(999)
  })
})

describe('planSummaryWrite', () => {
  it('recalculates level and progress with the canonical helper', () => {
    expect(planSummaryWrite(2500, NOW)).toEqual({
      xpTotal: 2500,
      level: 3,
      xpProgressInLevel: 500,
      xpToNextLevel: 500,
      backfill: { version: 1, source: BACKFILL_SOURCE, reconstructedXp: 2500, appliedAtMillis: NOW },
    })
  })
})

describe('runBackfill', () => {
  it('is dry-run by default and writes nothing', async () => {
    const state = world()
    const target = store(state)
    const result = await runBackfill(target, { execute: false, nowMillis: NOW })
    expect(result.dryRun).toBe(true)
    expect(result.written).toBe(0)
    expect(target.writes).toHaveLength(0)
    expect(result.candidates[0]).toMatchObject({ action: 'write', finalReconstructedXp: 40 })
    expect(state.summaries['family-1/child-1'].xpTotal).toBe(0)
  })

  it('execute writes reconstructed XP and never touches rewardPoints', async () => {
    const state = world()
    const target = store(state)
    const result = await runBackfill(target, { execute: true, nowMillis: NOW })
    expect(result.written).toBe(1)
    expect(state.summaries['family-1/child-1']).toMatchObject({ xpTotal: 40, level: 1 })
    expect(state.rewardPoints['child-1']).toBe(350)
    // no store method exists that can write rewardPoints
    expect(Object.keys(target)).not.toContain('writeRewardPoints')
  })

  it('preserves streaks when writing', async () => {
    const state = world({ summaries: { 'family-1/child-1': summary({ currentStreak: 2, bestStreak: 6 }) } })
    await runBackfill(store(state), { execute: true, nowMillis: NOW })
    expect(state.summaries['family-1/child-1']).toMatchObject({ currentStreak: 2, bestStreak: 6, xpTotal: 40 })
  })

  it('re-executing is a no-op', async () => {
    const state = world()
    const first = store(state)
    await runBackfill(first, { execute: true, nowMillis: NOW })
    const second = store(state)
    const result = await runBackfill(second, { execute: true, nowMillis: NOW + 1 })
    expect(second.writes).toHaveLength(0)
    expect(result.written).toBe(0)
    expect(result.candidates[0].skipReason).toBe('already_backfilled')
    expect(state.summaries['family-1/child-1'].xpTotal).toBe(40)
  })

  it('rerunning the dry-run after execute reports zero remaining safe candidates', async () => {
    const state = world()
    await runBackfill(store(state), { execute: true, nowMillis: NOW })
    const result = await runBackfill(store(state), { execute: false, nowMillis: NOW })
    expect(result.candidates.filter(candidate => candidate.action === 'write')).toHaveLength(0)
  })

  it('supports family and member filters', async () => {
    const state = world({
      families: [
        { id: 'family-1', migrationStatus: 'active', cutoverAtMillis: CUTOVER },
        { id: 'family-2', migrationStatus: 'active', cutoverAtMillis: CUTOVER },
      ],
      members: [member(), member({ id: 'child-2', displayName: 'Ali' }), member({ id: 'child-3', familyId: 'family-2' })],
    })
    const byFamily = await runBackfill(store(state), { execute: false, familyId: 'family-1', nowMillis: NOW })
    expect(byFamily.candidates.map(c => c.memberId)).toEqual(['child-1', 'child-2'])
    const byMember = await runBackfill(store(state), { execute: false, memberId: 'child-2', nowMillis: NOW })
    expect(byMember.candidates.map(c => c.memberId)).toEqual(['child-2'])
  })

  it('pages deterministically and exposes a resumable cursor', async () => {
    const state = world({
      families: [
        { id: 'family-b', migrationStatus: 'active', cutoverAtMillis: CUTOVER },
        { id: 'family-a', migrationStatus: 'active', cutoverAtMillis: CUTOVER },
        { id: 'family-c', migrationStatus: 'active', cutoverAtMillis: CUTOVER },
      ],
      members: [],
    })
    const page1 = await runBackfill(store(state), { execute: false, limit: 2, nowMillis: NOW })
    expect(page1.familiesScanned).toBe(2)
    expect(page1.nextCursor).toBe('family-b')
    const page2 = await runBackfill(store(state), { execute: false, limit: 2, startAfterFamilyId: page1.nextCursor!, nowMillis: NOW })
    expect(page2.familiesScanned).toBe(1)
    expect(page2.nextCursor).toBe('family-c')
  })

  it('produces a deterministic report listing every proposed write and discrepancy', async () => {
    const state = world({
      members: [member(), member({ id: 'child-2', displayName: 'Ali', lifetimeXP: 999 })],
      summaries: { 'family-1/child-1': summary(), 'family-1/child-2': summary() },
      completions: {
        'family-1/child-1': [completion({ id: 'c1' }), completion({ id: 'c2' })],
        'family-1/child-2': [completion({ id: 'd1', assigneeId: 'child-2' })],
      },
    })
    const result = await runBackfill(store(state), { execute: false, nowMillis: NOW })
    const report = formatReport(result)
    expect(report).toContain('mode: dry-run')
    expect(report).toContain('proposedWrites: 1')
    expect(report).toContain('discrepancies: 1')
    expect(report.indexOf('memberId=child-1')).toBeLessThan(report.indexOf('memberId=child-2'))
    expect(formatReport(result)).toBe(report)
  })
})

describe('parseArgs', () => {
  it('defaults to dry-run', () => {
    expect(parseArgs([], NOW)).toMatchObject({ execute: false, familyId: undefined, memberId: undefined })
  })

  it('parses execute, filters and paging', () => {
    expect(parseArgs(['--execute', '--family=f1', '--member=m1', '--limit=5', '--start-after=f0'], NOW)).toMatchObject({
      execute: true, familyId: 'f1', memberId: 'm1', limit: 5, startAfterFamilyId: 'f0',
    })
  })

  it('rejects an invalid limit', () => {
    expect(() => parseArgs(['--limit=0'], NOW)).toThrow('--limit must be a positive integer')
  })
})
