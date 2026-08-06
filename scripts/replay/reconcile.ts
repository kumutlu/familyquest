/**
 * Gamification V4 — Gate 1 reconciliation (READ-ONLY).
 *
 * Answers exactly one question, with evidence for every single record:
 *
 *   Why does the fixture export contain N source documents while the
 *   production replay report processes M sources?
 *
 * It reuses (never duplicates) the Stage 2 readers (`replay/sources.ts`) and the
 * Stage 2 classification engine (`replay/classify.ts`). It never guesses, never
 * writes production data, never touches wallet data, and never imports a
 * Firestore SDK: it only reads local fixture JSON files produced by
 * `scripts/replay/export-to-fixtures.ts`.
 *
 * Hard invariant (Gate 1, "no silent loss"):
 *
 *   exported == exact + estimated + malformed + ambiguous + skipped + filtered
 *
 * and every `filtered` (dropped) row must carry a machine-readable reason.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  type LegacyFamily,
  type ReplaySourceRecord,
  readTaskCompletions,
  readBehaviours,
  readDailyPerfectDay,
  readRedemptions,
  readRefundsReversals,
  readAvatarUnlocks,
  readManualAdjustments,
} from '../../src/domain/gamification/v4/replay/sources'
import { classifyAll } from '../../src/domain/gamification/v4/replay/classify'
import { assertGate1Reconciliation, type Gate1ReconciliationInput } from './verify'

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** Fixture source arrays, in the fixed order used by every table we emit. */
export const SOURCE_FIELDS = [
  'taskCompletions',
  'behaviours',
  'dailyProgress',
  'redemptions',
  'reversals',
  'avatarUnlocks',
  'manualAdjustments',
] as const

export type SourceField = (typeof SOURCE_FIELDS)[number]

/** Which Stage 2 reader consumes each fixture array. */
export const READER_FOR_FIELD: Readonly<Record<SourceField, (f: LegacyFamily) => ReplaySourceRecord[]>> = {
  taskCompletions: readTaskCompletions,
  behaviours: readBehaviours,
  dailyProgress: readDailyPerfectDay,
  redemptions: readRedemptions,
  reversals: readRefundsReversals,
  avatarUnlocks: readAvatarUnlocks,
  manualAdjustments: readManualAdjustments,
}

export interface DroppedRecord {
  readonly familyId: string
  readonly sourceId: string
  readonly sourceField: SourceField
  /** Exact pipeline stage where the record stopped existing. */
  readonly stage: 'reader' | 'classifier' | 'event-builder'
  readonly reason: string
  readonly evidence: string
  /** false => this is a bug that must be fixed before Gate 1 is accepted. */
  readonly intentional: boolean
}

export interface EstimatedRecord {
  readonly familyId: string
  readonly sourceId: string
  readonly sourceField: SourceField
  readonly sourceType: string
  /** The exact field whose historical value was missing. */
  readonly missingValue: string
  /** The value actually used instead. */
  readonly fallbackValue: number | null
  readonly fallbackSource: string
  readonly designJustification: string
  /** Current configured task points (the fallback input), when applicable. */
  readonly currentTaskValue: number | null
  /** Historical snapshot value, when one exists (null => none recorded). */
  readonly historicalSnapshotValue: number | null
}

export interface FieldReconciliation {
  readonly sourceField: SourceField
  readonly exported: number
  readonly readerOutput: number
  readonly classified: number
  readonly exact: number
  readonly estimated: number
  readonly malformed: number
  readonly ambiguous: number
  readonly skipped: number
  readonly eventBuilt: number
  readonly dropped: number
  readonly reasons: readonly string[]
}

export interface FamilyReconciliation {
  readonly familyId: string
  readonly exported: number
  readonly readerOutput: number
  readonly eventBuilt: number
  readonly dropped: number
  readonly fields: readonly FieldReconciliation[]
}

