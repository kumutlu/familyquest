import { describe, expect, it } from 'vitest'
import {
  classifyMember,
  formatBaselineReport,
  planBaselineWrite,
  planFamilyTransition,
  runBaselineMigration,
  type BaselineAuditMarker,
  type BaselineStore,
  type BaselineWrite,
  type FamilyRecord,
  type MemberActivity,
  type MemberRecord,
  type SummaryRecord,
} from './legacy-xp-baseline'
import { legacyBaselineEventId } from '../src/domain/gamification/xp'
import { rebuildGamificationSummary } from '../src/domain/gamification/engine'

const CUTOVER = 1_700_000_000_000
const NOW = 1_800_000_000_000

const family = (patch: Partial<FamilyRecord> = {}): FamilyRecord => ({
  id: 'fam1',
  hasMigrationMetadata: true,
  migrationStatus: 'prepared',
  cutoverAtMillis: CUTOVER,
  ...patch,
})

const member = (patch: Partial<MemberRecord> = {}): MemberRecord => ({
  id: 'child1',
  familyId: 'fam1',
  displayName: 'Mnalium',
  role: 'child',
  lifetimeXP: 380,
  rewardPoints: 350,
  ...patch,
})

const summary = (patch: Partial<SummaryRecord> = {}): SummaryRecord => ({
  xpTotal: 0,
  projectionStatus: 'ready',
  rebuildRequired: false,
  currentStreak: 0,
  bestStreak: 4,
  ...patch,
})

const quiet = (patch: Partial<MemberActivity> = {}): MemberActivity => ({
  gamificationEventCount: 0,
  nonZeroXpEventCount: 0,
  zeroXpEventCount: 0,
  taskOccurrenceCount: 0,
  postCutoverAwardCount: 0,
  reversalEvidence: false,
  ...patch,
})

/** Zero-XP qualification transitions, e.g. `daily_goal_qualification_changed`. */
const zeroXpEvents = (count: number): Partial<MemberActivity> => ({
  gamificationEventCount: count,
  zeroXpEventCount: count,
  nonZeroXpEventCount: 0,
})

const xpEvents = (count: number): Partial<MemberActivity> => ({
  gamificationEventCount: count,
  zeroXpEventCount: 0,
  nonZeroXpEventCount: count,
})

/* ---------------------------------------------------------------- */
/* In-memory store                                                   */
/* ---------------------------------------------------------------- */

interface Seed {
  readonly families: readonly FamilyRecord[]
  readonly members: readonly MemberRecord[]
  readonly summaries: Record<string, SummaryRecord>
  readonly activity?: Record<string, MemberActivity>
}

class MemoryStore implements BaselineStore {
  readonly summaries: Record<string, SummaryRecord & Record<string, unknown>> = {}
  readonly markers: Record<string, BaselineAuditMarker> = {}
  readonly rewardPoints: Record<string, number | undefined> = {}
  readonly statuses: Record<string, string> = {}
  readonly projections: Record<string, BaselineWrite['projection']> = {}
  applyCalls = 0

  constructor(private readonly seed: Seed) {
    for (const [key, value] of Object.entries(seed.summaries)) this.summaries[key] = { ...value }
    for (const f of seed.families) this.statuses[f.id] = f.migrationStatus ?? 'missing'
    for (const m of seed.members) this.rewardPoints[m.id] = m.rewardPoints
  }

  async listFamilies() {
    return this.seed.families.map(f => ({ ...f, migrationStatus: this.statuses[f.id] }))
  }

  async listChildren(familyId: string) {
    return this.seed.members.filter(m => m.familyId === familyId)
  }

  async getSummary(familyId: string, memberId: string) {
    return this.summaries[`${familyId}/${memberId}`]
  }

  async getActivity(f: FamilyRecord, memberId: string) {
    return this.seed.activity?.[`${f.id}/${memberId}`] ?? quiet()
  }

  async getAuditMarker(familyId: string, memberId: string) {
    return this.markers[`${familyId}/${memberId}`]
  }

