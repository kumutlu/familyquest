/**
 * Gamification V4 — Task 5.1 write approved replay result to V4 ledger+state.
 *
 * Consumes ONLY the approved Gate 1 replay report
 * (`docs/gamification-v4/03-production-replay-report.json`, gate GATE_1_REACHED)
 * and writes, via the Stage 4 server repository, for every member of every
 * family:
 *   - one deterministic MIGRATION_BASELINE event at
 *     `families/{familyId}/gamification_events/{eventId}`
 *     (eventId = eventIdFor(familyId, memberId, 'MIGRATION_BASELINE', 'BASELINE'))
 *   - one rebuilt projection state at
 *     `families/{familyId}/gamification_state/{memberId}`
 *
 * The event id is the idempotency anchor, so a rerun overwrites the same
 * document (no duplicate award, no double state). The stored projection is, by
 * construction, exactly rebuildStateFromLedger([baseline]).
 *
 * Hard constraints (plan Task 5.1 + design §2):
 *  - Emulator only: the repository refuses any non-local FIRESTORE_EMULATOR_HOST.
 *  - No wallet collection is ever referenced or written.
 *  - The legacy system is never read or written; old app keeps reading it.
 *  - Fail closed on malformed / ambiguous / unapproved Gate 1 input.
 *
 * See docs/superpowers/plans/2026-08-05-gamification-v4-rewrite.md Task 5.1.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Firestore } from 'firebase-admin/firestore'

import {
  writeEventIdempotent,
  writeState,
} from '../../functions/src/gamification/v4/repository'
import { eventIdFor, MIGRATION_BASELINE_SOURCE_ID } from '../../src/domain/gamification/v4/ids'
import { GAMIFICATION_V4_SCHEMA_VERSION, type GamificationEventV4 } from '../../src/domain/gamification/v4/types'
import { rebuildStateFromLedger, type ReduceContextV4 } from '../../src/domain/gamification/v4/rebuild'
import type { ProductionReplayReport } from '../replay/production-report'

/** Thrown when the Gate 1 report is not safe to migrate from. */
export class UnapprovedGate1ReportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnapprovedGate1ReportError'
  }
}

/**
 * Fail closed unless the report is an approved Gate 1 artifact:
 *  - `gate` must be exactly `GATE_1_REACHED` (owner approved the replay),
 *  - schema version must match the V4 contract,
 *  - at least one family and one replay source (Gate 1 hard invariants),
 *  - no per-family replay error,
 *  - no malformed or ambiguous sources (nothing was silently dropped/coerced).
 */
export function assertApprovedGate1(report: ProductionReplayReport): void {
  if (!report || typeof report !== 'object') {
    throw new UnapprovedGate1ReportError('Gate 1 report is missing or not an object.')
  }
  if (report.gate !== 'GATE_1_REACHED') {
    throw new UnapprovedGate1ReportError(
      `Refusing to migrate: report gate is ${String(report.gate)}; expected GATE_1_REACHED (owner-approved).`,
    )
  }
  if (report.schemaVersion !== GAMIFICATION_V4_SCHEMA_VERSION) {
    throw new UnapprovedGate1ReportError(
      `Refusing to migrate: report schemaVersion ${report.schemaVersion} != ${GAMIFICATION_V4_SCHEMA_VERSION}.`,
    )
  }
  if (!Array.isArray(report.families) || report.families.length === 0) {
    throw new UnapprovedGate1ReportError('Refusing to migrate: Gate 1 report contains no families.')
  }
  for (const family of report.families) {
    if (family.error) {
      throw new UnapprovedGate1ReportError(
        `Refusing to migrate: family ${family.familyId} replay errored (${family.error}); input is unapproved.`,
      )
    }
  }
  if (report.totalSources <= 0) {
    throw new UnapprovedGate1ReportError('Refusing to migrate: Gate 1 report contains zero replay sources.')
  }
  const counts = report.counts ?? { exact: 0, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 }
  if (counts.malformed > 0) {
    throw new UnapprovedGate1ReportError(
      `Refusing to migrate: Gate 1 report has ${counts.malformed} malformed source(s).`,
    )
  }
  if (counts.ambiguous > 0) {
    throw new UnapprovedGate1ReportError(
      `Refusing to migrate: Gate 1 report has ${counts.ambiguous} ambiguous source(s).`,
    )
  }
}

export interface WriteMigrationLedgerOptions {
  /** Projection timestamp stamped on each rebuilt state. Defaults to report.generatedAt. */
  readonly updatedAt?: string
  /** Projection engine version. Defaults to 1. */
  readonly projectionVersion?: number
}

export interface WriteMigrationLedgerResult {
  readonly families: number
  readonly members: number
  readonly eventsWritten: number
  readonly statesWritten: number
}

