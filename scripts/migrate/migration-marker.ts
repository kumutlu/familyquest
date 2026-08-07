/**
 * Gamification V4 — Task 5.2 idempotent migration marker + wallet hash equality.
 *
 * This is the GATE 2 artifact. After Task 5.1 has written the approved replay
 * result to the V4 ledger + state (via the Stage 4 server repository), this
 * module:
 *
 *   1. Writes ONE idempotent migration marker document per family at the
 *      canonical path `families/{familyId}/gamification_migration_marker/marker`.
 *      The doc id is fixed (`marker`), so a rerun overwrites the same document
 *      — never duplicates it.
 *   2. Formally verifies wallet document hashes BEFORE == AFTER the migration.
 *      The migration never reads or writes wallet data, so the re-hashed wallet
 *      manifest must be byte-identical to the Stage 0.4 snapshot. Any diff
 *      FAILS CLOSED (throws) — the marker is never written on mismatch.
 *   3. Proves a full rerun is a no-op: re-executing the ledger write produces
 *      an identical ledger + state (deterministic event ids => no duplicate
 *      award, no double state).
 *
 * Hard constraints (plan Task 5.2 + design §2):
 *  - Emulator only: every write/verify is gated behind `assertEmulatorOnly`
 *    (reused from the Stage 4 repository). No production credentials are ever
 *    constructed.
 *  - No wallet collection is ever referenced or written. Only the wallet
 *    SNAPSHOT HASHES are compared; wallet VALUES are never read into
 *    gamification.
 *  - The legacy system is never read or written; the old app keeps reading it.
 *  - Fail closed on any wallet hash mismatch.
 *  - Reuses the Task 5.1 writer (`writeMigrationLedger`) and the Stage 4
 *    repositories (`writeEventIdempotent` / `writeState` / `readLedger` /
 *    `readState`). No duplicate migration path.
 *
 * See docs/superpowers/plans/2026-08-05-gamification-v4-rewrite.md Task 5.2.
 */

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { Firestore } from 'firebase-admin/firestore'

import {
  assertEmulatorOnly,
  readLedger,
  readState,
} from '../../functions/src/gamification/v4/repository'
import { GAMIFICATION_V4_SCHEMA_VERSION, businessFields, type GamificationStateV4 } from '../../src/domain/gamification/v4/types'
import { writeMigrationLedger, loadApprovedReport, type WriteMigrationLedgerResult } from './write-v4-ledger'
import type { ProductionReplayReport } from '../replay/production-report'

// Reuse the Stage 0.4 wallet-snapshot tooling (pure hashing + read-only
// collector). Imported via createRequire because it is a CommonJS module; it
// performs NO Firebase work on import (its main() is guarded by require.main).
const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const walletSnap: any = require('../wallet-snapshot.cjs')

/** Shape of the Stage 0.4 artifact produced by `scripts/wallet-snapshot.cjs`. */
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

/** Canonical marker document path (single, idempotent doc id per family). */
export const MIGRATION_MARKER_COLLECTION = 'gamification_migration_marker'
export const MIGRATION_MARKER_DOC_ID = 'marker'

/** `families/{familyId}/gamification_migration_marker/marker` */
export function migrationMarkerDocPath(familyId: string): string {
  return `families/${familyId}/${MIGRATION_MARKER_COLLECTION}/${MIGRATION_MARKER_DOC_ID}`
}

/** Authoritative migration marker (GATE 2 proof document). */
export interface MigrationMarkerV4 {
  readonly schemaVersion: number
  readonly familyId: string
  /** SHA-256 of the approved Gate 1 replay report this migration consumed. */
  readonly reportHash: string
  readonly status: 'MIGRATED'
  readonly migratedAt: string
  readonly eventsWritten: number
  readonly statesWritten: number
  /** Global SHA-256 of the Stage 0.4 wallet snapshot (BEFORE). */
  readonly walletHashBefore: string | null
  /** Global SHA-256 re-hashed after the migration (AFTER). */
  readonly walletHashAfter: string | null
  /** True iff BEFORE == AFTER (wallet byte-identical). */
  readonly walletHashOk: boolean
  /** Always true: the marker doc id is fixed, so reruns overwrite. */
  readonly idempotent: true
}

/** Thrown when wallet hashes differ before/after the migration (fail closed). */
export class WalletHashMismatchError extends Error {
  constructor(
    public readonly mismatches: ReadonlyArray<{ type: string; path: string }>,
    public readonly before: string | null,
    public readonly after: string | null,
  ) {
    super(
      `Wallet hash mismatch: ${mismatches.length} difference(s). ` +
        `before=${before} after=${after}`,
    )
    this.name = 'WalletHashMismatchError'
  }
}

