/**
 * Gamification V4 — Task 6.1 pre-cutover verification gate.
 *
 * Fail-closed gate that MUST pass before production cutover. It reuses (never
 * duplicates) the Stage 4 server repository + rebuild helpers, the Gate 1
 * replay report artifact, and the Task 5.2 migration marker / wallet-hash
 * verification.
 *
 * `verifyPreCutover(familyId, deps)` returns a DETERMINISTIC report. It FAILS
 * CLOSED unless ALL six checks pass:
 *
 *   1. V4 stored state == rebuildStateFromLedger(full ledger)
 *   2. every member is classified / accounted for
 *   3. no unexplained malformed / ambiguous records
 *   4. wallet hash BEFORE == AFTER (from the Task 5.2 migration marker)
 *   5. no cross-family contamination
 *   6. duplicate migration run is a no-op
 *
 * Hard constraints (plan Task 6.1):
 *  - Emulator only: every read/write is gated behind `assertEmulatorOnly`.
 *  - No second verification arithmetic path: check 1 reuses the canonical
 *    `rebuildStateFromLedger` + `businessFields`; check 6 reuses Task 5.2
 *    `rerunIsNoOp`. No shadow reducer, no duplicate comparison logic.
 *  - Deterministic report output: checks are emitted in a fixed order and the
 *    timestamp is derived from the marker's `migratedAt` (never the wall clock).
 *  - Reports every failing check explicitly (never a bare boolean).
 *  - Empty / missing migration marker => FAIL. Wallet hash mismatch => FAIL.
 *    Missing member state => FAIL. Extra cross-family event/state => FAIL.
 *    Ledger/state divergence => FAIL. Unexplained source => FAIL.
 *
 * See docs/superpowers/plans/2026-08-05-gamification-v4-rewrite.md Task 6.1.
 */

import type { Firestore } from 'firebase-admin/firestore'

import {
  assertEmulatorOnly,
  readLedger,
  readState,
} from '../../functions/src/gamification/v4/repository'
import { rebuildStateFromLedger, type ReduceContextV4 } from '../../src/domain/gamification/v4/rebuild'
import { businessFields } from '../../src/domain/gamification/v4/types'
import { assertValidEventV4 } from '../../src/domain/gamification/v4/validators'
import {
  FAMILIES_COLLECTION_ID,
  STATE_V4_COLLECTION_ID,
} from '../../src/domain/gamification/v4/storage'
import {
  migrationMarkerDocPath,
  rerunIsNoOp,
  type MigrationMarkerV4,
} from '../migrate/migration-marker'
import { buildMigrationBaselineEvent } from '../migrate/write-v4-ledger'
import type { ProductionReplayReport, ProductionFamilyReport } from '../replay/production-report'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Dependencies injected into the gate (keeps the signature testable). */
export interface PreCutoverDeps {
  /** Firestore handle (emulator only). */
  readonly db: Firestore
  /** Approved Gate 1 replay report artifact (GATE_1_REACHED). */
  readonly report: ProductionReplayReport
  /**
   * Optional pre-read Task 5.2 migration marker. When omitted it is read from
   * the emulator; an absent document is reported as a FAIL (never throws).
   */
  readonly marker?: MigrationMarkerV4 | null
  /**
   * Phase 3 (B3): STRICT READ-ONLY mode for production verification.
   *
   * When true, check 6 uses the non-mutating duplicate-migration proof
   * (`duplicateMigrationWouldBeNoOp`) instead of the Task 5.2 `rerunIsNoOp`,
   * which re-executes the writer. Everything else is unchanged, so there is
   * still exactly ONE rebuild/reducer implementation.
   */
  readonly readOnly?: boolean
}

/** One named, explicit check result. */
export interface PreCutoverCheck {
  readonly name: string
  readonly passed: boolean
  readonly detail: string
}

/** Deterministic pre-cutover verification report (fail closed). */
export interface PreCutoverReport {
  readonly familyId: string
  /** True only when EVERY check passed. Fail closed. */
  readonly passed: boolean
  /** Deterministic timestamp derived from the marker's `migratedAt`. */
  readonly generatedAt: string
  /** The six checks, always in the same order. */
  readonly checks: ReadonlyArray<PreCutoverCheck>
  readonly markerPresent: boolean
  readonly walletHashOk: boolean | null
}

