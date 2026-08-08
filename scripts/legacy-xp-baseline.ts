/**
 * Legacy XP baseline migration (approved ruling).
 *
 * Ruling
 * ------
 * Before the authoritative gamification projection existed, `users/{memberId}.lifetimeXP`
 * was the authoritative cumulative XP balance. Historical completion records
 * frequently lack immutable award snapshots, so exact event reconstruction is
 * impossible. For eligible legacy members `lifetimeXP` is therefore ADOPTED as
 * the initial projection baseline at migration cutover.
 *
 * This is a baseline migration, not a new XP award:
 *  - `users/{id}.rewardPoints` is spendable currency and is NEVER read for a
 *    write decision and NEVER written;
 *  - no feed items, notifications, achievements or reward-point awards are
 *    produced;
 *  - streaks, perfect-day and unrelated projection fields are preserved.
 *
 * Everything in this module is pure. Storage lives behind `BaselineStore`.
 */

import { levelProgressForXp } from '../src/domain/gamification/level'
import { legacyBaselineEventId as canonicalBaselineEventId } from '../src/domain/gamification/xp'
import { GAMIFICATION_CONFIG_V1 } from '../src/domain/gamification/config'
import type { GamificationMigrationStatus } from '../src/domain/gamification/migrationState'

export const LEGACY_BASELINE_VERSION = 1 as const
export const LEGACY_BASELINE_SOURCE = 'legacy_users_lifetimeXP' as const
export const LEGACY_BASELINE_EVENT_TYPE = 'legacy_xp_baseline' as const
export const LEGACY_BASELINE_CREATED_BY = 'legacy-xp-migration-v1' as const

/**
 * Deterministic, replay-safe identity for the baseline event.
 *
 * Deliberately delegates to the canonical domain helper
 * (`legacy_xp_baseline:{familyId}:{childId}`) rather than minting a second
 * `legacy-xp-baseline-v1-{memberId}` form: the Cloud Functions backstop in
 * `gamificationRepository` already probes the canonical id to decide whether a
 * family still needs a baseline. A divergent id would let the same member be
 * baselined twice, which is exactly what determinism must prevent.
 * Never randomly generated: re-execution collides with the prior write.
 */
export function legacyBaselineEventId(familyId: string, memberId: string): string {
  return canonicalBaselineEventId(familyId, memberId)
}
const XP_PER_LEVEL = GAMIFICATION_CONFIG_V1.xpPerLevel

/** Migration statuses in which a legacy baseline may be written. */
export const BASELINE_ELIGIBLE_STATUSES: readonly string[] = ['prepared', 'baseline_complete']

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

export interface FamilyRecord {
  readonly id: string
  /** True when `families/{id}.gamificationMigration` exists at all. */
  readonly hasMigrationMetadata: boolean
  readonly migrationStatus: string | undefined
  readonly cutoverAtMillis: number | undefined
}

export interface MemberRecord {
  readonly id: string
  readonly familyId: string
  readonly displayName: string
  readonly role: string
  /** Raw legacy value; validated here, never coerced. */
  readonly lifetimeXP: unknown
  /** Read for reporting/proof only. Never written. */
  readonly rewardPoints: number | undefined
}

export interface SummaryRecord {
  readonly xpTotal: number
  readonly projectionStatus: string
  readonly rebuildRequired: boolean
  readonly currentStreak: number
  readonly bestStreak: number
}

/** Immutable audit marker written once per baselined member. */
export interface BaselineAuditMarker {
  readonly familyId: string
  readonly memberId: string
  readonly baselineXp: number
  readonly source: typeof LEGACY_BASELINE_SOURCE
  readonly cutoverAtMillis: number
  readonly migratedAtMillis: number
  readonly scriptVersion: number
  readonly priorSummaryXpTotal: number
}