export interface WalletHashVerification {
  readonly ok: boolean
  readonly mismatches: ReadonlyArray<{ type: string; path: string }>
  readonly globalSha256Before: string | null
  readonly globalSha256After: string
}

/**
 * Re-hash the current wallet documents and compare to the Stage 0.4 snapshot.
 *
 * Reuses the Stage 0.4 `wallet-snapshot.cjs` collector + manifest builder so
 * the hashing is byte-for-byte identical to the baseline. FAILS CLOSED: any
 * difference throws `WalletHashMismatchError` (non-zero on the process level).
 *
 * Wallet VALUES are never returned or fed into gamification — only hashes.
 */
export async function verifyWalletHashesBeforeAfter(
  db: Firestore,
  baseline: WalletSnapshotManifest | null,
): Promise<WalletHashVerification> {
  assertEmulatorOnly('verifyWalletHashesBeforeAfter')

  const ro = new walletSnap.ReadOnlyFirestore(db)
  const entries = await walletSnap.collectEntries(ro)
  const current = walletSnap.buildManifest(entries, { projectId: null })
  const after = current.globalSha256

  if (!baseline) {
    // No Stage 0.4 baseline exists. We can only prove safety when there are
    // zero wallet documents to protect; otherwise fail closed.
    if (current.totalCount > 0) {
      throw new WalletHashMismatchError(
        [{ type: 'no-baseline', path: '<global>' }],
        null,
        after,
      )
    }
    return { ok: true, mismatches: [], globalSha256Before: null, globalSha256After: after }
  }

  const result = walletSnap.verifyManifest(baseline, entries)
  if (!result.ok) {
    throw new WalletHashMismatchError(result.mismatches, baseline.globalSha256 ?? null, after)
  }
  return {
    ok: true,
    mismatches: [],
    globalSha256Before: baseline.globalSha256 ?? null,
    globalSha256After: after,
  }
}

export interface WriteMigrationMarkerOptions {
  /** Firestore handle (emulator only). */
  readonly db: Firestore
  /** Stage 0.4 wallet snapshot manifest (hashes only). */
  readonly walletBaseline: WalletSnapshotManifest | null
  /** Counts from the Task 5.1 ledger write (for the proof record). */
  readonly eventsWritten: number
  readonly statesWritten: number
  /** Override the migration timestamp (defaults to now, ISO-8601 UTC). */
  readonly migratedAt?: string
}

/**
 * Write the idempotent migration marker for one family.
 *
 * The marker embeds the wallet hash proof (BEFORE == AFTER). It calls
 * `verifyWalletHashesBeforeAfter` first and FAILS CLOSED on any mismatch — the
 * marker is never written when wallet data diverged. The doc id is fixed, so a
 * rerun overwrites the same document (no duplicate marker).
 */
export async function writeMigrationMarker(
  familyId: string,
  reportHash: string,
  opts: WriteMigrationMarkerOptions,
): Promise<MigrationMarkerV4> {
  assertEmulatorOnly('writeMigrationMarker')

  const verification = await verifyWalletHashesBeforeAfter(opts.db, opts.walletBaseline)

  const marker: MigrationMarkerV4 = {
    schemaVersion: GAMIFICATION_V4_SCHEMA_VERSION,
    familyId,
    reportHash,
    status: 'MIGRATED',
    migratedAt: opts.migratedAt ?? new Date().toISOString(),
    eventsWritten: opts.eventsWritten,
    statesWritten: opts.statesWritten,
    walletHashBefore: verification.globalSha256Before,
    walletHashAfter: verification.globalSha256After,
    walletHashOk: verification.ok,
    idempotent: true,
  }

  const ref = opts.db.doc(migrationMarkerDocPath(familyId))
  await ref.set({ ...marker })
  return marker
}

export interface RerunNoOpResult {
  readonly ok: boolean
  /** Deterministic hash of the full ledger + state BEFORE the rerun. */
  readonly ledgerHashBefore: string
  /** Deterministic hash of the full ledger + state AFTER the rerun. */
  readonly ledgerHashAfter: string
}

