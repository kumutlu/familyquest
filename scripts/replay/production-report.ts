/**
 * Gamification V4 — Task 3.1 production replay report (READ-ONLY, GATE 1).
 *
 * Runs the Stage 2 replay engine against EVERY production family (supplied as
 * in-memory `LegacyFamily` records, e.g. from a read-only production export or
 * fixtures) and aggregates per-family / per-member replayed gamification state,
 * classification counts, and the difference versus currently displayed values.
 *
 * Wallet data is NEVER read, imported, or treated as a gamification input. The
 * Stage 0.4 wallet snapshot manifest is embedded ONLY as hashes (global SHA-256
 * + per-collection counts/hashes) so the owner can verify wallet byte-equality
 * later without exposing any wallet values.
 *
 * Hard constraints (plan Task 3.1 + design §7):
 *  - No Firestore SDK import, no admin SDK, no `functions/` import.
 *  - No writes to any collection (gamification or wallet). File emission is via
 *    node `fs` only and is opt-in through the CLI.
 *  - Reuses (never duplicates) the Stage 1 reducer/rebuild and Stage 2
 *    readers/classifier/report/dry-run.
 *  - Deterministic: identical input → byte-identical report (no clock, no RNG).
 *  - Never guesses: malformed/ambiguous sources are reported, not coerced.
 *
 * See docs/gamification-v4-design.md §5–§7 and plan Task 3.1.
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { GAMIFICATION_V4_SCHEMA_VERSION } from '../../src/domain/gamification/v4/types'
import type { GamificationStateV4 } from '../../src/domain/gamification/v4/types'
import { runReplayDryRun, type ReplayDryRunContext } from './run-dry-run'
import type { ReplayReportCounts } from '../../src/domain/gamification/v4/replay/report'
import type { LegacyFamily } from '../../src/domain/gamification/v4/replay/sources'

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Currently displayed gamification values (what the legacy app shows today). */
export interface DisplayedMemberState {
  readonly rewardPoints: number
  readonly xpTotal: number
  readonly level: number
  readonly currentStreak: number
  readonly bestStreak: number
  readonly unlockedAchievementIds: readonly string[]
  readonly unlockedAvatarIds: readonly string[]
}

/** One family's replay input: legacy sources plus optional displayed values. */
export interface ProductionFamilyInput {
  readonly family: LegacyFamily
  readonly displayed?: Readonly<Record<string, DisplayedMemberState>>
}

export interface ProductionReplayOptions {
  /** Replay clock stamped on the report (fixed for determinism). */
  readonly updatedAt?: string
  readonly projectionVersion?: number
  readonly timezone?: string
  /** Resolve current task points by (familyId, taskId) for the `estimated` fallback. */
  readonly taskPointsLookup?: (familyId: string, taskId: string) => number | null
  /** Stage 0.4 wallet snapshot manifest (embedded as hashes only). */
  readonly walletSnapshot?: WalletSnapshotManifest | null
}

// ---------------------------------------------------------------------------
// Wallet snapshot (hashes only — never gamification inputs)
// ---------------------------------------------------------------------------

/** Shape of the artifact produced by `scripts/wallet-snapshot.cjs` (Task 0.4). */
export interface WalletSnapshotManifest {
  readonly tool?: string
  readonly generatedAt?: string
  readonly projectId?: string | null
  readonly totalCount?: number
  readonly globalSha256?: string
  readonly collections?: Readonly<
    Record<string, { count: number; sha256: string; docs?: Readonly<Record<string, string>> }>
  >
}

/** Hash-only projection of the wallet snapshot (no document values). */
export interface WalletSnapshotSummary {
  readonly globalSha256: string
  readonly totalCount: number
  readonly collections: ReadonlyArray<{ name: string; count: number; sha256: string }>
}

/**
 * Project the wallet snapshot manifest down to hashes only. The `docs` map
 * (which would contain per-document hashes but is still wallet data) is
 * deliberately dropped so the report never carries wallet values of any kind.
 */
