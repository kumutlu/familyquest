/**
 * Historical gamification XP backfill.
 *
 * Purpose
 * -------
 * Families that were migrated to the gamification engine received a `cutoverAt`
 * boundary. Task completions approved *before* that boundary are deliberately
 * ignored by the processor (`gamificationRepository.processApprovedCompletion`
 * returns `ignored` for `approvedAt < cutoverAt`), so a child with a long
 * pre-cutover history can end up with a ready projection whose `xpTotal` is 0
 * while the legacy `users/{id}.lifetimeXP` counter is large.
 *
 * This script reconstructs the pre-cutover XP from authoritative history and
 * writes it into `families/{familyId}/gamification_summaries/{memberId}`.
 *
 * Hard guarantees
 * ---------------
 * - Dry-run by default; writes only with an explicit `--execute`.
 * - NEVER writes `users/{id}.rewardPoints` (or any other spendable balance).
 * - NEVER changes the XP balance rules: level/progress are always recomputed
 *   with the canonical `levelProgressForXp` helper and the canonical
 *   `GAMIFICATION_CONFIG_V1.xpPerLevel`.
 * - Idempotent: a backfilled summary carries an audit marker; re-running is a
 *   no-op for every already-backfilled member.
 * - Conservative: anything that does not reconcile under the documented rule is
 *   skipped and reported for human approval instead of being guessed.
 *
 * Reconciliation rule (documented, single rule)
 * ---------------------------------------------
 * A candidate is written only when the reconstructed XP is *exactly* equal to
 * the legacy `lifetimeXP` counter (`reconciled_exact`). Any other outcome is
 * classified (`discrepancy_reconstructed_lower` / `discrepancy_reconstructed_higher`)
 * and reported without writing.
 */

import { levelProgressForXp } from '../src/domain/gamification/level'
import { GAMIFICATION_CONFIG_V1 } from '../src/domain/gamification/config'

export const BACKFILL_VERSION = 1 as const
export const BACKFILL_SOURCE = 'historical-xp-backfill-v1' as const
const XP_PER_LEVEL = GAMIFICATION_CONFIG_V1.xpPerLevel

/* ------------------------------------------------------------------ */
/* Records (storage-shaped, but storage-agnostic)                      */
/* ------------------------------------------------------------------ */

export interface FamilyRecord {
  readonly id: string
  readonly migrationStatus: string | undefined
  /** Frozen cutover boundary in epoch millis; undefined when never migrated. */
  readonly cutoverAtMillis: number | undefined
}

export interface MemberRecord {
  readonly id: string
  readonly familyId: string
  readonly displayName: string
  readonly role: string
  readonly lifetimeXP: number | undefined
  readonly rewardPoints: number | undefined
}

export interface SummaryRecord {
  readonly xpTotal: number
  readonly level: number
  readonly projectionStatus: string
  readonly rebuildRequired: boolean
  readonly currentStreak: number
  readonly bestStreak: number
  readonly backfill?: BackfillMarker
}

export interface BackfillMarker {
  readonly version: number
  readonly source: string
  readonly reconstructedXp: number
  readonly appliedAtMillis: number
}

export interface CompletionRecord {
  readonly id: string
  readonly assigneeId: string
  readonly status: string
  readonly approvedAtMillis: number | undefined
  /** Award actually granted at approval time (authoritative snapshot). */
  readonly awardedPoints: number | undefined
  /** Reward snapshot frozen on the completion, when the app stored one. */
  readonly snapshotRewardPoints: number | undefined
  /** Set when the award was later revoked/reversed. */
  readonly revoked: boolean
}

export interface BehaviourEventRecord {
  readonly id: string
  readonly userId: string
  readonly pointsDelta: number
  readonly timestampMillis: number | undefined
  readonly revoked: boolean
}

export interface GamificationEventRecord {
  readonly id: string
  readonly childId: string
  readonly eventType: string
  readonly xpDelta: number
}

/* ------------------------------------------------------------------ */
/* Store port                                                          */
/* ------------------------------------------------------------------ */

export interface BackfillStore {
  listFamilies(): Promise<readonly FamilyRecord[]>
  listChildren(familyId: string): Promise<readonly MemberRecord[]>
  getSummary(familyId: string, memberId: string): Promise<SummaryRecord | undefined>
  listApprovedCompletions(familyId: string, memberId: string): Promise<readonly CompletionRecord[]>
  listBehaviourEvents(familyId: string, memberId: string): Promise<readonly BehaviourEventRecord[]>
  listGamificationEvents(familyId: string, memberId: string): Promise<readonly GamificationEventRecord[]>
  writeSummaryXp(familyId: string, memberId: string, write: SummaryXpWrite): Promise<void>
}

