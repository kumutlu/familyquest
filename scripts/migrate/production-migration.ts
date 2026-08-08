/**
 * Gamification V4 — Phase 2 (blocker B2): PRODUCTION-SAFE Stage 5 migration.
 *
 * The Stage 5 writer (`write-v4-ledger.ts` + `migration-marker.ts`) was
 * emulator-only, so no production V4 ledger/state and no
 * `gamification_migration_marker` could ever exist. This module adds the ONE
 * explicitly-authorised production path, without removing any safety guard:
 *
 *   - EMULATOR                : allowed exactly as before.
 *   - PRODUCTION              : allowed ONLY inside `runWithTrustedMigration`
 *                               (`GAMIFICATION_MIGRATION_MODE=production-trusted`,
 *                               identified operator, `--execute`, Gate 1 hash).
 *   - DRY RUN (the default)   : establishes NO write authority at all. It reads,
 *                               validates and reports; a production dry run is
 *                               physically incapable of writing.
 *
 * Procedure per family (family-scoped, never global):
 *   1. validate the APPROVED Gate 1 artifact for THIS family (Phase 1);
 *   2. capture the wallet BEFORE hash (hashes only, never wallet values);
 *   3. write the V4 events + state (Stage 5.1 writer, deterministic ids);
 *   4. capture the wallet AFTER hash;
 *   5. BEFORE != AFTER  =>  FAIL CLOSED, no marker;
 *   6. only on equality, write the idempotent `gamification_migration_marker`.
 *
 * Invariants:
 *   - no legacy collection is read or written;
 *   - no wallet VALUE is ever used as a gamification input;
 *   - rerunning is a no-op (deterministic event ids + fixed marker doc id);
 *   - every failure leaves the marker absent, so Gate 2 stays closed.
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Firestore } from 'firebase-admin/firestore'

import {
  runWithTrustedMigration,
  type TrustedMigrationContext,
} from '../../functions/src/gamification/v4/trustedServerContext'
import { isEmulatorOnlyMode } from '../../functions/src/gamification/v4/repository'
import { writeMigrationLedger } from './write-v4-ledger'
import { writeMigrationMarker, migrationMarkerDocPath, type MigrationMarkerV4 } from './migration-marker'
import { validateGate1Artifact, type Gate1Artifact } from '../gate1/gate1-artifact'
import type { ProductionReplayReport } from '../replay/production-report'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const walletSnap: any = require('../wallet-snapshot.cjs')

/** Default freshness window for the Gate 1 artifact used by a migration. */
export const GATE1_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Thrown when a migration is refused. Always leaves the marker absent. */
export class MigrationRefusedError extends Error {
  constructor(message: string) {
    super(`[migration] ${message}`)
    this.name = 'MigrationRefusedError'
  }
}

/** Thrown when the wallet hash changed across the migration (fail closed). */
export class MigrationWalletDivergedError extends Error {
  constructor(
    readonly before: string | null,
    readonly after: string | null,
  ) {
    super(`[migration] wallet hash changed across migration (before=${before} after=${after}); marker NOT written`)
    this.name = 'MigrationWalletDivergedError'
  }
}

export interface FamilyMigrationPlan {
  readonly familyId: string
  readonly classification: string
  readonly memberIds: readonly string[]
  readonly eventsToWrite: number
  readonly statesToWrite: number
  readonly gate1Hash: string
  readonly markerPath: string
}

export interface FamilyMigrationResult {
  readonly familyId: string
  readonly executed: boolean
  readonly dryRun: boolean
  readonly plan: FamilyMigrationPlan
  readonly walletHashBefore: string | null
  readonly walletHashAfter: string | null
  readonly walletHashOk: boolean
  readonly eventsWritten: number
  readonly statesWritten: number
  readonly marker: MigrationMarkerV4 | null
  /** True when the marker already existed with identical evidence (rerun). */
  readonly rerunNoOp: boolean
}

