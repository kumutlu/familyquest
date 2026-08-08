/**
 * Gamification V4 — Task 7.1 Stage 7 EVIDENCE PROVIDER (READ ONLY).
 *
 * This is the missing piece that let `index.ts` pass `evidence: null`. It loads
 * and validates, for ONE family and ONE writer, the two persisted proofs the
 * Stage 7 gate chain consumes:
 *
 *   Gate 1 — the exact owner-approved replay artifact produced in Stage 3
 *            (`docs/gamification-v4/03-production-replay-report.json`,
 *             gate `GATE_1_REACHED`). The artifact is hash-verified
 *            (`hashGate1Report`, identical to `scripts/migrate/migration-marker.hashReport`)
 *            and the family must be present AND classified in it.
 *
 *   Gate 2 — `families/{familyId}/gamification_migration_marker/marker`
 *            (Task 5.2). It must be `status: MIGRATED`, `walletHashOk: true`,
 *            `walletHashBefore === walletHashAfter`, and its `reportHash` must
 *            equal the Gate 1 artifact hash (marker/report binding).
 *
 *   Stage 6 — NOT implemented here. The existing `verifyPreCutover()` remains
 *            the single implementation; it is injected into the verifier.
 *
 * Hard properties:
 *  - READS ONLY: no `set`/`update`/`delete`, no transaction, no production data
 *    written. Exactly one Firestore document read (the marker).
 *  - Fail closed: every missing/invalid/stale/mismatched artifact THROWS
 *    `Stage7EvidenceInvalidError`, so the verifier refuses and ZERO writers run
 *    (there is no fallback to the legacy writer once the v4 route is resolved).
 *  - Trusted server reads only: uses the caller-provided Admin `Firestore`
 *    handle (the entry point's `initializeApp()` handle). No client import path,
 *    no `applicationDefault()`, no embedded secrets.
 *  - Family + writer + freshness binding is enforced here AND again in
 *    `createStage7WriterVerifier` (defence in depth).
 */

import { createHash } from 'node:crypto'
import type { Firestore } from 'firebase-admin/firestore'

import type { Stage7MigrationMarker } from './stage7Gate'
import type { Stage7ApprovedEvidence } from './stage7Verifier'
import { DEFAULT_MAX_EVIDENCE_AGE_MS } from './stage7Verifier'
import type { GamificationWriter } from '../../../../src/domain/gamification/v4/featureFlags'

/** The ONLY writer Task 7.1 pilot activation may provision evidence for. */
export const TASK_7_1_WRITER: GamificationWriter = 'task_approval'

/** Marker document path (stable V4 contract; local copy keeps scripts/ out of the build graph). */
export function migrationMarkerDocPathFor(familyId: string): string {
  return `families/${familyId}/gamification_migration_marker/marker`
}

/** Thrown when the persisted Stage 7 evidence is missing, invalid or stale. */
export class Stage7EvidenceInvalidError extends Error {
  constructor(familyId: string, reason: string) {
    super(`Stage 7 evidence invalid for family ${familyId}: ${reason}`)
    this.name = 'Stage7EvidenceInvalidError'
  }
}

/** Minimal structural view of one family entry in the Gate 1 replay report. */
export interface Gate1FamilyEntry {
  readonly familyId: string
  readonly classification?: string
}

/** Minimal structural view of the Stage 3 / Gate 1 replay report artifact. */
export interface Gate1Report {
  readonly gate: string
  readonly schemaVersion?: number
  readonly families: ReadonlyArray<Gate1FamilyEntry>
}

/** The approved Gate 1 artifact as provisioned to the runtime (read-only input). */
export interface Gate1Artifact {
  readonly report: Gate1Report
  /** SHA-256 of the report, as recorded at approval time. */
  readonly reportHash: string
  /** Approval instant (ISO-8601 string or epoch ms). */
  readonly approvedAt: string | number
  readonly approvedBy?: string | null
}

/** The Task 5.2 marker document, including the fields Gate 2 binds on. */
export interface Stage7MarkerDoc extends Stage7MigrationMarker {
  readonly status: string
  readonly reportHash: string
}

export type LoadGate1ArtifactFn = (familyId: string) => Promise<Gate1Artifact | null>
export type ReadStage7MarkerFn = (db: Firestore, familyId: string) => Promise<Stage7MarkerDoc | null>

export interface Stage7EvidenceProviderDeps {
  readonly db: Firestore
  /** The writer being activated (Task 7.1 = `task_approval`). */
  readonly writer: GamificationWriter
  /** Loader for the approved Gate 1 artifact. Returning `null` blocks. */
  readonly loadGate1Artifact: LoadGate1ArtifactFn
  /** Marker reader override (defaults to the read-only Firestore read below). */
  readonly readMarker?: ReadStage7MarkerFn
  readonly maxEvidenceAgeMs?: number
  readonly now?: () => number
}