/** Per-member facts that make a write unsafe. */
export interface MemberActivity {
  /** Every gamification event, including purely informational ones. */
  readonly gamificationEventCount: number
  /**
   * Events whose `xpDelta !== 0`. Only these prove that authoritative XP has
   * already been processed, and only these block a legacy baseline.
   */
  readonly nonZeroXpEventCount: number
  /**
   * Events whose `xpDelta === 0` (e.g. `daily_goal_qualification_changed`,
   * `perfect_day_qualification_changed`). Reported, never blocking.
   */
  readonly zeroXpEventCount: number
  /** Reported for coverage only; occurrences alone award nothing. */
  readonly taskOccurrenceCount: number
  /**
   * Post-cutover approved completions the processor has already turned into
   * authoritative XP (`gamificationProcessedAt` present), or whose safety
   * cannot be proven.
   */
  readonly postCutoverAwardCount: number
  /** Any evidence XP was reversed after the legacy balance was recorded. */
  readonly reversalEvidence: boolean
  /** Set when a count could not be determined with certainty. */
  readonly indeterminate?: string
  /** True when the deterministic baseline event already exists. */
  readonly baselineEventPresent?: boolean
}

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

export type BaselineClassification =
  | 'eligible_legacy_baseline'
  | 'already_baselined'
  | 'genuine_zero_xp'
  | 'post_cutover_activity_present'
  | 'unsafe_or_ambiguous'
  | 'malformed'

export interface ProposedProjection {
  readonly xpTotal: number
  readonly level: number
  readonly xpProgressInLevel: number
  readonly xpToNextLevel: number
  readonly percentage: number
}

export interface MemberReport {
  readonly familyId: string
  readonly memberId: string
  readonly displayName: string
  readonly classification: BaselineClassification
  readonly legacyLifetimeXp: number | null
  readonly currentXpTotal: number | null
  readonly rewardPointsBefore: number | null
  readonly proposedBaselineXp: number | null
  readonly proposedProjection: ProposedProjection | null
  /** Human-readable list of the satisfied eligibility conditions. */
  readonly evidence: readonly string[]
  readonly skipReason: string | null
  readonly action: 'write' | 'skip'
  /** Coverage counters, reported for every member. */
  readonly eventCount: number
  readonly nonZeroXpEventCount: number
  readonly zeroXpEventCount: number
  readonly occurrenceCount: number
  /** Deterministic identity the write would use. */
  readonly baselineEventId: string
}

export interface ClassifyInput {
  readonly family: FamilyRecord
  readonly member: MemberRecord
  readonly summary: SummaryRecord | undefined
  readonly activity: MemberActivity
  readonly existingMarker: BaselineAuditMarker | undefined
}

function validLegacyXp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function report(input: ClassifyInput, patch: Partial<MemberReport> & {
  classification: BaselineClassification
}): MemberReport {
  return {
    familyId: input.family.id,
    memberId: input.member.id,
    displayName: input.member.displayName,
    legacyLifetimeXp: validLegacyXp(input.member.lifetimeXP) ?? null,
    currentXpTotal: input.summary?.xpTotal ?? null,
    rewardPointsBefore: typeof input.member.rewardPoints === 'number' ? input.member.rewardPoints : null,
    proposedBaselineXp: null,
    proposedProjection: null,
    evidence: [],
    skipReason: null,
    action: 'skip',
    eventCount: input.activity.gamificationEventCount,
    nonZeroXpEventCount: input.activity.nonZeroXpEventCount,
    zeroXpEventCount: input.activity.zeroXpEventCount,
    occurrenceCount: input.activity.taskOccurrenceCount,
    baselineEventId: legacyBaselineEventId(input.family.id, input.member.id),
    ...patch,
  }
}

/** Recomputes every stored projection field with the canonical level helper. */
export function projectionForXp(xp: number): ProposedProjection {
  const progress = levelProgressForXp(xp, XP_PER_LEVEL)
  return {
    xpTotal: xp,
    level: progress.level,
    xpProgressInLevel: progress.xpIntoLevel,
    xpToNextLevel: progress.xpToNextLevel,
    percentage: progress.percentage,
  }
}

/**
 * Strict eligibility. Every condition must hold; anything uncertain is skipped
 * and reported rather than guessed.
 */