export interface SummaryXpWrite {
  readonly xpTotal: number
  readonly level: number
  readonly xpProgressInLevel: number
  readonly xpToNextLevel: number
  readonly backfill: BackfillMarker
}

/* ------------------------------------------------------------------ */
/* Pure reconstruction                                                 */
/* ------------------------------------------------------------------ */

export interface Reconstruction {
  readonly taskXp: number
  readonly behaviourXp: number
  readonly reversalDelta: number
  readonly reconstructedXp: number
  readonly consideredCompletions: number
}

function safeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

/**
 * Resolves the XP a single approved completion contributed under the legacy
 * contract (`lifetimeXP += pointsReward` at approval time).
 *
 * Only authoritative, time-of-approval values are used: the award actually
 * written on the completion, then the frozen reward snapshot. The task's
 * *current* `pointsReward` is deliberately not consulted, because it may have
 * been edited after the completion was approved.
 */
export function completionXp(completion: CompletionRecord): number | undefined {
  return safeInteger(completion.awardedPoints) ?? safeInteger(completion.snapshotRewardPoints)
}

export interface ReconstructInput {
  readonly cutoverAtMillis: number
  readonly completions: readonly CompletionRecord[]
  readonly behaviourEvents: readonly BehaviourEventRecord[]
}

export interface ReconstructOutcome {
  readonly reconstruction?: Reconstruction
  /** Set when history cannot be reconstructed safely. */
  readonly unresolved?: string
}

export function reconstructXp(input: ReconstructInput): ReconstructOutcome {
  let taskXp = 0
  let reversalDelta = 0
  let considered = 0

  for (const completion of input.completions) {
    if (completion.status !== 'approved') continue
    const approvedAt = safeInteger(completion.approvedAtMillis)
    if (approvedAt === undefined) return { unresolved: 'completion_missing_approvedAt' }
    // Post-cutover completions are owned by the processor, never by this script.
    if (approvedAt >= input.cutoverAtMillis) continue
    const xp = completionXp(completion)
    if (xp === undefined) return { unresolved: 'completion_missing_reward_snapshot' }
    if (xp < 0) return { unresolved: 'completion_negative_reward' }
    considered += 1
    taskXp += xp
    if (completion.revoked) reversalDelta -= xp
  }

  let behaviourXp = 0
  for (const event of input.behaviourEvents) {
    const delta = safeInteger(event.pointsDelta)
    if (delta === undefined) return { unresolved: 'behaviour_event_invalid_delta' }
    const at = safeInteger(event.timestampMillis)
    if (at === undefined) return { unresolved: 'behaviour_event_missing_timestamp' }
    if (at >= input.cutoverAtMillis) continue
    // Legacy contract: only positive behaviour deltas ever increased lifetimeXP.
    if (delta <= 0) continue
    behaviourXp += delta
    if (event.revoked) reversalDelta -= delta
  }

  const reconstructedXp = taskXp + behaviourXp + reversalDelta
  if (!Number.isSafeInteger(reconstructedXp) || reconstructedXp < 0) {
    return { unresolved: 'reconstructed_xp_out_of_range' }
  }
  return {
    reconstruction: { taskXp, behaviourXp, reversalDelta, reconstructedXp, consideredCompletions: considered },
  }
}

/* ------------------------------------------------------------------ */
/* Candidate classification                                            */
/* ------------------------------------------------------------------ */

export type ReconciliationStatus =
  | 'reconciled_exact'
  | 'discrepancy_reconstructed_lower'
  | 'discrepancy_reconstructed_higher'
  | 'not_applicable'

export interface CandidateReport {
  readonly familyId: string
  readonly memberId: string
  readonly displayName: string
  readonly legacyLifetimeXp: number | null
  readonly currentXpTotal: number | null
  readonly reconstructedTaskXp: number | null
  readonly reconstructedBehaviourXp: number | null
  readonly reversalDelta: number | null
  readonly finalReconstructedXp: number | null
  readonly reconciliation: ReconciliationStatus
  readonly action: 'write' | 'skip'
  readonly skipReason: string | null
}

export interface ClassifyInput {
  readonly family: FamilyRecord
  readonly member: MemberRecord
  readonly summary: SummaryRecord | undefined
  readonly gamificationEvents: readonly GamificationEventRecord[]
  readonly completions: readonly CompletionRecord[]
  readonly behaviourEvents: readonly BehaviourEventRecord[]
}