export interface RunFamilyMigrationOptions {
  readonly db: Firestore
  /** The approved Stage 3 replay report (source of the baseline values). */
  readonly report: ProductionReplayReport
  /** The Phase 1 Gate 1 evidence artifact (owner approved). */
  readonly gate1: Gate1Artifact
  readonly familyId: string
  /** Identity of the human operator. Required for any execute run. */
  readonly operator?: string
  /** Dry run unless explicitly true. */
  readonly execute?: boolean
  readonly now?: () => number
  readonly maxGate1AgeMs?: number
  /** Migration timestamp override (determinism in tests). */
  readonly migratedAt?: string
}

export interface ProductionMigrationCliArgs {
  readonly projectId: string
  readonly familyId: string
  readonly reportPath: string
  readonly gate1Path: string
  readonly execute: true
  readonly operator: string
}

/** Parse the supported production migration/recovery command. It is always family-scoped and execute-explicit. */
export function parseProductionMigrationCliArgs(argv: readonly string[]): ProductionMigrationCliArgs {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const projectId = value('--project')
  const familyId = value('--family')
  const reportPath = value('--report')
  const gate1Path = value('--gate1')
  const operator = value('--operator')
  const execute = argv.includes('--execute')
  if (!projectId || !familyId || !reportPath || !gate1Path || !execute || !operator) {
    throw new MigrationRefusedError('--project, --family, --report, --gate1, --execute and --operator are required')
  }
  return { projectId, familyId, reportPath, gate1Path, execute: true, operator }
}

/** Narrow the approved report to ONE family (family-scoped migration). */
export function scopeReportToFamily(
  report: ProductionReplayReport,
  familyId: string,
): ProductionReplayReport {
  const family = (report.families ?? []).find((f) => f.familyId === familyId)
  if (!family) {
    throw new MigrationRefusedError(`family ${familyId} is not present in the approved replay report`)
  }
  return {
    ...report,
    totalFamilies: 1,
    totalSources: family.totalSources,
    totalEventsBuilt: family.eventsBuilt,
    counts: family.counts,
    families: [family],
  }
}

/**
 * Current wallet manifest (Stage 0.4 collector), HASHES ONLY.
 * READ ONLY — no wallet value is returned to, or used by, gamification.
 */
export async function captureWalletManifest(db: Firestore): Promise<{
  readonly globalSha256: string
  readonly totalCount: number
  readonly collections: Record<string, { count: number; sha256: string }>
}> {
  const ro = new walletSnap.ReadOnlyFirestore(db)
  const entries = await walletSnap.collectEntries(ro)
  return walletSnap.buildManifest(entries, { projectId: null })
}

/** Convenience: the global wallet hash only. */
export async function currentWalletHash(db: Firestore): Promise<string> {
  return (await captureWalletManifest(db)).globalSha256
}

/**
 * Run the family-scoped Stage 5 migration.
 *
 * DRY RUN by default: returns the plan with zero writes and no write authority.
 * `execute: true` requires an operator, a valid Gate 1 artifact for the family,
 * and — off the emulator — the trusted production migration mode.
 */