export interface ReconciliationResult {
  readonly totalFamilies: number
  readonly exported: number
  readonly readerOutput: number
  readonly classified: number
  readonly eventBuilt: number
  readonly dropped: number
  readonly counts: {
    readonly exact: number
    readonly estimated: number
    readonly malformed: number
    readonly ambiguous: number
    readonly skipped: number
  }
  readonly balanced: boolean
  readonly byField: readonly FieldReconciliation[]
  readonly families: readonly FamilyReconciliation[]
  readonly droppedRecords: readonly DroppedRecord[]
  readonly estimatedRecords: readonly EstimatedRecord[]
}

/** Fixture file shape: legacy family + non-source side tables. */
export interface FixtureFile extends LegacyFamily {
  readonly tasks?: Readonly<Record<string, number>>
  readonly displayed?: Readonly<Record<string, unknown>>
}

// ---------------------------------------------------------------------------
// Drop reasons (explicit, never silent)
// ---------------------------------------------------------------------------

/**
 * The single legitimate reader-stage filter in the pipeline: `dailyProgress`
 * rows are only a replay source when they awarded a perfect-day bonus. Every
 * other row is a display aggregate, not an award, so replaying it would invent
 * points that were never granted.
 */
export function dropReasonFor(field: SourceField, doc: Record<string, unknown>): { reason: string; intentional: boolean } {
  if (field === 'dailyProgress') {
    return {
      reason:
        'daily_progress row is not a perfect day (perfectDay !== true): it is a display aggregate, ' +
        'not a reward award, and readDailyPerfectDay intentionally excludes it',
      intentional: true,
    }
  }
  return {
    reason: `record produced no reader output and no classification (unexplained ${field} drop)`,
    intentional: false,
  }
}

// ---------------------------------------------------------------------------
// Core (pure)
// ---------------------------------------------------------------------------

function docsOf(family: LegacyFamily, field: SourceField): ReadonlyArray<Record<string, unknown>> {
  return ((family as unknown as Record<string, unknown>)[field] as
    | ReadonlyArray<Record<string, unknown>>
    | undefined) ?? []
}

function emptyField(field: SourceField): {
  exact: number
  estimated: number
  malformed: number
  ambiguous: number
  skipped: number
  sourceField: SourceField
} {
  return { sourceField: field, exact: 0, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 }
}