  readonly events: Record<string, BaselineWrite['event']> = {}

  async applyBaseline(familyId: string, memberId: string, write: BaselineWrite) {
    this.applyCalls += 1
    const key = `${familyId}/${memberId}`
    // Strict no-op re-execution guard, mirroring the transactional adapter.
    if (this.markers[key] !== undefined || this.events[write.event.id] !== undefined) return 'noop' as const
    this.events[write.event.id] = write.event
    const current = this.summaries[key]
    if (current === undefined || current.xpTotal !== 0) return 'noop' as const
    this.summaries[key] = { ...current, xpTotal: write.projection.xpTotal }
    this.projections[key] = write.projection
    this.markers[key] = write.marker
    return 'written' as const
  }

  async setMigrationStatus(familyId: string, status: string) {
    this.statuses[familyId] = status
  }
}

const baseSeed = (): Seed => ({
  families: [family()],
  members: [member()],
  summaries: { 'fam1/child1': summary() },
})

/* ---------------------------------------------------------------- */
/* 1. eligible zero summary adopts legacy lifetimeXP                  */
/* ---------------------------------------------------------------- */

describe('legacy XP baseline migration', () => {
  it('adopts legacy lifetimeXP for an eligible zero summary', async () => {
    const store = new MemoryStore(baseSeed())
    const result = await runBaselineMigration(store, { execute: true, nowMillis: NOW })

    expect(result.reports[0].classification).toBe('eligible_legacy_baseline')
    expect(result.written).toBe(1)
    expect(store.summaries['fam1/child1'].xpTotal).toBe(380)
  })

  /* 2. rewardPoints untouched */
  it('never writes rewardPoints', async () => {
    const store = new MemoryStore(baseSeed())
    const before = JSON.stringify(store.rewardPoints)
    await runBaselineMigration(store, { execute: true, nowMillis: NOW })
    expect(JSON.stringify(store.rewardPoints)).toBe(before)
    expect(store.rewardPoints.child1).toBe(350)
  })

  /* 3. canonical level/progress recalculated */
  it('recalculates canonical level and progress fields', async () => {
    const store = new MemoryStore({
      ...baseSeed(),
      members: [member({ lifetimeXP: 2_350 })],
    })
    await runBaselineMigration(store, { execute: true, nowMillis: NOW })
    expect(store.projections['fam1/child1']).toEqual({
      xpTotal: 2_350,
      level: 3,
      xpProgressInLevel: 350,
      xpToNextLevel: 650,
      percentage: 35,
    })
  })

  /* 4. Decision 1: zero-XP qualification events do not block the baseline */
  it('adopts the baseline despite zero-XP qualification events', () => {
    const report = classifyMember({
      family: family(),
      member: member({ id: 'NuyIJDP9fDNP2LiKynlsEyzur5N2', displayName: 'Alisya', lifetimeXP: 86, rewardPoints: 71 }),
      summary: summary(),
      activity: quiet(zeroXpEvents(4)),
      existingMarker: undefined,
    })
    expect(report.classification).toBe('eligible_legacy_baseline')
    expect(report.action).toBe('write')
    expect(report.proposedBaselineXp).toBe(86)
    expect(report.zeroXpEventCount).toBe(4)
    // rewardPoints are reported only, never proposed for a write.
    expect(report.rewardPointsBefore).toBe(71)
  })

  /* 4b. positive XP events block */
  it('skips when a positive XP event already exists', () => {
    const report = classifyMember({
      family: family(),
      member: member(),
      summary: summary(),
      activity: quiet(xpEvents(1)),
      existingMarker: undefined,
    })
    expect(report.classification).toBe('post_cutover_activity_present')
    expect(report.skipReason).toBe('non_zero_xp_events_present')
  })

  /* 4c. negative / reversal XP events block */
  it('skips when a negative XP reversal event exists', () => {
    const report = classifyMember({
      family: family(),
      member: member(),
      summary: summary(),
      activity: quiet({ ...xpEvents(1), reversalEvidence: true }),
      existingMarker: undefined,
    })
    expect(report.action).toBe('skip')
    expect(report.skipReason).toBe('non_zero_xp_events_present')
  })

  /* 4d. mixed zero and non-zero events block */
  it('skips when zero-XP and non-zero-XP events are mixed', () => {
    const report = classifyMember({
      family: family(),
      member: member(),
      summary: summary(),
      activity: quiet({ gamificationEventCount: 5, zeroXpEventCount: 4, nonZeroXpEventCount: 1 }),
      existingMarker: undefined,
    })
    expect(report.classification).toBe('post_cutover_activity_present')
    expect(report.skipReason).toBe('non_zero_xp_events_present')
  })

  /* 5. occurrences alone award nothing and never block */
  it('does not block on task occurrences alone', () => {
    const report = classifyMember({
      family: family(),
      member: member(),
      summary: summary(),
      activity: quiet({ taskOccurrenceCount: 2 }),
      existingMarker: undefined,
    })
    expect(report.classification).toBe('eligible_legacy_baseline')
    expect(report.occurrenceCount).toBe(2)
  })

  /* 5b. an existing deterministic baseline event is already-baselined */
  it('treats an existing baseline event as already baselined', () => {
    const report = classifyMember({
      family: family(),
      member: member(),
      summary: summary(),
      activity: quiet({ baselineEventPresent: true }),
      existingMarker: undefined,
    })
    expect(report.classification).toBe('already_baselined')
    expect(report.skipReason).toBe('legacy_baseline_event_present')
  })

  /* 5c. the baseline event is deterministic and reward-neutral */
  it('plans a deterministic, reward-neutral baseline event', () => {
    const report = classifyMember({
      family: family(),
      member: member(),
      summary: summary(),
      activity: quiet(zeroXpEvents(2)),
      existingMarker: undefined,
    })
    const write = planBaselineWrite({ report, cutoverAtMillis: CUTOVER, nowMillis: NOW })
    expect(write.event.id).toBe(legacyBaselineEventId('fam1', 'child1'))
    expect(write.event.id).toBe(write.event.idempotencyKey)
    expect(write.event).toMatchObject({
      eventType: 'legacy_xp_baseline',
      xpDelta: 380,
      sourceType: 'migration',
      source: 'legacy_users_lifetimeXP',
      cutoverAtMillis: CUTOVER,
      migratedAtMillis: NOW,
      scriptVersion: 1,
      priorSummaryXpTotal: 0,
      rewardPointsDelta: 0,
    })
    // Replay determinism: planning twice yields the identical identity.
    expect(planBaselineWrite({ report, cutoverAtMillis: CUTOVER, nowMillis: NOW + 999 }).event.id)
      .toBe(write.event.id)
  })

  /* 6. non-zero summary -> skip */
  it('skips when the summary already has XP', () => {
    const report = classifyMember({
      family: family(),
      member: member(),
      summary: summary({ xpTotal: 25 }),
      activity: quiet(),
      existingMarker: undefined,
    })
    expect(report.classification).toBe('already_baselined')
    expect(report.action).toBe('skip')
  })

  /* 7. invalid or negative lifetimeXP -> skip */
  it.each([-1, 12.5, Number.NaN, '380', null, undefined])('skips invalid lifetimeXP %p', value => {
    const report = classifyMember({
      family: family(),
      member: member({ lifetimeXP: value }),
      summary: summary(),
      activity: quiet(),
      existingMarker: undefined,
    })
    expect(report.classification).toBe('malformed')
    expect(report.skipReason).toBe('invalid_lifetimeXP')
  })

  /* 8. second execution is a no-op */
  it('is a strict no-op on re-execution', async () => {
    const store = new MemoryStore(baseSeed())
    await runBaselineMigration(store, { execute: true, nowMillis: NOW })
    const snapshot = JSON.stringify(store.summaries)

    const second = await runBaselineMigration(store, { execute: true, nowMillis: NOW + 1 })
    expect(second.written).toBe(0)
    expect(second.reports[0].classification).toBe('already_baselined')
    expect(JSON.stringify(store.summaries)).toBe(snapshot)
  })

  /* 9. audit marker retained */
  it('writes and retains an immutable audit marker', async () => {
    const store = new MemoryStore(baseSeed())
    await runBaselineMigration(store, { execute: true, nowMillis: NOW })
    expect(store.markers['fam1/child1']).toEqual({
      familyId: 'fam1',
      memberId: 'child1',
      baselineXp: 380,
      source: 'legacy_users_lifetimeXP',
      cutoverAtMillis: CUTOVER,
      migratedAtMillis: NOW,
      scriptVersion: 1,
      priorSummaryXpTotal: 0,
    })

    await runBaselineMigration(store, { execute: true, nowMillis: NOW + 5_000 })
    expect(store.markers['fam1/child1'].migratedAtMillis).toBe(NOW)
  })

  /* 10. mixed family does not advance state */
  it('does not advance migration state while unresolved members remain', async () => {
    const store = new MemoryStore({
      families: [family()],
      members: [member(), member({ id: 'child2', displayName: 'Unresolved' })],
      summaries: {
        'fam1/child1': summary(),
        'fam1/child2': summary({ projectionStatus: 'rebuilding' }),
      },
    })
    const result = await runBaselineMigration(store, { execute: true, nowMillis: NOW })
    expect(result.transitions[0].to).toBeNull()
    expect(store.statuses.fam1).toBe('prepared')
  })

  /* 11. fully baselined family advances */
  it('advances a fully resolved family to baseline_complete', async () => {
    const store = new MemoryStore({
      families: [family()],
      members: [member(), member({ id: 'child2', displayName: 'Zero', lifetimeXP: 0, rewardPoints: 0 })],
      summaries: { 'fam1/child1': summary(), 'fam1/child2': summary() },
    })
    const result = await runBaselineMigration(store, { execute: true, nowMillis: NOW })
    expect(result.reports.map(r => r.classification)).toEqual([
      'eligible_legacy_baseline',
      'genuine_zero_xp',
    ])
    expect(result.transitions[0].to).toBe('baseline_complete')
    expect(store.statuses.fam1).toBe('baseline_complete')
  })

  it('never transitions baseline_complete to active itself', () => {
    const transition = planFamilyTransition(family({ migrationStatus: 'baseline_complete' }), [], true)
    expect(transition.to).toBeNull()
  })

  /* 12. later post-cutover XP adds on top of the baseline */
  it('adds future post-cutover XP on top of the migrated baseline', async () => {
    const store = new MemoryStore(baseSeed())
    await runBaselineMigration(store, { execute: true, nowMillis: NOW })

    // Simulate the processor awarding 40 XP after cutover.
    const key = 'fam1/child1'
    store.summaries[key] = { ...store.summaries[key], xpTotal: store.summaries[key].xpTotal + 40 }

    const rerun = await runBaselineMigration(store, { execute: true, nowMillis: NOW + 10 })
    expect(rerun.written).toBe(0)
    expect(store.summaries[key].xpTotal).toBe(420)
  })

  /* Additional guards */
  it('skips families without migration metadata or an eligible status', () => {
    expect(classifyMember({
      family: family({ hasMigrationMetadata: false, migrationStatus: undefined }),
      member: member(),
      summary: summary(),
      activity: quiet(),
      existingMarker: undefined,
    }).skipReason).toBe('family_missing_migration_metadata')

    expect(classifyMember({
      family: family({ migrationStatus: 'active' }),
      member: member(),
      summary: summary(),
      activity: quiet(),
      existingMarker: undefined,
    }).classification).toBe('unsafe_or_ambiguous')
  })

  it('skips when activity counts are indeterminate or XP was reversed', () => {
    expect(classifyMember({
      family: family(),
      member: member(),
      summary: summary(),
      activity: quiet({ indeterminate: 'occurrence_query_failed' }),
      existingMarker: undefined,
    }).classification).toBe('unsafe_or_ambiguous')

    expect(classifyMember({
      family: family(),
      member: member(),
      summary: summary(),
      activity: quiet({ reversalEvidence: true }),
      existingMarker: undefined,
    }).skipReason).toBe('xp_reversal_evidence')
  })

  it('preserves streaks in the planned write', () => {
    const report = classifyMember({
      family: family(),
      member: member(),
      summary: summary({ currentStreak: 0, bestStreak: 7 }),
      activity: quiet(),
      existingMarker: undefined,
    })
    const write = planBaselineWrite({ report, cutoverAtMillis: CUTOVER, nowMillis: NOW })
    expect(Object.keys(write.projection)).toEqual([
      'xpTotal', 'level', 'xpProgressInLevel', 'xpToNextLevel', 'percentage',
    ])
  })

  it('refuses to plan a write for an ineligible member', () => {
    const report = classifyMember({
      family: family(),
      member: member({ lifetimeXP: 0 }),
      summary: summary(),
      activity: quiet(),
      existingMarker: undefined,
    })
    expect(() => planBaselineWrite({ report, cutoverAtMillis: CUTOVER, nowMillis: NOW })).toThrow()
  })

  /* Decision 2: the ledger, not a hidden summary offset, explains the total. */
  it('survives a full projection rebuild and accumulates later awards', async () => {
    const store = new MemoryStore(baseSeed())
    await runBaselineMigration(store, { execute: true, nowMillis: NOW })

    const baselineEvent = store.events[legacyBaselineEventId('fam1', 'child1')]
    expect(baselineEvent.xpDelta).toBe(380)

    const asDocument = (id: string, xpDelta: number, effectiveAt: number) => ({
      id,
      event: {
        schemaVersion: 1 as const,
        familyId: 'fam1',
        childId: 'child1',
        eventType: xpDelta === 380 ? ('legacy_xp_baseline' as const) : ('xp_awarded' as const),
        xpDelta,
        sourceType: xpDelta === 380 ? ('migration' as const) : ('task_completion' as const),
        sourceId: id,
        idempotencyKey: id,
        causalGroupId: id,
        effectiveAt,
        transitionRank: 0,
        configSchemaVersion: 1 as const,
        createdBy: xpDelta === 380
          ? ('legacy-xp-migration-v1' as const)
          : ('gamification-engine-v1' as const),
        createdAt: effectiveAt,
      },
    })

    const ledger = [asDocument(baselineEvent.id, 380, baselineEvent.effectiveAt)]
    const afterBaseline = rebuildGamificationSummary({
      eligibilitySnapshots: [],
      events: ledger,
      processingAt: NOW,
    })
    expect(afterBaseline.xpTotal).toBe(380)

    // A normal post-cutover +40 approved completion, then a second full rebuild.
    ledger.push(asDocument('task_xp:task_v1|child1|task1|2026-08-03', 40, CUTOVER + 1_000))
    const afterAward = rebuildGamificationSummary({
      eligibilitySnapshots: [],
      events: ledger,
      processingAt: NOW,
    })
    expect(afterAward.xpTotal).toBe(420)

    // rewardPoints move only for the +40 completion, never for the baseline.
    expect(baselineEvent.rewardPointsDelta).toBe(0)
    expect(store.rewardPoints.child1).toBe(350)
  })

  it('reports rewardPoints before and after as identical in the dry-run', async () => {
    const store = new MemoryStore(baseSeed())
    const result = await runBaselineMigration(store, { execute: false, nowMillis: NOW })
    const text = formatBaselineReport(result)
    expect(text).toContain('rewardPointsBefore=350 rewardPointsAfter=350(untouched)')
    expect(text).toContain('proposedBaselineXp=380')
    expect(result.written).toBe(0)
    expect(store.summaries['fam1/child1'].xpTotal).toBe(0)
  })
})