export function summarizeWalletSnapshot(
  manifest: WalletSnapshotManifest | null | undefined,
): WalletSnapshotSummary | null {
  if (!manifest) return null
  const collections = manifest.collections
    ? Object.keys(manifest.collections)
        .sort()
        .map((name) => ({
          name,
          count: manifest.collections![name].count,
          sha256: manifest.collections![name].sha256,
        }))
    : []
  return {
    globalSha256: manifest.globalSha256 ?? '',
    totalCount: manifest.totalCount ?? 0,
    collections,
  }
}

// ---------------------------------------------------------------------------
// Report shapes
// ---------------------------------------------------------------------------

/** Per-member difference (replayed − displayed). */
export interface MemberDiff {
  readonly rewardPoints: number
  readonly xpTotal: number
  readonly level: number
  readonly currentStreak: number
  readonly bestStreak: number
}

export interface ProductionMemberReport {
  readonly memberId: string
  readonly replayed: GamificationStateV4
  readonly displayed?: DisplayedMemberState
  readonly diff?: MemberDiff
}

export interface ProductionFamilyReport {
  readonly familyId: string
  readonly totalSources: number
  readonly counts: ReplayReportCounts
  readonly eventsBuilt: number
  readonly members: Readonly<Record<string, ProductionMemberReport>>
  readonly displayedProvided: boolean
  /** Present when the family's replay threw (reader-level malformed source). */
  readonly error?: string
}