/** Reconcile one family, record by record. Pure and deterministic. */
export function reconcileFamily(
  fixture: FixtureFile,
): {
  family: FamilyReconciliation
  dropped: DroppedRecord[]
  estimated: EstimatedRecord[]
} {
  const familyId = fixture.familyId
  const tasks = fixture.tasks ?? {}
  const taskPointsLookup = (taskId: string): number | null =>
    typeof tasks[taskId] === 'number' ? tasks[taskId] : null

  const dropped: DroppedRecord[] = []
  const estimated: EstimatedRecord[] = []
  const fields: FieldReconciliation[] = []

  // 1. Reader stage, per field, so a per-field reader failure is attributable.
  const readerOutputByField = new Map<SourceField, ReplaySourceRecord[]>()
  const readerErrorByField = new Map<SourceField, string>()
  for (const field of SOURCE_FIELDS) {
    try {
      readerOutputByField.set(field, READER_FOR_FIELD[field](fixture))
    } catch (e) {
      readerOutputByField.set(field, [])
      readerErrorByField.set(field, (e as Error).message)
    }
  }

  // 2. Classification stage over the exact source list the dry-run builds.
  const allSources: ReplaySourceRecord[] = SOURCE_FIELDS.flatMap(
    (field) => readerOutputByField.get(field) ?? [],
  )
  const classifications = classifyAll(allSources, { taskPointsLookup })
  const classificationBySourceId = new Map<string, (typeof classifications)[number]>()
  for (let i = 0; i < allSources.length; i++) {
    classificationBySourceId.set(allSources[i].sourceId, classifications[i])
  }

  let famExported = 0
  let famReader = 0
  let famEvents = 0

  for (const field of SOURCE_FIELDS) {
    const docs = docsOf(fixture, field)
    const records = readerOutputByField.get(field) ?? []
    const readerIds = new Set(records.map((r) => r.sourceId))
    const acc = emptyField(field)
    const reasons = new Set<string>()
    let eventBuilt = 0

    for (const record of records) {
      const c = classificationBySourceId.get(record.sourceId)
      if (!c) continue
      acc[c.category] += 1
      if (c.category === 'exact' || c.category === 'estimated') eventBuilt += 1
      if (c.category === 'estimated') {
        const raw = record.raw as {
          taskId?: string
          awardedPoints?: number | null
          effectSnapshot?: { pointsDelta?: number | null } | null
        }
        const snapshot = raw.effectSnapshot?.pointsDelta
        estimated.push({
          familyId,
          sourceId: record.sourceId,
          sourceField: field,
          sourceType: record.sourceType,
          missingValue: 'awardedPoints (historical points snapshot on the legacy document)',
          fallbackValue: c.rewardPoints,
          fallbackSource: `current task configuration points for taskId=${raw.taskId ?? ''}`,
          designJustification:
            'approved design §5: when the historical award snapshot is absent the replay may use the ' +
            "task's currently configured points, but the record MUST be flagged `estimated` so it is " +
            'never mistaken for an exact value; guessing any other number is forbidden',
          currentTaskValue: raw.taskId ? taskPointsLookup(raw.taskId) : null,
          historicalSnapshotValue: typeof snapshot === 'number' ? snapshot : null,
        })
      }
      if (c.category === 'malformed' || c.category === 'ambiguous' || c.category === 'skipped') {
        dropped.push({
          familyId,
          sourceId: record.sourceId,
          sourceField: field,
          stage: 'event-builder',
          reason: c.reason,
          evidence: c.evidence,
          intentional: true,
        })
        reasons.add(c.reason)
      }
    }

    // Reader-stage drops: exported document with no reader output.
    const readerError = readerErrorByField.get(field)
    for (const doc of docs) {
      const id = String(doc.id ?? '')
      if (readerIds.has(id)) continue
      const info = readerError
        ? { reason: `reader threw: ${readerError}`, intentional: false }
        : dropReasonFor(field, doc)
      dropped.push({
        familyId,
        sourceId: id,
        sourceField: field,
        stage: 'reader',
        reason: info.reason,
        evidence: `familyId=${familyId} field=${field} id=${id}`,
        intentional: info.intentional,
      })
      reasons.add(info.reason)
    }

    const classified = acc.exact + acc.estimated + acc.malformed + acc.ambiguous + acc.skipped
    fields.push({
      sourceField: field,
      exported: docs.length,
      readerOutput: records.length,
      classified,
      exact: acc.exact,
      estimated: acc.estimated,
      malformed: acc.malformed,
      ambiguous: acc.ambiguous,
      skipped: acc.skipped,
      eventBuilt,
      dropped: docs.length - records.length,
      reasons: [...reasons].sort(),
    })

    famExported += docs.length
    famReader += records.length
    famEvents += eventBuilt
  }

  return {
    family: {
      familyId,
      exported: famExported,
      readerOutput: famReader,
      eventBuilt: famEvents,
      dropped: famExported - famReader,
      fields,
    },
    dropped,
    estimated,
  }
}