function skip(input: ClassifyInput, reason: string, extra?: Partial<CandidateReport>): CandidateReport {
  return {
    familyId: input.family.id,
    memberId: input.member.id,
    displayName: input.member.displayName,
    legacyLifetimeXp: safeInteger(input.member.lifetimeXP) ?? null,
    currentXpTotal: input.summary ? input.summary.xpTotal : null,
    reconstructedTaskXp: null,
    reconstructedBehaviourXp: null,
    reversalDelta: null,
    finalReconstructedXp: null,
    reconciliation: 'not_applicable',
    action: 'skip',
    skipReason: reason,
    ...extra,
  }
}

/**
 * Conservative eligibility + reconciliation for one member.
 *
 * A member is only ever written when every one of these holds:
 *  - the family has a frozen `cutoverAt`;
 *  - a summary document exists and its projection is `ready` (not rebuilding);
 *  - the summary XP is zero (demonstrably incomplete relative to history);
 *  - no XP-bearing gamification events already represent that history;
 *  - pre-cutover approved history exists and reconstructs cleanly;
 *  - the reconstruction reconciles exactly with the legacy counter.
 */
export function classifyCandidate(input: ClassifyInput): CandidateReport {
  const { family, member, summary } = input

  if (member.role !== 'child') return skip(input, 'not_a_child')
  if (family.cutoverAtMillis === undefined) return skip(input, 'family_has_no_cutover')
  if (summary === undefined) return skip(input, 'summary_missing')
  if (summary.rebuildRequired || summary.projectionStatus !== 'ready') return skip(input, 'projection_not_ready')

  const marker = summary.backfill
  if (marker !== undefined && marker.source === BACKFILL_SOURCE && summary.xpTotal === marker.reconstructedXp) {
    return skip(input, 'already_backfilled')
  }
  if (summary.xpTotal !== 0) return skip(input, 'summary_xp_already_populated')

  const xpEvents = input.gamificationEvents.filter(
    event => event.childId === member.id && event.xpDelta !== 0,
  )
  if (xpEvents.length > 0) return skip(input, 'gamification_events_already_present')

  const outcome = reconstructXp({
    cutoverAtMillis: family.cutoverAtMillis,
    completions: input.completions.filter(completion => completion.assigneeId === member.id),
    behaviourEvents: input.behaviourEvents.filter(event => event.userId === member.id),
  })
  if (outcome.unresolved !== undefined) return skip(input, outcome.unresolved)

  const reconstruction = outcome.reconstruction!
  if (reconstruction.consideredCompletions === 0 && reconstruction.behaviourXp === 0) {
    return skip(input, 'no_pre_cutover_history')
  }

  const legacy = safeInteger(member.lifetimeXP) ?? null
  const reconciliation: ReconciliationStatus =
    legacy === reconstruction.reconstructedXp
      ? 'reconciled_exact'
      : legacy !== null && reconstruction.reconstructedXp < legacy
        ? 'discrepancy_reconstructed_lower'
        : 'discrepancy_reconstructed_higher'

  const base: CandidateReport = {
    familyId: family.id,
    memberId: member.id,
    displayName: member.displayName,
    legacyLifetimeXp: legacy,
    currentXpTotal: summary.xpTotal,
    reconstructedTaskXp: reconstruction.taskXp,
    reconstructedBehaviourXp: reconstruction.behaviourXp,
    reversalDelta: reconstruction.reversalDelta,
    finalReconstructedXp: reconstruction.reconstructedXp,
    reconciliation,
    action: 'skip',
    skipReason: null,
  }

  if (reconciliation !== 'reconciled_exact') {
    return { ...base, action: 'skip', skipReason: 'unresolved_reconciliation' }
  }
  if (reconstruction.reconstructedXp === 0) {
    return { ...base, action: 'skip', skipReason: 'reconstructed_xp_is_zero' }
  }
  return { ...base, action: 'write', skipReason: null }
}

