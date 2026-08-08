/**
 * Gamification V4 — the REAL Stage 7 verifier for Task 7.1 (production wiring).
 *
 * This module replaces the fail-closed placeholder `denyStage7ByDefault` in the
 * deployed entry point. It does NOT activate anything: it is a READ-ONLY
 * evidence gatherer that delegates the whole decision to the existing gate
 * chain, so there is exactly ONE place where Stage 7 readiness is decided:
 *
 *   createStage7WriterVerifier(deps)(familyId)
 *     -> evidence sanity (family / writer / freshness)   [local, read-only]
 *     -> assertWriterCutoverAllowed(gateDeps, writer)     [stage7Gate.ts]
 *          -> assertStage7Allowed
 *               -> checkStage7Allowed
 *                    -> Gate 1: approved replay report (GATE_1_REACHED)
 *                    -> Gate 2: Task 5.2 migration marker + wallet hash equality
 *                    -> Stage 6: injected verifyPreCutover six-check report
 *          -> runtime cutover config is ACTIVE for the family
 *          -> the per-writer feature flag is enabled (per-writer kill switch)
 *
 * Hard properties:
 *  - Fail closed: every unmet precondition THROWS, so the adapter runs ZERO
 *    writers and the legacy writer is never used as a silent fallback.
 *  - Read-only: no document is created or updated during verification.
 *  - Emulator kill-switch: the gate chain calls `assertEmulatorOnly`, so in the
 *    deployed (non-emulator) runtime verification refuses before any read.
 *  - No dual write, no legacy behaviour change: this module never writes.
 */

import type { Firestore } from 'firebase-admin/firestore'

import {
  assertWriterCutoverAllowed,
  type ReadMigrationMarkerFn,
  type Stage7GateDeps,
  type Stage7MigrationMarker,
  type Stage7PreCutoverReport,
  type Stage7ReplayReport,
  type VerifyPreCutoverFn,
} from './stage7Gate'
import type { GamificationWriter } from '../../../../src/domain/gamification/v4/featureFlags'

/** Default maximum age of the approved Gate 1 evidence artifact: 30 days. */
export const DEFAULT_MAX_EVIDENCE_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** Thrown when no Stage 7 evidence provider has been provisioned. */
export class Stage7EvidenceUnavailableError extends Error {
  constructor(familyId: string) {
    super(
      `Stage 7 evidence provider is not provisioned: refusing a V4 task-approval ` +
        `write for family ${familyId}. Task 7.1 activation requires wiring an ` +
        `approved Gate 1 replay report + Task 5.2 migration marker into ` +
        `assertWriterCutoverAllowed.`,
    )
    this.name = 'Stage7EvidenceUnavailableError'
  }
}

/** Thrown when the provisioned evidence does not apply to this call. */
export class Stage7EvidenceRefusedError extends Error {
  constructor(reason: string) {
    super(`Stage 7 evidence refused: ${reason}`)
    this.name = 'Stage7EvidenceRefusedError'
  }
}

/** The owner-approved, family-scoped, writer-scoped Gate 1 evidence artifact. */
export interface Stage7ApprovedEvidence {
  /** The ONLY family this evidence authorises. */
  readonly familyId: string
  /** The ONLY writer this evidence authorises. */
  readonly writer: GamificationWriter
  /** Gate 1 approved replay report (must be `GATE_1_REACHED`). */
  readonly report: Stage7ReplayReport
  /** Epoch ms at which the evidence was approved (freshness input). */
  readonly approvedAt: number
  /** Optional pre-read Task 5.2 marker (else `readMigrationMarkerFn` is used). */
  readonly marker?: Stage7MigrationMarker | null
}

export interface Stage7WriterVerifierDeps {
  readonly db: Firestore
  /** The writer being verified (Task 7.1 = `task_approval`). */
  readonly writer: GamificationWriter
  /** Provisioned evidence; `null`/absent => fail closed. */
  readonly evidence?: Stage7ApprovedEvidence | null
  /** Stage 6 verification. Absent => Stage 6 reported as FAILED (fail closed). */
  readonly verifyPreCutoverFn?: VerifyPreCutoverFn
  /** Task 5.2 marker reader. */
  readonly readMigrationMarkerFn?: ReadMigrationMarkerFn
  readonly maxEvidenceAgeMs?: number
  readonly now?: () => number
}

/**
 * Stage 6 fallback: when no verification function is provisioned we must NOT
 * treat Stage 6 as green. Report it as failed so the gate blocks.
 */
const stage6NotProvisioned: VerifyPreCutoverFn = async (): Promise<Stage7PreCutoverReport> => ({
  passed: false,
  checks: [
    {
      name: 'verify_pre_cutover_provisioned',
      passed: false,
      detail: 'Stage 6 verifyPreCutover was not provisioned for this runtime',
    },
  ],
})

/**
 * Build the production Stage 7 verifier for ONE writer.
 *
 * Constructing it performs NO I/O. The returned function resolves only when the
 * full gate chain is green for the given family; otherwise it throws.
 */
export function createStage7WriterVerifier(
  deps: Stage7WriterVerifierDeps,
): (familyId: string) => Promise<void> {
  const now = deps.now ?? (() => Date.now())
  const maxAge = deps.maxEvidenceAgeMs ?? DEFAULT_MAX_EVIDENCE_AGE_MS

  return async (familyId: string): Promise<void> => {
    const evidence = deps.evidence ?? null
    if (!evidence) throw new Stage7EvidenceUnavailableError(familyId)

    if (evidence.familyId !== familyId) {
      throw new Stage7EvidenceRefusedError(
        `evidence is scoped to family ${evidence.familyId}, not ${familyId}`,
      )
    }
    if (evidence.writer !== deps.writer) {
      throw new Stage7EvidenceRefusedError(
        `evidence is scoped to writer ${evidence.writer}, not ${deps.writer}`,
      )
    }
    const age = now() - evidence.approvedAt
    if (!Number.isFinite(age) || age < 0 || age > maxAge) {
      throw new Stage7EvidenceRefusedError(
        `evidence approvedAt=${evidence.approvedAt} is stale or invalid (age=${age}ms, max=${maxAge}ms)`,
      )
    }

    const gateDeps: Stage7GateDeps = {
      db: deps.db,
      familyId,
      report: evidence.report,
      marker: evidence.marker ?? null,
      verifyPreCutoverFn: deps.verifyPreCutoverFn ?? stage6NotProvisioned,
      ...(deps.readMigrationMarkerFn ? { readMigrationMarkerFn: deps.readMigrationMarkerFn } : {}),
    }

    // Single decision point. Throws Stage7BlockedError on ANY failing gate.
    await assertWriterCutoverAllowed(gateDeps, deps.writer)
  }
}