export interface ProductionReplayReport {
  readonly generatedAt: string
  readonly schemaVersion: number
  readonly gate: 'GATE_1_REACHED'
  readonly totalFamilies: number
  readonly totalSources: number
  readonly totalEventsBuilt: number
  readonly counts: ReplayReportCounts
  readonly families: ReadonlyArray<ProductionFamilyReport>
  /** Wallet hashes only — never wallet values. */
  readonly walletSnapshot: WalletSnapshotSummary | null
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

const EMPTY_COUNTS: ReplayReportCounts = {
  exact: 0,
  estimated: 0,
  malformed: 0,
  ambiguous: 0,
  skipped: 0,
}

const REPORT_EPOCH = '1970-01-01T00:00:00.000Z'

function diffMember(replayed: GamificationStateV4, displayed: DisplayedMemberState): MemberDiff {
  return {
    rewardPoints: replayed.rewardPoints - displayed.rewardPoints,
    xpTotal: replayed.xpTotal - displayed.xpTotal,
    level: replayed.level - displayed.level,
    currentStreak: replayed.currentStreak - displayed.currentStreak,
    bestStreak: replayed.bestStreak - displayed.bestStreak,
  }
}

function replayFamily(input: ProductionFamilyInput, opts: ProductionReplayOptions): ProductionFamilyReport {
  const family = input.family
  const familyId = family.familyId
  const ctx: ReplayDryRunContext = {
    familyId,
    updatedAt: opts.updatedAt ?? REPORT_EPOCH,
    projectionVersion: opts.projectionVersion ?? 1,
    timezone: opts.timezone,
    taskPointsLookup: opts.taskPointsLookup
      ? (taskId: string) => opts.taskPointsLookup!(familyId, taskId)
      : undefined,
  }

  const displayedProvided = Boolean(input.displayed && Object.keys(input.displayed).length > 0)

  try {
    const result = runReplayDryRun(family, ctx)
    const members: Record<string, ProductionMemberReport> = {}
    const displayed = input.displayed
    for (const [memberId, state] of Object.entries(result.replayedMembers)) {
      const d = displayed?.[memberId]
      members[memberId] = {
        memberId,
        replayed: state,
        displayed: d,
        diff: d ? diffMember(state, d) : undefined,
      }
    }
    return {
      familyId,
      totalSources: result.totalSources,
      counts: result.counts,
      eventsBuilt: result.eventsBuilt,
      members,
      displayedProvided,
    }
  } catch (e) {
    // Reader-level malformed source: record the family as errored rather than
    // aborting the whole multi-family report. The source is never guessed.
    return {
      familyId,
      totalSources: 0,
      counts: { ...EMPTY_COUNTS },
      eventsBuilt: 0,
      members: {},
      displayedProvided,
      error: (e as Error).message,
    }
  }
}

/**
 * Run the read-only production replay report across every supplied family.
 *
 * Pure and deterministic: identical `families` + `opts` always yield a
 * byte-identical `ProductionReplayReport`. Reuses the Stage 2 dry-run engine
 * (which reuses the Stage 1 reducer) — no Firestore, no wallet, no writes.
 */
export function runProductionReplay(
  families: readonly ProductionFamilyInput[],
  opts: ProductionReplayOptions = {},
): ProductionReplayReport {
  const familyReports: ProductionFamilyReport[] = families
    .map((input) => replayFamily(input, opts))
    .sort((a, b) => (a.familyId < b.familyId ? -1 : a.familyId > b.familyId ? 1 : 0))

  const counts: ReplayReportCounts = { ...EMPTY_COUNTS }
  let totalSources = 0
  let totalEventsBuilt = 0
  for (const fr of familyReports) {
    counts.exact += fr.counts.exact
    counts.estimated += fr.counts.estimated
    counts.malformed += fr.counts.malformed
    counts.ambiguous += fr.counts.ambiguous
    counts.skipped += fr.counts.skipped
    totalSources += fr.totalSources
    totalEventsBuilt += fr.eventsBuilt
  }

  return {
    generatedAt: opts.updatedAt ?? REPORT_EPOCH,
    schemaVersion: GAMIFICATION_V4_SCHEMA_VERSION,
    gate: 'GATE_1_REACHED',
    totalFamilies: familyReports.length,
    totalSources,
    totalEventsBuilt,
    counts,
    families: familyReports,
    walletSnapshot: summarizeWalletSnapshot(opts.walletSnapshot),
  }
}

// ---------------------------------------------------------------------------
// Emitters (markdown + JSON)
// ---------------------------------------------------------------------------

export function emitProductionReportJson(report: ProductionReplayReport): string {
  return JSON.stringify(report, null, 2)
}

export function emitProductionReportMarkdown(report: ProductionReplayReport): string {
  const lines: string[] = []
  lines.push('# Gamification V4 — Production Replay Report (GATE 1)')
  lines.push('')
  lines.push(`- Replay clock: ${report.generatedAt}`)
  lines.push(`- Schema version: ${report.schemaVersion}`)
  lines.push(`- **Gate: ${report.gate}** — owner approval required before Stage 4.`)
  lines.push('')
  lines.push('## Aggregate totals')
  lines.push('')
  lines.push(`- Families: ${report.totalFamilies}`)
  lines.push(`- Sources processed: ${report.totalSources}`)
  lines.push(`- Events built (exact + estimated): ${report.totalEventsBuilt}`)
  lines.push(`- exact: ${report.counts.exact}`)
  lines.push(`- estimated: ${report.counts.estimated}`)
  lines.push(`- malformed: ${report.counts.malformed}`)
  lines.push(`- ambiguous: ${report.counts.ambiguous}`)
  lines.push(`- skipped: ${report.counts.skipped}`)
  lines.push('')
  lines.push('## Wallet protection (hashes only)')
  lines.push('')
  if (report.walletSnapshot) {
    lines.push(`- Global SHA-256: \`${report.walletSnapshot.globalSha256}\``)
    lines.push(`- Hashed documents: ${report.walletSnapshot.totalCount}`)
    lines.push('')
    lines.push('| Collection | Docs | SHA-256 |')
    lines.push('|---|---|---|')
    for (const c of report.walletSnapshot.collections) {
      lines.push(`| ${c.name} | ${c.count} | \`${c.sha256}\` |`)
    }
  } else {
    lines.push(
      '_No wallet snapshot embedded. Wallet data is out of scope and must be verified separately via `scripts/wallet-snapshot.cjs --check`._',
    )
  }
  lines.push('')
  lines.push('## Per-family detail')
  lines.push('')
  for (const fr of report.families) {
    lines.push(`### Family \`${fr.familyId}\``)
    lines.push('')
    if (fr.error) {
      lines.push(`> Replay error: ${fr.error}`)
      lines.push('')
    }
    lines.push(
      `- Sources: ${fr.totalSources} | Events: ${fr.eventsBuilt} | Displayed provided: ${fr.displayedProvided}`,
    )
    lines.push(
      `- exact: ${fr.counts.exact} | estimated: ${fr.counts.estimated} | malformed: ${fr.counts.malformed} | ambiguous: ${fr.counts.ambiguous} | skipped: ${fr.counts.skipped}`,
    )
    lines.push('')
    const memberIds = Object.keys(fr.members).sort()
    if (memberIds.length > 0) {
      lines.push('| Member | RP (replay) | XP (replay) | Lvl | Streak | Best | RP Δ | XP Δ | Lvl Δ |')
      lines.push('|---|---|---|---|---|---|---|---|---|')
      for (const memberId of memberIds) {
        const m = fr.members[memberId]
        const d = m.diff
        lines.push(
          `| ${memberId} | ${m.replayed.rewardPoints} | ${m.replayed.xpTotal} | ${m.replayed.level} | ${m.replayed.currentStreak} | ${m.replayed.bestStreak} | ${d ? d.rewardPoints : '—'} | ${d ? d.xpTotal : '—'} | ${d ? d.level : '—'} |`,
        )
      }
    }
    lines.push('')
  }
  lines.push('---')
  lines.push('')
  lines.push(
    '_Generated by `scripts/replay/production-report.ts`. Read-only; no production writes. Wallet values shown only as hashes._',
  )
  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// CLI (opt-in file emission; reads local fixtures, never Firestore)
// ---------------------------------------------------------------------------

interface CliArgs {
  fixtures: string
  walletSnapshot?: string
  outDir?: string
  markdown?: string
  json?: string
}

function parseArgs(argv: string[]): CliArgs {
  let fixtures: string | undefined
  let walletSnapshot: string | undefined
  let outDir: string | undefined
  let markdown: string | undefined
  let json: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--fixtures') fixtures = argv[++i]
    else if (a === '--wallet-snapshot') walletSnapshot = argv[++i]
    else if (a === '--out-dir') outDir = argv[++i]
    else if (a === '--markdown') markdown = argv[++i]
    else if (a === '--json') json = argv[++i]
  }
  if (!fixtures) throw new Error('missing required --fixtures <dir>')
  return { fixtures, walletSnapshot, outDir, markdown, json }
}

/** Sum the replay-source documents of a parsed fixture (excludes `displayed`). */
export function sumSourceArrays(family: LegacyFamily): number {
  return (
    (family.taskCompletions?.length ?? 0) +
    (family.behaviours?.length ?? 0) +
    (family.dailyProgress?.length ?? 0) +
    (family.redemptions?.length ?? 0) +
    (family.reversals?.length ?? 0) +
    (family.avatarUnlocks?.length ?? 0) +
    (family.manualAdjustments?.length ?? 0)
  )
}

/**
 * Decide the production-report CLI exit code from Gate 1 invariants.
 * Hard failure: families present but zero replay sources => invalid mapping.
 * Sanity: displayed gamification summaries must NOT be counted as sources.
 * The independently summed source arrays are an UPPER BOUND on the reported
 * total (readers legitimately filter non-perfect days and skip malformed
 * docs), so the only invalid case is when MORE sources are reported than exist
 * in the fixtures — that would mean summaries/other data leaked in.
 */
export function decideReportExitCode(opts: {
  totalFamilies: number
  totalSources: number
  expectedSources: number
}): number {
  if (opts.totalFamilies > 0 && opts.totalSources === 0) return 1
  if (opts.expectedSources < opts.totalSources) return 1
  return 0
}

export function runCli(argv: string[]): number {
  let args: CliArgs
  try {
    args = parseArgs(argv)
  } catch (e) {
    console.error(`production-report: ${(e as Error).message}`)
    console.error(
      'usage: production-report.ts --fixtures <dir> [--wallet-snapshot <file>] [--out-dir <dir>] [--markdown <file>] [--json <file>]',
    )
    return 2
  }

  const fixturesDir = resolve(args.fixtures)
  if (!existsSync(fixturesDir)) {
    console.error(`production-report: fixtures dir not found: ${fixturesDir}`)
    return 1
  }

  let files: string[]
  try {
    files = readdirSync(fixturesDir).filter((f: string) => f.endsWith('.json'))
  } catch (e) {
    console.error(`production-report: cannot read fixtures dir: ${(e as Error).message}`)
    return 1
  }

  const families: ProductionFamilyInput[] = []
  const familyTasks: Record<string, Record<string, number>> = {}
  for (const file of files) {
    let raw: string
    try {
      raw = readFileSync(join(fixturesDir, file), 'utf8')
    } catch (e) {
      console.error(`production-report: cannot read ${file}: ${(e as Error).message}`)
      return 1
    }
    try {
      const parsed = JSON.parse(raw) as LegacyFamily & {
        displayed?: Readonly<Record<string, DisplayedMemberState>>
        tasks?: Readonly<Record<string, number>>
      }
      const { displayed, tasks, ...family } = parsed
      families.push({ family, displayed })
      if (tasks) familyTasks[family.familyId] = { ...tasks }
    } catch (e) {
      console.error(`production-report: invalid JSON in ${file}: ${(e as Error).message}`)
      return 1
    }
  }

  let walletSnapshot: WalletSnapshotManifest | null = null
  if (args.walletSnapshot) {
    try {
      walletSnapshot = JSON.parse(readFileSync(resolve(args.walletSnapshot), 'utf8')) as WalletSnapshotManifest
    } catch (e) {
      console.error(`production-report: cannot read wallet snapshot: ${(e as Error).message}`)
      return 1
    }
  }

  const taskPointsLookup = (familyId: string, taskId: string): number | null =>
    familyTasks[familyId]?.[taskId] ?? null

  const report = runProductionReplay(families, { walletSnapshot, taskPointsLookup })

  // Sanity: displayed gamification summaries must NOT be counted as sources.
  // Independently sum the source arrays of every parsed fixture and compare.
  const expectedSources = families.reduce((sum, f) => sum + sumSourceArrays(f.family), 0)

  const exitCode = decideReportExitCode({
    totalFamilies: report.totalFamilies,
    totalSources: report.totalSources,
    expectedSources,
  })
  if (exitCode !== 0) {
    console.error('production-report: No replay sources found; fixture mapping is invalid.')
    return exitCode
  }

  const markdownOut = emitProductionReportMarkdown(report)
  const jsonOut = emitProductionReportJson(report)

  const outDir = args.outDir ?? resolve(process.cwd(), 'docs/gamification-v4')
  const markdownPath = args.markdown ?? join(outDir, '03-production-replay-report.md')
  const jsonPath = args.json ?? join(outDir, '03-production-replay-report.json')

  try {
    mkdirSync(resolve(markdownPath, '..'), { recursive: true })
    mkdirSync(resolve(jsonPath, '..'), { recursive: true })
    writeFileSync(markdownPath, markdownOut)
    writeFileSync(jsonPath, jsonOut)
  } catch (e) {
    console.error(`production-report: cannot write artifacts: ${(e as Error).message}`)
    return 1
  }

  console.log(
    `production-report: families=${report.totalFamilies} sources=${report.totalSources} ` +
      `exact=${report.counts.exact} estimated=${report.counts.estimated} ` +
      `malformed=${report.counts.malformed} ambiguous=${report.counts.ambiguous} ` +
      `skipped=${report.counts.skipped} events=${report.totalEventsBuilt}`,
  )
  console.log(`production-report: wrote ${markdownPath}`)
  console.log(`production-report: wrote ${jsonPath}`)
  return 0
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  process.exitCode = runCli(process.argv.slice(2))
}