/** Builds the (level-consistent) summary write for an approved candidate. */
export function planSummaryWrite(reconstructedXp: number, appliedAtMillis: number): SummaryXpWrite {
  const progress = levelProgressForXp(reconstructedXp, XP_PER_LEVEL)
  return {
    xpTotal: reconstructedXp,
    level: progress.level,
    xpProgressInLevel: progress.xpIntoLevel,
    xpToNextLevel: progress.xpToNextLevel,
    backfill: {
      version: BACKFILL_VERSION,
      source: BACKFILL_SOURCE,
      reconstructedXp,
      appliedAtMillis,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

export interface BackfillArgs {
  readonly execute: boolean
  readonly familyId?: string
  readonly memberId?: string
  /** Resumable paging: process at most this many families per run. */
  readonly limit?: number
  /** Resumable paging: start after this family id (exclusive, sorted order). */
  readonly startAfterFamilyId?: string
  readonly nowMillis: number
}

export interface BackfillResult {
  readonly dryRun: boolean
  readonly familiesScanned: number
  readonly membersScanned: number
  readonly candidates: readonly CandidateReport[]
  readonly written: number
  /** Last family id processed, for `--start-after` on the next run. */
  readonly nextCursor: string | null
}

function byCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export async function runBackfill(store: BackfillStore, args: BackfillArgs): Promise<BackfillResult> {
  const allFamilies = [...(await store.listFamilies())].sort((a, b) => byCodeUnits(a.id, b.id))
  const filtered = allFamilies
    .filter(family => args.familyId === undefined || family.id === args.familyId)
    .filter(family => args.startAfterFamilyId === undefined || byCodeUnits(family.id, args.startAfterFamilyId) > 0)
  const families = args.limit === undefined ? filtered : filtered.slice(0, args.limit)

  const candidates: CandidateReport[] = []
  let membersScanned = 0
  let written = 0

  for (const family of families) {
    const children = [...(await store.listChildren(family.id))]
      .filter(member => args.memberId === undefined || member.id === args.memberId)
      .sort((a, b) => byCodeUnits(a.id, b.id))

    for (const member of children) {
      membersScanned += 1
      const [summary, completions, behaviourEvents, gamificationEvents] = await Promise.all([
        store.getSummary(family.id, member.id),
        store.listApprovedCompletions(family.id, member.id),
        store.listBehaviourEvents(family.id, member.id),
        store.listGamificationEvents(family.id, member.id),
      ])
      const report = classifyCandidate({ family, member, summary, completions, behaviourEvents, gamificationEvents })
      candidates.push(report)

      if (report.action === 'write' && args.execute) {
        await store.writeSummaryXp(
          family.id,
          member.id,
          planSummaryWrite(report.finalReconstructedXp!, args.nowMillis),
        )
        written += 1
      }
    }
  }

  return {
    dryRun: !args.execute,
    familiesScanned: families.length,
    membersScanned,
    candidates,
    written,
    nextCursor: families.at(-1)?.id ?? null,
  }
}

/** Deterministic, reviewable report text (stable ordering, stable columns). */
export function formatReport(result: BackfillResult): string {
  const lines: string[] = []
  lines.push(`mode: ${result.dryRun ? 'dry-run' : 'execute'}`)
  lines.push(`familiesScanned: ${result.familiesScanned}`)
  lines.push(`membersScanned: ${result.membersScanned}`)
  lines.push(`nextCursor: ${result.nextCursor ?? '-'}`)
  lines.push('')
  const ordered = [...result.candidates].sort(
    (a, b) => byCodeUnits(a.familyId, b.familyId) || byCodeUnits(a.memberId, b.memberId),
  )
  for (const candidate of ordered) {
    lines.push([
      `familyId=${candidate.familyId}`,
      `memberId=${candidate.memberId}`,
      `displayName=${candidate.displayName}`,
      `legacyLifetimeXP=${candidate.legacyLifetimeXp ?? '-'}`,
      `summaryXpTotal=${candidate.currentXpTotal ?? '-'}`,
      `taskXp=${candidate.reconstructedTaskXp ?? '-'}`,
      `behaviourXp=${candidate.reconstructedBehaviourXp ?? '-'}`,
      `reversalDelta=${candidate.reversalDelta ?? '-'}`,
      `finalXp=${candidate.finalReconstructedXp ?? '-'}`,
      `reconciliation=${candidate.reconciliation}`,
      `action=${candidate.action}`,
      `skipReason=${candidate.skipReason ?? '-'}`,
    ].join(' '))
  }
  lines.push('')
  lines.push(`proposedWrites: ${ordered.filter(c => c.action === 'write').length}`)
  lines.push(`discrepancies: ${ordered.filter(c => c.skipReason === 'unresolved_reconciliation').length}`)
  lines.push(`written: ${result.written}`)
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* CLI argument parsing                                                */
/* ------------------------------------------------------------------ */

export function parseArgs(argv: readonly string[], nowMillis: number): BackfillArgs {
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
    // Dry-run is the default; writes require the explicit flag.
    execute: argv.includes('--execute'),
    familyId: value('--family'),
    memberId: value('--member'),
    limit,
    startAfterFamilyId: value('--start-after'),
    nowMillis,
  }
}