export function classifyMember(input: ClassifyInput): MemberReport {
  const { family, member, summary, activity, existingMarker } = input

  if (member.role !== 'child') {
    return report(input, { classification: 'unsafe_or_ambiguous', skipReason: 'not_a_child' })
  }
  if (existingMarker !== undefined) {
    return report(input, { classification: 'already_baselined', skipReason: 'legacy_baseline_marker_present' })
  }
  if (activity.baselineEventPresent === true) {
    return report(input, { classification: 'already_baselined', skipReason: 'legacy_baseline_event_present' })
  }
  if (!family.hasMigrationMetadata) {
    return report(input, { classification: 'unsafe_or_ambiguous', skipReason: 'family_missing_migration_metadata' })
  }
  if (family.migrationStatus === undefined || !BASELINE_ELIGIBLE_STATUSES.includes(family.migrationStatus)) {
    return report(input, {
      classification: 'unsafe_or_ambiguous',
      skipReason: `migration_status_not_eligible:${family.migrationStatus ?? 'missing'}`,
    })
  }
  if (family.cutoverAtMillis === undefined) {
    return report(input, { classification: 'malformed', skipReason: 'family_missing_cutoverAt' })
  }
  if (member.familyId !== family.id) {
    return report(input, { classification: 'unsafe_or_ambiguous', skipReason: 'member_not_in_family' })
  }

  const legacy = validLegacyXp(member.lifetimeXP)
  if (legacy === undefined) {
    return report(input, { classification: 'malformed', skipReason: 'invalid_lifetimeXP' })
  }
  if (summary === undefined) {
    return report(input, { classification: 'unsafe_or_ambiguous', skipReason: 'summary_missing' })
  }
  if (summary.rebuildRequired || summary.projectionStatus !== 'ready') {
    return report(input, { classification: 'unsafe_or_ambiguous', skipReason: 'projection_not_ready' })
  }
  if (summary.xpTotal !== 0) {
    return report(input, { classification: 'already_baselined', skipReason: 'summary_xp_already_populated' })
  }
  if (activity.indeterminate !== undefined) {
    return report(input, {
      classification: 'unsafe_or_ambiguous',
      skipReason: `indeterminate:${activity.indeterminate}`,
    })
  }
  // Decision 1: zero-XP qualification events are state transitions, not
  // awarded XP, and must not block legacy baseline adoption. Task occurrences
  // alone award nothing either; only processed XP blocks.
  if (activity.nonZeroXpEventCount > 0) {
    return report(input, {
      classification: 'post_cutover_activity_present',
      skipReason: 'non_zero_xp_events_present',
    })
  }
  if (activity.postCutoverAwardCount > 0) {
    return report(input, {
      classification: 'post_cutover_activity_present',
      skipReason: 'post_cutover_award_processed',
    })
  }
  if (activity.reversalEvidence) {
    return report(input, { classification: 'unsafe_or_ambiguous', skipReason: 'xp_reversal_evidence' })
  }
  if (legacy === 0) {
    return report(input, { classification: 'genuine_zero_xp', skipReason: 'legacy_lifetimeXP_is_zero' })
  }

  return report(input, {
    classification: 'eligible_legacy_baseline',
    action: 'write',
    proposedBaselineXp: legacy,
    proposedProjection: projectionForXp(legacy),
    evidence: [
      `migrationStatus=${family.migrationStatus}`,
      'memberInFamily',
      `lifetimeXP=${legacy}(valid,non-negative,integer)`,
      'summaryExists',
      'projectionStatus=ready',
      'summaryXpTotal=0',
      `gamificationEvents=${activity.gamificationEventCount}`,
      'nonZeroXpEvents=0',
      `zeroXpEvents=${activity.zeroXpEventCount}(non-blocking)`,
      `taskOccurrences=${activity.taskOccurrenceCount}(non-blocking)`,
      'postCutoverAwards=0',
      'noBaselineEvent',
      'noPriorBaselineMarker',
      'noReversalEvidence',
    ],
  })
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/**
 * The immutable, non-spendable ledger entry that explains the projection total.
 *
 * It is a first-class gamification event so the canonical rebuild/replay path
 * folds it like any other `xpDelta`; there is no hidden summary-only offset.
 * It carries no reward-point, occurrence, feed, notification or achievement
 * effect, and its id is deterministic so replay collides instead of doubling.
 */
export interface BaselineEvent {
  readonly id: string
  readonly schemaVersion: 1
  readonly familyId: string
  readonly childId: string
  readonly eventType: typeof LEGACY_BASELINE_EVENT_TYPE
  readonly xpDelta: number
  readonly sourceType: 'migration'
  readonly sourceId: typeof LEGACY_BASELINE_SOURCE
  readonly source: typeof LEGACY_BASELINE_SOURCE
  readonly idempotencyKey: string
  readonly causalGroupId: string
  readonly transitionRank: number
  readonly effectiveAt: number
  readonly cutoverAtMillis: number
  readonly createdAtMillis: number
  readonly migratedAtMillis: number
  readonly configSchemaVersion: 1
  readonly createdBy: typeof LEGACY_BASELINE_CREATED_BY
  readonly scriptVersion: number
  readonly priorSummaryXpTotal: number
  /** Explicit, machine-checkable statement that no currency is affected. */
  readonly rewardPointsDelta: 0
}

export interface BaselineWrite {
  readonly projection: ProposedProjection
  readonly marker: BaselineAuditMarker
  readonly event: BaselineEvent
}

export function planBaselineWrite(
  input: { readonly report: MemberReport; readonly cutoverAtMillis: number; readonly nowMillis: number },
): BaselineWrite {
  const baselineXp = input.report.proposedBaselineXp
  if (baselineXp === null || input.report.action !== 'write') {
    throw new Error(`Not an eligible baseline candidate: ${input.report.familyId}/${input.report.memberId}`)
  }
  const eventId = legacyBaselineEventId(input.report.familyId, input.report.memberId)
  const priorSummaryXpTotal = input.report.currentXpTotal ?? 0
  return {
    projection: projectionForXp(baselineXp),
    event: {
      id: eventId,
      schemaVersion: 1,
      familyId: input.report.familyId,
      childId: input.report.memberId,
      eventType: LEGACY_BASELINE_EVENT_TYPE,
      xpDelta: baselineXp,
      sourceType: 'migration',
      sourceId: LEGACY_BASELINE_SOURCE,
      source: LEGACY_BASELINE_SOURCE,
      idempotencyKey: eventId,
      causalGroupId: eventId,
      transitionRank: 0,
      // Ordered at the cutover instant so it always folds before every
      // post-cutover award during a rebuild.
      effectiveAt: input.cutoverAtMillis,
      cutoverAtMillis: input.cutoverAtMillis,
      createdAtMillis: input.nowMillis,
      migratedAtMillis: input.nowMillis,
      configSchemaVersion: 1,
      createdBy: LEGACY_BASELINE_CREATED_BY,
      scriptVersion: LEGACY_BASELINE_VERSION,
      priorSummaryXpTotal,
      rewardPointsDelta: 0,
    },
    marker: {
      familyId: input.report.familyId,
      memberId: input.report.memberId,
      baselineXp,
      source: LEGACY_BASELINE_SOURCE,
      cutoverAtMillis: input.cutoverAtMillis,
      migratedAtMillis: input.nowMillis,
      scriptVersion: LEGACY_BASELINE_VERSION,
      priorSummaryXpTotal: input.report.currentXpTotal ?? 0,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Migration state machine                                             */
/* ------------------------------------------------------------------ */

/** Classifications that count as "resolved" for a family transition. */
const RESOLVED: readonly BaselineClassification[] = [
  'eligible_legacy_baseline',
  'already_baselined',
  'genuine_zero_xp',
]

export interface FamilyTransition {
  readonly familyId: string
  readonly from: string
  readonly to: GamificationMigrationStatus | null
  readonly reason: string
}

/**
 * A family only advances `prepared -> baseline_complete` once every child is
 * either baselined (now or previously) or explicitly classified zero-XP.
 * `baseline_complete -> active` is left to the existing approved state-machine
 * rules and is never performed here.
 */
export function planFamilyTransition(
  family: FamilyRecord,
  reports: readonly MemberReport[],
  executed: boolean,
): FamilyTransition {
  const base = { familyId: family.id, from: family.migrationStatus ?? 'missing' }
  const unresolved = reports.filter(r => !RESOLVED.includes(r.classification))
  if (unresolved.length > 0) {
    return { ...base, to: null, reason: `unresolved_members:${unresolved.map(r => r.memberId).join(',')}` }
  }
  if (family.migrationStatus !== 'prepared') {
    return { ...base, to: null, reason: 'no_transition_required' }
  }
  if (!executed) {
    return { ...base, to: 'baseline_complete', reason: 'all_members_resolved (dry-run: not applied)' }
  }
  return { ...base, to: 'baseline_complete', reason: 'all_members_resolved' }
}

/* ------------------------------------------------------------------ */
/* Store port + runner                                                 */
/* ------------------------------------------------------------------ */

export interface BaselineStore {
  listFamilies(): Promise<readonly FamilyRecord[]>
  listChildren(familyId: string): Promise<readonly MemberRecord[]>
  getSummary(familyId: string, memberId: string): Promise<SummaryRecord | undefined>
  getActivity(family: FamilyRecord, memberId: string): Promise<MemberActivity>
  getAuditMarker(familyId: string, memberId: string): Promise<BaselineAuditMarker | undefined>
  /** Transactional; re-asserts invariants and is a strict no-op when a marker exists. */
  applyBaseline(familyId: string, memberId: string, write: BaselineWrite): Promise<'written' | 'noop'>
  setMigrationStatus(familyId: string, status: GamificationMigrationStatus): Promise<void>
}

export interface BaselineArgs {
  readonly execute: boolean
  readonly familyId?: string
  readonly memberId?: string
  readonly limit?: number
  readonly startAfterFamilyId?: string
  readonly nowMillis: number
}

export interface BaselineResult {
  readonly dryRun: boolean
  readonly familiesScanned: number
  readonly membersScanned: number
  readonly reports: readonly MemberReport[]
  readonly transitions: readonly FamilyTransition[]
  readonly written: number
  readonly nextCursor: string | null
}

function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export async function runBaselineMigration(
  store: BaselineStore,
  args: BaselineArgs,
): Promise<BaselineResult> {
  const all = [...(await store.listFamilies())].sort((a, b) => byCodeUnits(a.id, b.id))
  const filtered = all
    .filter(f => args.familyId === undefined || f.id === args.familyId)
    .filter(f => args.startAfterFamilyId === undefined || byCodeUnits(f.id, args.startAfterFamilyId) > 0)
  const families = args.limit === undefined ? filtered : filtered.slice(0, args.limit)

  const reports: MemberReport[] = []
  const transitions: FamilyTransition[] = []
  let membersScanned = 0
  let written = 0

  for (const family of families) {
    const children = [...(await store.listChildren(family.id))]
      .filter(m => args.memberId === undefined || m.id === args.memberId)
      .sort((a, b) => byCodeUnits(a.id, b.id))

    const familyReports: MemberReport[] = []
    for (const member of children) {
      membersScanned += 1
      const [summary, activity, existingMarker] = await Promise.all([
        store.getSummary(family.id, member.id),
        store.getActivity(family, member.id),
        store.getAuditMarker(family.id, member.id),
      ])
      const memberReport = classifyMember({ family, member, summary, activity, existingMarker })
      familyReports.push(memberReport)
      reports.push(memberReport)

      if (memberReport.action === 'write' && args.execute) {
        const outcome = await store.applyBaseline(
          family.id,
          member.id,
          planBaselineWrite({
            report: memberReport,
            cutoverAtMillis: family.cutoverAtMillis!,
            nowMillis: args.nowMillis,
          }),
        )
        if (outcome === 'written') written += 1
      }
    }

    // Partial scopes must never drive a family-level transition.
    const scopeIsWholeFamily = args.memberId === undefined
    const transition = scopeIsWholeFamily
      ? planFamilyTransition(family, familyReports, args.execute)
      : { familyId: family.id, from: family.migrationStatus ?? 'missing', to: null, reason: 'partial_scope' as const }
    transitions.push(transition)
    if (args.execute && transition.to !== null) {
      await store.setMigrationStatus(family.id, transition.to)
    }
  }

  return {
    dryRun: !args.execute,
    familiesScanned: families.length,
    membersScanned,
    reports,
    transitions,
    written,
    nextCursor: families.at(-1)?.id ?? null,
  }
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

export function formatBaselineReport(result: BaselineResult): string {
  const lines: string[] = []
  lines.push(`mode: ${result.dryRun ? 'dry-run' : 'execute'}`)
  lines.push(`scriptVersion: ${LEGACY_BASELINE_VERSION}`)
  lines.push(`source: ${LEGACY_BASELINE_SOURCE}`)
  lines.push(`familiesScanned: ${result.familiesScanned}`)
  lines.push(`membersScanned: ${result.membersScanned}`)
  lines.push(`nextCursor: ${result.nextCursor ?? '-'}`)
  lines.push('')

  const ordered = [...result.reports].sort(
    (a, b) => byCodeUnits(a.familyId, b.familyId) || byCodeUnits(a.memberId, b.memberId),
  )
  for (const r of ordered) {
    lines.push([
      `familyId=${r.familyId}`,
      `memberId=${r.memberId}`,
      `displayName=${r.displayName}`,
      `classification=${r.classification}`,
      `legacyLifetimeXP=${r.legacyLifetimeXp ?? '-'}`,
      `summaryXpTotal=${r.currentXpTotal ?? '-'}`,
      `rewardPointsBefore=${r.rewardPointsBefore ?? '-'}`,
      `rewardPointsAfter=${r.rewardPointsBefore ?? '-'}(untouched)`,
      `eventCount=${r.eventCount}`,
      `nonZeroXpEventCount=${r.nonZeroXpEventCount}`,
      `zeroXpEventCount=${r.zeroXpEventCount}`,
      `occurrenceCount=${r.occurrenceCount}`,
      `baselineEventId=${r.baselineEventId}`,
      `eventXpDelta=${r.proposedBaselineXp ?? '-'}`,
      `proposedBaselineXp=${r.proposedBaselineXp ?? '-'}`,
      `proposedLevel=${r.proposedProjection?.level ?? '-'}`,
      `proposedProgress=${r.proposedProjection
        ? `${r.proposedProjection.xpProgressInLevel}/${XP_PER_LEVEL} (${r.proposedProjection.percentage}%, toNext=${r.proposedProjection.xpToNextLevel})`
        : '-'}`,
      `evidence=${r.evidence.length > 0 ? r.evidence.join('|') : '-'}`,
      `skipReason=${r.skipReason ?? '-'}`,
      `action=${r.action}`,
    ].join(' '))
  }

  lines.push('')
  for (const t of result.transitions) {
    lines.push(`transition familyId=${t.familyId} from=${t.from} to=${t.to ?? '-'} reason=${t.reason}`)
  }
  lines.push('')
  const count = (c: BaselineClassification) => ordered.filter(r => r.classification === c).length
  lines.push(`eligible_legacy_baseline: ${count('eligible_legacy_baseline')}`)
  lines.push(`already_baselined: ${count('already_baselined')}`)
  lines.push(`genuine_zero_xp: ${count('genuine_zero_xp')}`)
  lines.push(`post_cutover_activity_present: ${count('post_cutover_activity_present')}`)
  lines.push(`unsafe_or_ambiguous: ${count('unsafe_or_ambiguous')}`)
  lines.push(`malformed: ${count('malformed')}`)
  lines.push(`membersWithLegacyXpAboveZero: ${ordered.filter(r => (r.legacyLifetimeXp ?? 0) > 0).length}`)
  lines.push(`membersWithZeroSummaryXp: ${ordered.filter(r => r.currentXpTotal === 0).length}`)
  lines.push(`membersLegacyXpAboveZeroAndZeroSummary: ${ordered.filter(r => (r.legacyLifetimeXp ?? 0) > 0 && r.currentXpTotal === 0).length}`)
  lines.push(`membersWithPostCutoverXpBearingEvents: ${ordered.filter(r => r.nonZeroXpEventCount > 0).length}`)
  lines.push(`membersWithZeroXpOnlyEvents: ${ordered.filter(r => r.eventCount > 0 && r.nonZeroXpEventCount === 0).length}`)
  lines.push(`membersSkipped: ${ordered.filter(r => r.action === 'skip').length}`)
  lines.push(`familiesWithUnresolvedMembers: ${result.transitions.filter(t => t.reason.startsWith('unresolved_members')).length}`)
  lines.push(`familiesAdvancingToBaselineComplete: ${result.transitions.filter(t => t.to === 'baseline_complete').length}`)
  lines.push(`proposedWrites: ${ordered.filter(r => r.action === 'write').length}`)
  lines.push(`written: ${result.written}`)
  lines.push('rewardPoints writes: 0 (this script never writes users/{id}.rewardPoints)')
  lines.push('feed writes: 0 | notification writes: 0 | task occurrence writes: 0 | reward transaction writes: 0')
  return lines.join('\n')
}

export function parseBaselineArgs(argv: readonly string[], nowMillis: number): BaselineArgs {
  const value = (flag: string): string | undefined => {
    const match = argv.find(arg => arg.startsWith(`${flag}=`))
    return match?.slice(flag.length + 1)
  }
  const limitRaw = value('--limit')
  const limit = limitRaw === undefined ? undefined : Number(limitRaw)
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0)) {
    throw new Error('--limit must be a positive integer')
  }
  return {
    execute: argv.includes('--execute'),
    familyId: value('--family'),
    memberId: value('--member'),
    limit,
    startAfterFamilyId: value('--start-after'),
    nowMillis,
  }
}