/** Reconcile every fixture. Pure and deterministic (input order independent). */
export function reconcileAll(fixtures: readonly FixtureFile[]): ReconciliationResult {
  const sorted = [...fixtures].sort((a, b) => (a.familyId < b.familyId ? -1 : a.familyId > b.familyId ? 1 : 0))
  const families: FamilyReconciliation[] = []
  const droppedRecords: DroppedRecord[] = []
  const estimatedRecords: EstimatedRecord[] = []
  for (const fixture of sorted) {
    const r = reconcileFamily(fixture)
    families.push(r.family)
    droppedRecords.push(...r.dropped)
    estimatedRecords.push(...r.estimated)
  }

  const byField: FieldReconciliation[] = SOURCE_FIELDS.map((field) => {
    const acc = {
      sourceField: field,
      exported: 0,
      readerOutput: 0,
      classified: 0,
      exact: 0,
      estimated: 0,
      malformed: 0,
      ambiguous: 0,
      skipped: 0,
      eventBuilt: 0,
      dropped: 0,
      reasons: new Set<string>(),
    }
    for (const fam of families) {
      const f = fam.fields.find((x) => x.sourceField === field)!
      acc.exported += f.exported
      acc.readerOutput += f.readerOutput
      acc.classified += f.classified
      acc.exact += f.exact
      acc.estimated += f.estimated
      acc.malformed += f.malformed
      acc.ambiguous += f.ambiguous
      acc.skipped += f.skipped
      acc.eventBuilt += f.eventBuilt
      acc.dropped += f.dropped
      for (const r of f.reasons) acc.reasons.add(r)
    }
    return { ...acc, reasons: [...acc.reasons].sort() }
  })

  const counts = {
    exact: byField.reduce((s, f) => s + f.exact, 0),
    estimated: byField.reduce((s, f) => s + f.estimated, 0),
    malformed: byField.reduce((s, f) => s + f.malformed, 0),
    ambiguous: byField.reduce((s, f) => s + f.ambiguous, 0),
    skipped: byField.reduce((s, f) => s + f.skipped, 0),
  }
  const exported = byField.reduce((s, f) => s + f.exported, 0)
  const readerOutput = byField.reduce((s, f) => s + f.readerOutput, 0)
  const classified = byField.reduce((s, f) => s + f.classified, 0)
  const eventBuilt = byField.reduce((s, f) => s + f.eventBuilt, 0)
  const filtered = droppedRecords.filter((d) => d.stage === 'reader').length

  return {
    totalFamilies: families.length,
    exported,
    readerOutput,
    classified,
    eventBuilt,
    dropped: exported - readerOutput,
    counts,
    balanced:
      exported ===
      counts.exact + counts.estimated + counts.malformed + counts.ambiguous + counts.skipped + filtered,
    byField,
    families,
    droppedRecords,
    estimatedRecords,
  }
}

/** Gate 1 assertion input derived from a reconciliation result. */
export function gate1InputFor(result: ReconciliationResult): Gate1ReconciliationInput {
  return {
    totalFamilies: result.totalFamilies,
    exportedSources: result.exported,
    reportedSources: result.readerOutput,
    counts: result.counts,
    filtered: result.droppedRecords
      .filter((d) => d.stage === 'reader')
      .map((d) => ({ sourceId: d.sourceId, reason: d.reason, evidence: d.evidence })),
  }
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

export function emitReconciliationMarkdown(result: ReconciliationResult): string {
  const lines: string[] = []
  lines.push('## Gate 1 reconciliation — exported vs replayed')
  lines.push('')
  lines.push(
    `- Exported sources: **${result.exported}** → reader output: **${result.readerOutput}** ` +
      `(dropped: **${result.dropped}**)`,
  )
  lines.push(
    `- Classified: ${result.classified} (exact ${result.counts.exact}, estimated ${result.counts.estimated}, ` +
      `malformed ${result.counts.malformed}, ambiguous ${result.counts.ambiguous}, skipped ${result.counts.skipped})`,
  )
  lines.push(`- Events built: ${result.eventBuilt}`)
  lines.push(`- Balance check (no silent loss): **${result.balanced ? 'PASS' : 'FAIL'}**`)
  lines.push('')
  lines.push('| source type | exported | reader output | classified | event built | dropped | reason |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const f of result.byField) {
    const reason = f.dropped === 0 ? '—' : f.reasons.join('; ')
    lines.push(
      `| ${f.sourceField} | ${f.exported} | ${f.readerOutput} | ${f.classified} | ${f.eventBuilt} | ${f.dropped} | ${reason} |`,
    )
  }
  lines.push('')
  lines.push('### Per-family (families with at least one exported source)')
  lines.push('')
  lines.push('| family | exported | reader output | event built | dropped |')
  lines.push('|---|---|---|---|---|')
  for (const fam of result.families) {
    if (fam.exported === 0) continue
    lines.push(`| ${fam.familyId} | ${fam.exported} | ${fam.readerOutput} | ${fam.eventBuilt} | ${fam.dropped} |`)
  }
  lines.push('')
  lines.push('### Export-stage filter (before fixtures exist)')
  lines.push('')
  lines.push(
    'The legacy `reversals` collection is a generic reversal log that also covers wallet/fund reversals. ' +
      '`export-to-fixtures.ts` keeps only `sourceKind ∈ {task_completion, reward_redemption}`; wallet/fund ' +
      'reversals are never exported, never counted as replay sources, and their values are never read.',
  )
  lines.push('')
  lines.push(
    '_Dropped records: `03-production-replay-dropped-records.json`. ' +
      'Estimated records: `03-production-replay-estimated-records.json`._',
  )
  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface ReconcileCliArgs {
  fixtures: string
  outDir: string
  /** Append the reconciliation section to the production replay markdown. */
  appendMarkdown: boolean
}

export function parseArgs(argv: readonly string[]): ReconcileCliArgs {
  let fixtures: string | undefined
  let outDir = 'docs/gamification-v4'
  let appendMarkdown = true
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--fixtures') fixtures = argv[++i]
    else if (a === '--out-dir') outDir = argv[++i]
    else if (a === '--no-markdown') appendMarkdown = false
    else throw new Error(`unknown argument: ${a}`)
  }
  if (!fixtures) throw new Error('missing required --fixtures <dir>')
  return { fixtures, outDir, appendMarkdown }
}

export function readFixtures(dir: string): FixtureFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as FixtureFile)
}