/**
 * SHA-256 of the Gate 1 report — byte-identical to
 * `scripts/migrate/migration-marker.hashReport`, which is what Task 5.2 stamped
 * into the marker's `reportHash`.
 */
export function hashGate1Report(report: Gate1Report): string {
  return createHash('sha256').update(JSON.stringify(report), 'utf8').digest('hex')
}

/** READ-ONLY marker read via the trusted server Admin handle. */
export const readStage7MigrationMarker: ReadStage7MarkerFn = async (db, familyId) => {
  const snap = await db.doc(migrationMarkerDocPathFor(familyId)).get()
  return snap.exists ? (snap.data() as Stage7MarkerDoc) : null
}

function approvedAtMs(value: string | number): number {
  return typeof value === 'number' ? value : Date.parse(value)
}

/**
 * Build the READ-ONLY Stage 7 evidence provider for ONE writer.
 *
 * The returned function resolves with verifier-ready evidence only when Gate 1
 * and Gate 2 are both provable for the family; otherwise it throws.
 */
export function createStage7EvidenceProvider(
  deps: Stage7EvidenceProviderDeps,
): (familyId: string) => Promise<Stage7ApprovedEvidence> {
  const now = deps.now ?? (() => Date.now())
  const maxAge = deps.maxEvidenceAgeMs ?? DEFAULT_MAX_EVIDENCE_AGE_MS
  const readMarker = deps.readMarker ?? readStage7MigrationMarker

  return async (familyId: string): Promise<Stage7ApprovedEvidence> => {
    const block = (reason: string): never => {
      throw new Stage7EvidenceInvalidError(familyId, reason)
    }

    // --- writer binding -----------------------------------------------------
    if (deps.writer !== TASK_7_1_WRITER) {
      block(`evidence provisioning is limited to writer ${TASK_7_1_WRITER}, not ${deps.writer}`)
    }
    if (!familyId) block('no familyId supplied')

    // --- Gate 1: approved replay artifact ----------------------------------
    const artifact = await deps.loadGate1Artifact(familyId)
    if (!artifact) block('no approved Gate 1 replay artifact is provisioned')
    const gate1 = artifact as Gate1Artifact

    if (gate1.report?.gate !== 'GATE_1_REACHED') {
      block(`Gate 1 artifact gate=${String(gate1.report?.gate)}; expected GATE_1_REACHED`)
    }
    const computed = hashGate1Report(gate1.report)
    if (computed !== gate1.reportHash) {
      block(`Gate 1 report hash mismatch (recorded=${gate1.reportHash} computed=${computed})`)
    }
    const entry = (gate1.report.families ?? []).find((f) => f.familyId === familyId)
    if (!entry) block('family is not present in the approved Gate 1 report')
    if (!entry?.classification) block('family is present but NOT classified in the approved Gate 1 report')

    // --- freshness ----------------------------------------------------------
    const approvedAt = approvedAtMs(gate1.approvedAt)
    const age = now() - approvedAt
    if (!Number.isFinite(approvedAt) || !Number.isFinite(age) || age < 0 || age > maxAge) {
      block(`Gate 1 approval is stale or invalid (approvedAt=${String(gate1.approvedAt)}, age=${age}ms, max=${maxAge}ms)`)
    }

    // --- Gate 2: Task 5.2 migration marker ---------------------------------
    const marker = await readMarker(deps.db, familyId)
    if (!marker) block(`migration marker absent at ${migrationMarkerDocPathFor(familyId)}`)
    const m = marker as Stage7MarkerDoc

    if (m.familyId !== familyId) block(`marker is scoped to family ${m.familyId}, not ${familyId}`)
    if (m.status !== 'MIGRATED') block(`marker status=${m.status}; expected MIGRATED`)
    if (m.walletHashOk !== true) block('marker walletHashOk is not true')
    if (m.walletHashBefore === null || m.walletHashBefore !== m.walletHashAfter) {
      block(`marker wallet hash BEFORE != AFTER (before=${m.walletHashBefore} after=${m.walletHashAfter})`)
    }
    if (m.reportHash !== gate1.reportHash) {
      block(`marker reportHash=${m.reportHash} does not match the approved Gate 1 hash ${gate1.reportHash}`)
    }

    // Stage 6 is intentionally NOT evaluated here: `verifyPreCutover()` remains
    // the single implementation and is injected into the verifier.
    return {
      familyId,
      writer: TASK_7_1_WRITER,
      report: { gate: gate1.report.gate },
      approvedAt,
      marker: {
        familyId: m.familyId,
        walletHashOk: m.walletHashOk,
        walletHashBefore: m.walletHashBefore,
        walletHashAfter: m.walletHashAfter,
      },
    }
  }
}