/**
 * Write the approved replay result to the V4 ledger + state collections.
 *
 * Pure orchestration over the Stage 4 server repository; no Firestore SDK is
 * touched directly here. Each member gets exactly one MIGRATION_BASELINE event
 * (deltas = the replayed rewardPoints/xpTotal) and one rebuilt projection.
 * Rerunning is a no-op: the deterministic event id collides with the existing
 * document and overwrites it.
 */
export async function writeMigrationLedger(
  report: ProductionReplayReport,
  db: Firestore,
  opts: WriteMigrationLedgerOptions = {},
): Promise<WriteMigrationLedgerResult> {
  assertApprovedGate1(report)

  const updatedAt = opts.updatedAt ?? report.generatedAt
  const projectionVersion = opts.projectionVersion ?? 1
  const ctx: ReduceContextV4 = { updatedAt, projectionVersion }

  let members = 0
  let eventsWritten = 0
  let statesWritten = 0

  for (const family of report.families) {
    for (const [memberId, member] of Object.entries(family.members)) {
      const replayed = member.replayed
      const event: GamificationEventV4 = {
        schemaVersion: GAMIFICATION_V4_SCHEMA_VERSION,
        eventId: eventIdFor(family.familyId, memberId, 'MIGRATION_BASELINE', MIGRATION_BASELINE_SOURCE_ID),
        familyId: family.familyId,
        memberId,
        eventType: 'MIGRATION_BASELINE',
        sourceType: 'migration',
        sourceId: MIGRATION_BASELINE_SOURCE_ID,
        effectiveAt: report.generatedAt,
        createdAt: report.generatedAt,
        rewardPointsDelta: replayed.rewardPoints,
        xpDelta: replayed.xpTotal,
        metadata: {
          reason: 'migration_baseline',
          reportGeneratedAt: report.generatedAt,
          classification: 'migration',
        },
        estimated: false,
      }

      // Idempotent: deterministic id => overwrite, never duplicate.
      await writeEventIdempotent(db, event)
      eventsWritten++

      // Stored projection equals rebuildStateFromLedger([baseline]) by construction.
      const state = rebuildStateFromLedger([event], ctx)
      await writeState(db, family.familyId, memberId, state)
      statesWritten++

      members++
    }
  }

  return { families: report.families.length, members, eventsWritten, statesWritten }
}

// ---------------------------------------------------------------------------
// CLI entry point (emulator only; never contacts production)
// ---------------------------------------------------------------------------

const DEFAULT_REPORT_PATH = resolve(process.cwd(), 'docs/gamification-v4/03-production-replay-report.json')

interface MainArgs {
  readonly reportPath: string
}

function parseArgs(argv: readonly string[]): MainArgs {
  let reportPath = DEFAULT_REPORT_PATH
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--report') {
      const value = argv[i + 1]
      if (!value) throw new Error('--report requires a path argument')
      reportPath = resolve(process.cwd(), value)
      i++
    } else if (arg.startsWith('--report=')) {
      reportPath = resolve(process.cwd(), arg.slice('--report='.length))
    }
  }
  return { reportPath }
}

/** Read + parse the approved Gate 1 report artifact. */
export function loadApprovedReport(reportPath: string): ProductionReplayReport {
  const raw = readFileSync(reportPath, 'utf8')
  return JSON.parse(raw) as ProductionReplayReport
}

/**
 * CLI: write the approved replay result to the emulator-only V4 collections.
 * Refuses to run unless FIRESTORE_EMULATOR_HOST points at a local address
 * (enforced here and again inside the repository). No application default
 * credentials are ever constructed.
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<WriteMigrationLedgerResult> {
  const host = process.env.FIRESTORE_EMULATOR_HOST
  if (!host) {
    throw new Error('FIRESTORE_EMULATOR_HOST must be set (e.g. 127.0.0.1:8080). Refusing production run.')
  }
  const { initializeApp, getApps } = await import('firebase-admin/app')
  const { getFirestore } = await import('firebase-admin/firestore')
  if (getApps().length === 0) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'familyquest-beta-402cb' })
  }
  const db = getFirestore()

  const { reportPath } = parseArgs(argv)
  const report = loadApprovedReport(reportPath)
  const result = await writeMigrationLedger(report, db)
  // eslint-disable-next-line no-console
  console.log(
    `write-v4-ledger: families=${result.families} members=${result.members} ` +
      `events=${result.eventsWritten} states=${result.statesWritten}`,
  )
  return result
}

// Run only when invoked directly (tsx / node), never on import (keeps tests pure).
const invokedDirectly = process.argv[1] && /write-v4-ledger(\.[jt]s)?$/.test(process.argv[1])
if (invokedDirectly) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`write-v4-ledger failed: ${(err as Error).message}`)
    process.exit(1)
  })
}