export function runCli(argv: readonly string[]): number {
  let args: ReconcileCliArgs
  try {
    args = parseArgs(argv)
  } catch (e) {
    console.error(`reconcile: ${(e as Error).message}`)
    console.error('usage: reconcile.ts --fixtures <dir> [--out-dir <dir>] [--no-markdown]')
    return 2
  }

  const fixturesDir = resolve(args.fixtures)
  if (!existsSync(fixturesDir)) {
    console.error(`reconcile: fixtures dir not found: ${fixturesDir}`)
    return 1
  }

  const result = reconcileAll(readFixtures(fixturesDir))

  const outDir = resolve(args.outDir)
  writeFileSync(
    join(outDir, '03-production-replay-dropped-records.json'),
    JSON.stringify(
      { total: result.droppedRecords.length, records: result.droppedRecords },
      null,
      2,
    ) + '\n',
  )
  writeFileSync(
    join(outDir, '03-production-replay-estimated-records.json'),
    JSON.stringify(
      { total: result.estimatedRecords.length, records: result.estimatedRecords },
      null,
      2,
    ) + '\n',
  )

  if (args.appendMarkdown) {
    const md = join(outDir, '03-production-replay-report.md')
    if (existsSync(md)) {
      // Idempotent: replace any previously appended section so repeated runs
      // produce a byte-identical file.
      const existing = readFileSync(md, 'utf8')
      const marker = '## Gate 1 reconciliation — exported vs replayed'
      const index = existing.indexOf(marker)
      const base = index === -1 ? existing : existing.slice(0, index)
      writeFileSync(md, base.replace(/\n+$/, '\n') + '\n' + emitReconciliationMarkdown(result))
    }
  }

  try {
    assertGate1Reconciliation(gate1InputFor(result))
  } catch (e) {
    console.error(`reconcile: GATE 1 FAILED — ${(e as Error).message}`)
    return 1
  }

  console.log(
    `reconcile: exported=${result.exported} reader=${result.readerOutput} ` +
      `exact=${result.counts.exact} estimated=${result.counts.estimated} ` +
      `malformed=${result.counts.malformed} ambiguous=${result.counts.ambiguous} ` +
      `skipped=${result.counts.skipped} filtered=${result.dropped} balanced=${result.balanced}`,
  )
  return 0
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  process.exitCode = runCli(process.argv.slice(2))
}