// ---------------------------------------------------------------------------
// Marker read (Task 5.2 artifact)
// ---------------------------------------------------------------------------

/** Read the idempotent Task 5.2 migration marker for a family (or null). */
export async function readMigrationMarker(
  db: Firestore,
  familyId: string,
): Promise<MigrationMarkerV4 | null> {
  assertEmulatorOnly('readMigrationMarker', { familyId })
  const snap = await db.doc(migrationMarkerDocPath(familyId)).get()
  return snap.exists ? (snap.data() as MigrationMarkerV4) : null
}

/** Enumerate every V4 state document id for a family (canonical path). */
async function readAllStateMemberIds(db: Firestore, familyId: string): Promise<string[]> {
  assertEmulatorOnly('readAllStateMemberIds', { familyId })
  const snap = await db
    .collection(FAMILIES_COLLECTION_ID)
    .doc(familyId)
    .collection(STATE_V4_COLLECTION_ID)
    .get()
  return snap.docs.map((d) => d.id)
}

// ---------------------------------------------------------------------------
// Check helpers
// ---------------------------------------------------------------------------

function pass(name: string, detail: string): PreCutoverCheck {
  return { name, passed: true, detail }
}
function fail(name: string, detail: string): PreCutoverCheck {
  return { name, passed: false, detail }
}

// ---------------------------------------------------------------------------
// The six checks (each reuses canonical helpers; no second arithmetic path)
// ---------------------------------------------------------------------------

/** Check 1: V4 stored state == rebuildStateFromLedger(full ledger). */
async function checkLedgerStateEquality(
  familyId: string,
  db: Firestore,
  family: ProductionFamilyReport | null,
  report: ProductionReplayReport,
): Promise<PreCutoverCheck> {
  if (!family) return fail('ledgerStateEquality', `family ${familyId} not present in Gate 1 report`)
  const ledger = await readLedger(db, familyId)
  const ctx: ReduceContextV4 = { updatedAt: report.generatedAt, projectionVersion: 1 }
  const failures: string[] = []
  for (const memberId of Object.keys(family.members)) {
    const state = await readState(db, familyId, memberId)
    if (!state) {
      failures.push(`member ${memberId}: missing V4 state`)
      continue
    }
    const memberLedger = ledger.filter((e) => e.memberId === memberId)
    let rebuilt
    try {
      rebuilt = rebuildStateFromLedger(memberLedger, ctx)
    } catch (err) {
      failures.push(`member ${memberId}: rebuild failed (${(err as Error).message})`)
      continue
    }
    if (JSON.stringify(businessFields(state)) !== JSON.stringify(businessFields(rebuilt))) {
      failures.push(`member ${memberId}: stored state diverges from rebuild`)
    }
  }
  return failures.length === 0
    ? pass('ledgerStateEquality', `stored state == rebuildStateFromLedger for ${Object.keys(family.members).length} member(s)`)
    : fail('ledgerStateEquality', failures.join('; '))
}

/** Check 2: every member is classified / accounted for. */
async function checkMembersAccounted(
  familyId: string,
  db: Firestore,
  family: ProductionFamilyReport | null,
  report: ProductionReplayReport,
): Promise<PreCutoverCheck> {
  if (!family) return fail('membersAccounted', `family ${familyId} not present in Gate 1 report`)
  const ledger = await readLedger(db, familyId)
  const stateMembers = await readAllStateMemberIds(db, familyId)
  const reportMembers = new Set(Object.keys(family.members))
  const ledgerMembers = new Set(ledger.map((e) => e.memberId))
  const stateSet = new Set(stateMembers)
  const failures: string[] = []
  for (const m of reportMembers) {
    if (!ledgerMembers.has(m)) failures.push(`member ${m}: no ledger event (unaccounted)`)
    if (!stateSet.has(m)) failures.push(`member ${m}: missing V4 state (not accounted)`)
  }
  for (const m of ledgerMembers) {
    if (!reportMembers.has(m)) failures.push(`member ${m}: in ledger but not in Gate 1 report (unclassified)`)
  }
  for (const m of stateSet) {
    if (!reportMembers.has(m)) failures.push(`member ${m}: V4 state present but not in Gate 1 report (unaccounted)`)
  }
  return failures.length === 0
    ? pass('membersAccounted', `${reportMembers.size} member(s) classified and accounted for`)
    : fail('membersAccounted', failures.join('; '))
}