/** Deterministic SHA-256 over the full ledger + rebuilt state for a report. */
async function hashLedgerState(db: Firestore, report: ProductionReplayReport): Promise<string> {
  const parts: string[] = []
  for (const family of report.families) {
    const ledger = (await readLedger(db, family.familyId)).slice().sort((a, b) =>
      a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0,
    )
    for (const event of ledger) {
      parts.push(walletSnap.canonicalize(event))
    }
    for (const memberId of Object.keys(family.members)) {
      const state = await readState(db, family.familyId, memberId)
      parts.push(
        `${memberId}:${state ? walletSnap.canonicalize(businessFields(state as GamificationStateV4)) : 'null'}`,
      )
    }
  }
  return createHash('sha256').update(parts.join('|'), 'utf8').digest('hex')
}

/**
 * Prove a full migration rerun is a no-op.
 *
 * Captures the ledger + state hash, re-executes `writeMigrationLedger` (Task
 * 5.1, idempotent event ids), and asserts the hash is unchanged. Returns
 * `ok: false` (never throws) so callers can decide; the marker write itself
 * enforces the no-op guarantee via deterministic ids.
 */
export async function rerunIsNoOp(report: ProductionReplayReport, db: Firestore): Promise<RerunNoOpResult> {
  assertEmulatorOnly('rerunIsNoOp')
  const before = await hashLedgerState(db, report)
  await writeMigrationLedger(report, db) // rerun
  const after = await hashLedgerState(db, report)
  return { ok: before === after, ledgerHashBefore: before, ledgerHashAfter: after }
}

// ---------------------------------------------------------------------------
// CLI entry point (emulator only; never contacts production)
// ---------------------------------------------------------------------------

const DEFAULT_REPORT_PATH = resolve(process.cwd(), 'docs/gamification-v4/03-production-replay-report.json')

interface MainArgs {
  readonly reportPath: string
  readonly walletSnapshotPath: string | null
}

function parseArgs(argv: readonly string[]): MainArgs {
  let reportPath = DEFAULT_REPORT_PATH
  let walletSnapshotPath: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--report') {
      const value = argv[i + 1]
      if (!value) throw new Error('--report requires a path argument')
      reportPath = resolve(process.cwd(), value)
      i++
    } else if (arg.startsWith('--report=')) {
      reportPath = resolve(process.cwd(), arg.slice('--report='.length))
    } else if (arg === '--wallet-snapshot') {
      const value = argv[i + 1]
      if (!value) throw new Error('--wallet-snapshot requires a path argument')
      walletSnapshotPath = resolve(process.cwd(), value)
      i++
    } else if (arg.startsWith('--wallet-snapshot=')) {
      walletSnapshotPath = resolve(process.cwd(), arg.slice('--wallet-snapshot='.length))
    }
  }
  return { reportPath, walletSnapshotPath }
}

/** SHA-256 of the approved Gate 1 report (the migration's input fingerprint). */
export function hashReport(report: ProductionReplayReport): string {
  return createHash('sha256').update(JSON.stringify(report), 'utf8').digest('hex')
}

/**
 * CLI: write the approved replay result (Task 5.1) then the idempotent marker
 * (Task 5.2) to the emulator-only V4 collections. Refuses to run unless
 * FIRESTORE_EMULATOR_HOST points at a local address. No application default
 * credentials are ever constructed.
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<MigrationMarkerV4[]> {
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

  const { reportPath, walletSnapshotPath } = parseArgs(argv)
  const report = loadApprovedReport(reportPath)
  const baseline: WalletSnapshotManifest | null = walletSnapshotPath
    ? (JSON.parse(readFileSync(walletSnapshotPath, 'utf8')) as WalletSnapshotManifest)
    : null

  const ledgerResult: WriteMigrationLedgerResult = await writeMigrationLedger(report, db)
  const reportHash = hashReport(report)

  const markers: MigrationMarkerV4[] = []
  for (const family of report.families) {
    const marker = await writeMigrationMarker(family.familyId, reportHash, {
      db,
      walletBaseline: baseline,
      eventsWritten: ledgerResult.eventsWritten,
      statesWritten: ledgerResult.statesWritten,
    })
    markers.push(marker)
    // eslint-disable-next-line no-console
    console.log(
      `migration-marker: family=${family.familyId} status=${marker.status} ` +
        `walletHashOk=${marker.walletHashOk} before=${marker.walletHashBefore} after=${marker.walletHashAfter}`,
    )
  }
  return markers
}

// Run only when invoked directly (tsx / node), never on import (keeps tests pure).
const invokedDirectly = process.argv[1] && /migration-marker(\.[jt]s)?$/.test(process.argv[1])
if (invokedDirectly) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`migration-marker failed: ${(err as Error).message}`)
    process.exit(1)
  })
}