export async function runFamilyMigration(
  options: RunFamilyMigrationOptions,
): Promise<FamilyMigrationResult> {
  const { db, report, gate1, familyId } = options
  const now = options.now ?? (() => Date.now())
  const execute = options.execute === true
  const emulator = isEmulatorOnlyMode()

  if (!familyId) throw new MigrationRefusedError('no familyId supplied; migration is family-scoped')

  // --- Gate 1 (approved artifact, this family, fresh, hash-verified) --------
  const verdict = validateGate1Artifact(gate1, {
    familyId,
    now,
    maxAgeMs: options.maxGate1AgeMs ?? GATE1_MAX_AGE_MS,
  })
  if (!verdict.valid) {
    throw new MigrationRefusedError(`Gate 1 evidence rejected: ${verdict.reason}`)
  }

  const scoped = scopeReportToFamily(report, familyId)
  const family = scoped.families[0]
  const memberIds = Object.keys(family.members).sort()

  const plan: FamilyMigrationPlan = {
    familyId,
    classification: verdict.classification as string,
    memberIds,
    eventsToWrite: memberIds.length,
    statesToWrite: memberIds.length,
    gate1Hash: gate1.reportHash,
    markerPath: migrationMarkerDocPath(familyId),
  }

  if (!execute) {
    // A dry run establishes NO authority and performs NO write, in any target.
    return {
      familyId,
      executed: false,
      dryRun: true,
      plan,
      walletHashBefore: null,
      walletHashAfter: null,
      walletHashOk: false,
      eventsWritten: 0,
      statesWritten: 0,
      marker: null,
      rerunNoOp: false,
    }
  }

  const operator = (options.operator ?? '').trim()
  if (!operator) {
    throw new MigrationRefusedError('--operator is required for an execute run')
  }

  // --- wallet BEFORE (hashes only) -----------------------------------------
  const walletBefore = await captureWalletManifest(db)
  const walletHashBefore = walletBefore.globalSha256

  const context: TrustedMigrationContext = {
    trustedServer: true,
    writer: 'migration',
    route: 'migration',
    familyId,
    operator,
    gate1Hash: gate1.reportHash,
    execute: true,
    // Wall clock on purpose: this stamps when THIS process proved the gate, and
    // is what the trusted-context staleness window is measured against. The
    // injected `now` governs EVIDENCE freshness only (and is test-injectable).
    gate: { passed: true, verifiedAt: Date.now() },
  }

  const write = async (): Promise<{ eventsWritten: number; statesWritten: number }> => {
    const result = await writeMigrationLedger(scoped, db, { updatedAt: report.generatedAt })
    return { eventsWritten: result.eventsWritten, statesWritten: result.statesWritten }
  }

  // Emulator keeps its historical path; production requires the trusted scope.
  const written = emulator ? await write() : await runWithTrustedMigration(context, write)

  // --- wallet AFTER (hashes only) ------------------------------------------
  const walletHashAfter = await currentWalletHash(db)
  if (walletHashBefore !== walletHashAfter) {
    throw new MigrationWalletDivergedError(walletHashBefore, walletHashAfter)
  }

  // --- marker: written ONLY after proven wallet equality --------------------
  const priorMarker = (await db.doc(migrationMarkerDocPath(familyId)).get()).data() as
    | MigrationMarkerV4
    | undefined

  const writeMarker = (): Promise<MigrationMarkerV4> =>
    writeMigrationMarker(familyId, gate1.reportHash, {
      db,
      walletBaseline: walletBefore,
      eventsWritten: written.eventsWritten,
      statesWritten: written.statesWritten,
      ...(options.migratedAt ? { migratedAt: options.migratedAt } : {}),
    })

  const marker = emulator ? await writeMarker() : await runWithTrustedMigration(context, writeMarker)

  return {
    familyId,
    executed: true,
    dryRun: false,
    plan,
    walletHashBefore,
    walletHashAfter,
    walletHashOk: true,
    eventsWritten: written.eventsWritten,
    statesWritten: written.statesWritten,
    marker,
    rerunNoOp:
      priorMarker !== undefined
      && priorMarker.reportHash === marker.reportHash
      && priorMarker.eventsWritten === marker.eventsWritten,
  }
}

/** Supported production CLI used for the first migration and partial-state recovery rerun. */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<FamilyMigrationResult> {
  const args = parseProductionMigrationCliArgs(argv)
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    throw new MigrationRefusedError('production migration CLI refuses FIRESTORE_EMULATOR_HOST')
  }
  const report = JSON.parse(readFileSync(resolve(args.reportPath), 'utf8')) as ProductionReplayReport
  const gate1 = JSON.parse(readFileSync(resolve(args.gate1Path), 'utf8')) as Gate1Artifact
  const { initializeApp, getApps } = await import('firebase-admin/app')
  const { getFirestore } = await import('firebase-admin/firestore')
  if (getApps().length === 0) initializeApp({ projectId: args.projectId })
  const result = await runFamilyMigration({
    db: getFirestore(),
    report,
    gate1,
    familyId: args.familyId,
    execute: true,
    operator: args.operator,
  })
  console.log(JSON.stringify({
    familyId: result.familyId,
    executed: result.executed,
    walletHashOk: result.walletHashOk,
    eventsWritten: result.eventsWritten,
    statesWritten: result.statesWritten,
    markerStatus: result.marker?.status ?? null,
    rerunNoOp: result.rerunNoOp,
  }))
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