/** Check 3: no unexplained malformed / ambiguous records. */
async function checkNoMalformedAmbiguous(
  familyId: string,
  db: Firestore,
  family: ProductionFamilyReport | null,
  report: ProductionReplayReport,
): Promise<PreCutoverCheck> {
  const counts = report.counts ?? { exact: 0, estimated: 0, malformed: 0, ambiguous: 0, skipped: 0 }
  const failures: string[] = []
  if (counts.malformed > 0) failures.push(`Gate 1 report has ${counts.malformed} malformed source(s) (unexplained)`)
  if (counts.ambiguous > 0) failures.push(`Gate 1 report has ${counts.ambiguous} ambiguous source(s) (unexplained)`)
  if (family?.error) failures.push(`family ${familyId} replay errored: ${family.error}`)
  const ledger = await readLedger(db, familyId)
  for (const event of ledger) {
    try {
      assertValidEventV4(event)
    } catch (err) {
      failures.push(`event ${event.eventId}: ${(err as Error).message}`)
    }
  }
  return failures.length === 0
    ? pass('noMalformedAmbiguous', `no malformed/ambiguous records (${ledger.length} ledger event(s) valid)`)
    : fail('noMalformedAmbiguous', failures.join('; '))
}

/** Check 4: wallet hash BEFORE == AFTER (Task 5.2 marker). */
function checkWalletHashEquality(familyId: string, marker: MigrationMarkerV4 | null): PreCutoverCheck {
  if (!marker) return fail('walletHashEquality', `migration marker missing for family ${familyId}`)
  if (marker.familyId !== familyId) {
    return fail('walletHashEquality', `marker familyId ${marker.familyId} != ${familyId}`)
  }
  if (!marker.walletHashOk) {
    return fail(
      'walletHashEquality',
      `wallet hash BEFORE != AFTER (before=${marker.walletHashBefore} after=${marker.walletHashAfter})`,
    )
  }
  return pass('walletHashEquality', `wallet hash BEFORE == AFTER (${marker.walletHashBefore})`)
}

/** Check 5: no cross-family contamination. */
async function checkNoCrossFamily(
  familyId: string,
  db: Firestore,
  family: ProductionFamilyReport | null,
  report: ProductionReplayReport,
): Promise<PreCutoverCheck> {
  const ledger = await readLedger(db, familyId)
  const stateMembers = await readAllStateMemberIds(db, familyId)
  const reportMembers = new Set(family ? Object.keys(family.members) : [])
  const failures: string[] = []
  for (const event of ledger) {
    if (event.familyId !== familyId) {
      failures.push(`event ${event.eventId}: cross-family (familyId=${event.familyId})`)
    }
  }
  for (const m of stateMembers) {
    if (!reportMembers.has(m)) failures.push(`member ${m}: extra cross-family state`)
  }
  return failures.length === 0
    ? pass('noCrossFamily', `no cross-family contamination (${ledger.length} event(s), ${stateMembers.length} state(s))`)
    : fail('noCrossFamily', failures.join('; '))
}

/**
 * Check 6 (READ-ONLY variant): prove a duplicate migration would be a no-op
 * WITHOUT writing anything.
 *
 * Reuses the single Stage 5 event builder (`buildMigrationBaselineEvent`), so
 * there is no duplicated migration semantics: for every member the event a
 * rerun WOULD write is reconstructed and compared byte-wise (canonical JSON)
 * with the event already stored under the same deterministic id.
 */
