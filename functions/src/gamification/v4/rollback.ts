/**
 * Gamification V4 — instant rollback mechanism (Stage 7, audit R1).
 *
 * The audit (docs/gamification-v4/07-cutover-readiness-audit.md, R1) found that
 * Stage 7 had NO rollback path: there was no flag to flip back, and the
 * highest-risk writers (5–7) live in the deployed SPA, so rollback would have
 * required a hosting re-deploy rather than a config change.
 *
 * This module provides the instant, config-only rollback that fixes R1:
 *
 *   `rollbackStage7`  — flips the family's cutover config to `rolled_back` and
 *                       resets EVERY writer flag to legacy in a SINGLE document
 *                       write. No hosting redeploy, no code change. This is the
 *                       "instant" mechanism: cutover is a flag, so rollback is
 *                       a flag flip.
 *   `purgeV4FamilyData` — deletes the V4 ledger / state / marker for a family
 *                       (the data-level rollback; emulator only, never prod).
 *   `recordRollbackEvent` — appends an immutable audit record of the rollback.
 *
 * Hard constraints (audit R1 / "no production writes"):
 *  - Emulator only: every function calls `assertEmulatorOnly`, so rollback can
 *    NEVER target production Firestore.
 *  - Not referenced by `functions/src/index.ts` (pinned by the architecture
 *    boundary test): test/tooling-only, never a deployed write path.
 *  - Does NOT modify any legacy writer; it only mutates the dedicated V4
 *    cutover config + V4 collections (which are emulator-only by construction).
 */

import type { Firestore } from 'firebase-admin/firestore'

import { assertEmulatorOnly } from './repository'
import {
  readCutoverConfig,
  rollbackCutover,
  writeCutoverConfig,
  type CutoverConfig,
} from './cutoverConfig'
import {
  EVENTS_V4_COLLECTION_ID,
  FAMILIES_COLLECTION_ID,
  STATE_V4_COLLECTION_ID,
} from '../../../../src/domain/gamification/v4/storage'

// Local copy of the migration-marker document path. Defined here (rather than
// imported from scripts/migrate/migration-marker.ts) so this module stays inside
// the functions TypeScript build graph and never pulls the tsx-only scripts/ tree
// into `tsc -b`. The path is part of the stable V4 contract (docs/gamification-v4-design.md).
const MIGRATION_MARKER_COLLECTION = 'gamification_migration_marker'
const MIGRATION_MARKER_DOC_ID = 'marker'
function migrationMarkerDocPathFor(familyId: string): string {
  return `families/${familyId}/${MIGRATION_MARKER_COLLECTION}/${MIGRATION_MARKER_DOC_ID}`
}

/** Audit record written on every rollback (immutable, append-only). */
export interface RollbackAuditEvent {
  readonly schemaVersion: number
  readonly familyId: string
  readonly reason: string
  readonly rolledBackBy: string | null
  readonly rolledBackAt: string
  readonly previousStatus: string
}

/** `families/{familyId}/gamification_rollback_audit/{id}` */
export function rollbackAuditDocPath(familyId: string, id: string): string {
  return `families/${familyId}/gamification_rollback_audit/${id}`
}

/**
 * Instant rollback: flip the family's cutover config back to legacy in a single
 * write. Returns the persisted (rolled-back) config. Emulator only.
 */
export async function rollbackStage7(
  db: Firestore,
  familyId: string,
  reason: string,
  opts: { by?: string; at?: string } = {},
): Promise<CutoverConfig> {
  assertEmulatorOnly('rollbackStage7')
  const current = await readCutoverConfig(db, familyId)
  const next = rollbackCutover(current, { reason, by: opts.by, at: opts.at })
  await writeCutoverConfig(db, familyId, next)
  const at = opts.at ?? next.rolledBackAt ?? new Date().toISOString()
  await recordRollbackEvent(db, familyId, {
    reason,
    rolledBackBy: opts.by ?? null,
    at,
    previousStatus: current.status,
    rolledBackAt: next.rolledBackAt ?? at,
  })
  return next
}

/** Counts returned by the data-level purge. */
export interface PurgeResult {
  readonly eventsDeleted: number
  readonly statesDeleted: number
  readonly markerDeleted: boolean
}

/**
 * Data-level rollback: delete the V4 ledger, state and migration marker for a
 * family. Emulator only. Returns the counts deleted. This is the deeper
 * rollback used when a family is fully reverted off V4; the instant config
 * flip (`rollbackStage7`) is normally sufficient to stop V4 writes.
 */
export async function purgeV4FamilyData(db: Firestore, familyId: string): Promise<PurgeResult> {
  assertEmulatorOnly('purgeV4FamilyData')
  const base = `${FAMILIES_COLLECTION_ID}/${familyId}`

  const eventsSnap = await db.collection(`${base}/${EVENTS_V4_COLLECTION_ID}`).get()
  let eventsDeleted = 0
  for (const d of eventsSnap.docs) {
    await d.ref.delete()
    eventsDeleted += 1
  }

  const stateSnap = await db.collection(`${base}/${STATE_V4_COLLECTION_ID}`).get()
  let statesDeleted = 0
  for (const d of stateSnap.docs) {
    await d.ref.delete()
    statesDeleted += 1
  }

  const markerRef = db.doc(migrationMarkerDocPathFor(familyId))
  const markerSnap = await markerRef.get()
  let markerDeleted = false
  if (markerSnap.exists) {
    await markerRef.delete()
    markerDeleted = true
  }

  return { eventsDeleted, statesDeleted, markerDeleted }
}

/** Append an immutable rollback audit event. Emulator only. */
export async function recordRollbackEvent(
  db: Firestore,
  familyId: string,
  event: { reason: string; previousStatus: string; at: string; rolledBackAt?: string; rolledBackBy?: string | null },
): Promise<RollbackAuditEvent> {
  assertEmulatorOnly('recordRollbackEvent')
  const record: RollbackAuditEvent = {
    schemaVersion: 4,
    familyId,
    reason: event.reason,
    rolledBackBy: event.rolledBackBy ?? null,
    rolledBackAt: event.rolledBackAt ?? event.at,
    previousStatus: event.previousStatus,
  }
  const id = `rb-${record.rolledBackAt.replace(/[:.]/g, '-')}`
  await db.doc(rollbackAuditDocPath(familyId, id)).set({ ...record })
  return record
}