async function checkDuplicateNoOpReadOnly(
  familyId: string,
  db: Firestore,
  family: ProductionFamilyReport | null,
  report: ProductionReplayReport,
  marker: MigrationMarkerV4 | null,
): Promise<PreCutoverCheck> {
  if (!marker) return fail('duplicateMigrationNoOp', 'migration marker missing; cannot verify no-op')
  if (!family) return fail('duplicateMigrationNoOp', `family ${familyId} absent from the approved report`)

  const ledger = await readLedger(db, familyId)
  const byId = new Map(ledger.map((e) => [e.eventId, e]))
  const failures: string[] = []

  for (const [memberId, member] of Object.entries(family.members)) {
    const expected = buildMigrationBaselineEvent(familyId, memberId, member.replayed, report.generatedAt)
    const stored = byId.get(expected.eventId)
    if (!stored) {
      failures.push(`member ${memberId}: baseline event ${expected.eventId} missing`)
      continue
    }
    if (JSON.stringify(stored) !== JSON.stringify({ ...stored, ...expected })) {
      failures.push(`member ${memberId}: a rerun would change event ${expected.eventId}`)
    }
    const duplicates = ledger.filter((e) => e.eventId === expected.eventId).length
    if (duplicates !== 1) {
      failures.push(`member ${memberId}: ${duplicates} copies of ${expected.eventId} (expected exactly 1)`)
    }
  }

  return failures.length === 0
    ? pass('duplicateMigrationNoOp', 'a duplicate migration would be a no-op (proved read-only)')
    : fail('duplicateMigrationNoOp', failures.join('; '))
}

/** Check 6: duplicate migration run is a no-op (reuses Task 5.2 proof). */
async function checkDuplicateNoOp(
  db: Firestore,
  report: ProductionReplayReport,
  marker: MigrationMarkerV4 | null,
): Promise<PreCutoverCheck> {
  if (!marker) return fail('duplicateMigrationNoOp', 'migration marker missing; cannot verify no-op')
  try {
    const result = await rerunIsNoOp(report, db)
    return result.ok
      ? pass('duplicateMigrationNoOp', `rerun is a no-op (ledger+state hash unchanged)`)
      : fail(
          'duplicateMigrationNoOp',
          `rerun changed state (before=${result.ledgerHashBefore} after=${result.ledgerHashAfter})`,
        )
  } catch (err) {
    return fail('duplicateMigrationNoOp', `rerun threw: ${(err as Error).message}`)
  }
}

// ---------------------------------------------------------------------------
// Gate entry point
// ---------------------------------------------------------------------------

/**
 * Verify a family is safe to cut over to V4. FAILS CLOSED: returns a report
 * whose `passed` is false unless ALL six checks pass. Never throws for a
 * failing check (so every failure is reported explicitly); only unexpected
 * internal errors propagate.
 */
export async function verifyPreCutover(familyId: string, deps: PreCutoverDeps): Promise<PreCutoverReport> {
  assertEmulatorOnly('verifyPreCutover', { familyId })
  const { db, report } = deps

  const family = report.families.find((f) => f.familyId === familyId) ?? null
  const marker = deps.marker !== undefined ? deps.marker : await readMigrationMarker(db, familyId)

  const checks: PreCutoverCheck[] = [
    await checkLedgerStateEquality(familyId, db, family, report), // 1
    await checkMembersAccounted(familyId, db, family, report), // 2
    await checkNoMalformedAmbiguous(familyId, db, family, report), // 3
    checkWalletHashEquality(familyId, marker), // 4
    await checkNoCrossFamily(familyId, db, family, report), // 5
    deps.readOnly === true
      ? await checkDuplicateNoOpReadOnly(familyId, db, family, report, marker) // 6 (read-only)
      : await checkDuplicateNoOp(db, report, marker), // 6
  ]

  const passed = checks.every((c) => c.passed)
  const generatedAt = marker?.migratedAt ?? report.generatedAt
  return {
    familyId,
    passed,
    generatedAt,
    checks,
    markerPresent: marker !== null && marker !== undefined,
    walletHashOk: marker ? marker.walletHashOk : null,
  }
}
