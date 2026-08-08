/**
 * Gamification V4 — mandatory Stage 7 gate (GATE 3 enforcement, audit B3).
 *
 * This is the mechanical enforcement the audit found missing: `verifyPreCutover`
 * (Stage 6) was advisory only — nothing blocked a writer cutover on a failing
 * report. `assertStage7Allowed` makes it MANDATORY: Stage 7 cannot start unless
 * Gate 1 (owner-approved replay), Gate 2 (migration marker + wallet hash) AND
 * Stage 6 (`verifyPreCutover` six-check report) are ALL green. Any failure
 * throws `Stage7BlockedError` carrying the full readiness verdict.
 *
 * Hard constraints (audit B3 / R1):
 *  - Emulator only: every entry point calls `assertEmulatorOnly`, so the gate
 *    can never run against production Firestore.
 *  - The Stage 6 check is INJECTED (`verifyPreCutoverFn`) rather than imported
 *    from `scripts/verify/pre-cutover.ts`. That keeps this module inside the
 *    functions TypeScript build graph (functions/tsconfig.json does not include
 *    the tsx-only `scripts/` tree) while still wiring the real `verifyPreCutover`
 *    as a hard precondition — the caller (a future Stage 7 writer, or a test)
 *    supplies it. No second gate arithmetic: the pure decision core is
 *    `evaluateStage7Readiness` (src/domain/gamification/v4/stage7Readiness.ts).
 *  - Not referenced by `functions/src/index.ts` (pinned by the architecture
 *    boundary test): this is test/tooling-only, never a deployed write path.
 *  - Does NOT modify any legacy writer and does NOT activate any V4 writer; it
 *    only READS evidence and decides. The actual cutover is a separate,
 *    explicitly-invoked operation (see cutoverConfig.ts / rollback.ts).
 */

import type { Firestore } from 'firebase-admin/firestore'

import { assertEmulatorOnly } from './repository'
import { isCutoverActive, readCutoverConfig } from './cutoverConfig'
import {
  evaluateStage7Readiness,
  gateStatus,
  type GateStatus,
  type Stage7Readiness,
} from '../../../../src/domain/gamification/v4/stage7Readiness'
import { isV4Active, type GamificationWriter } from '../../../../src/domain/gamification/v4/featureFlags'

// ---------------------------------------------------------------------------
// Structural types (kept local so this module need not import the tsx-only
// scripts/ verification layer, which is not part of the functions build graph).
// They are intentionally structural supersets of the real
// `PreCutoverReport` / `MigrationMarkerV4` / `ProductionReplayReport` shapes.
// ---------------------------------------------------------------------------

/** Subset of `PreCutoverReport` this gate consumes. */
export interface Stage7PreCutoverReport {
  readonly passed: boolean
  readonly checks: ReadonlyArray<{ readonly name: string; readonly passed: boolean; readonly detail: string }>
}

/** Subset of `MigrationMarkerV4` this gate consumes. */
export interface Stage7MigrationMarker {
  readonly familyId: string
  readonly walletHashOk: boolean
  readonly walletHashBefore: string | null
  readonly walletHashAfter: string | null
}

/** Subset of `ProductionReplayReport` this gate consumes (Gate 1 field). */
export interface Stage7ReplayReport {
  readonly gate: string
}

/** Injected Stage 6 verification (the real `verifyPreCutover`). */
export type VerifyPreCutoverFn = (
  familyId: string,
  deps: { db: Firestore; report: Stage7ReplayReport; marker?: Stage7MigrationMarker | null },
) => Promise<Stage7PreCutoverReport>

/** Injected Task 5.2 marker reader (the real `readMigrationMarker`). */
export type ReadMigrationMarkerFn = (
  db: Firestore,
  familyId: string,
) => Promise<Stage7MigrationMarker | null>

/** Thrown when Stage 7 is not permitted; carries the full readiness verdict. */
export class Stage7BlockedError extends Error {
  constructor(
    message: string,
    public readonly readiness: Stage7Readiness,
  ) {
    super(message)
    this.name = 'Stage7BlockedError'
  }
}

/** Evidence the gate needs to decide. */
export interface Stage7GateDeps {
  readonly db: Firestore
  /** Approved Gate 1 replay report artifact (GATE_1_REACHED). */
  readonly report: Stage7ReplayReport
  readonly familyId: string
  /**
   * Optional pre-read Task 5.2 migration marker. When omitted (and no
   * `readMigrationMarkerFn` is supplied) it is treated as absent => Gate 2 FAIL.
   */
  readonly marker?: Stage7MigrationMarker | null
  /** The Stage 6 verification (mandatory, not advisory). Injected. */
  readonly verifyPreCutoverFn: VerifyPreCutoverFn
  /** Optional Task 5.2 marker reader. When omitted, `marker` is used as-is. */
  readonly readMigrationMarkerFn?: ReadMigrationMarkerFn
}

/**
 * Evaluate (non-throwing) whether Stage 7 may start for a family.
 *
 * Gathers live evidence for all three gates and returns the pure verdict from
 * `evaluateStage7Readiness`. Never throws for a failing gate — every failure is
 * reported in `reasons` so the operator sees exactly what blocked cutover.
 */
export async function checkStage7Allowed(deps: Stage7GateDeps): Promise<Stage7Readiness> {
  assertEmulatorOnly('checkStage7Allowed')

  // Gate 1 — owner-approved replay report.
  const gate1: GateStatus = deps.report.gate === 'GATE_1_REACHED'
    ? gateStatus(true, `replay report gate=${deps.report.gate}`)
    : gateStatus(false, `replay report gate=${deps.report.gate}; expected GATE_1_REACHED`)

  // Gate 2 — migration marker present + wallet hash BEFORE == AFTER.
  const marker = deps.readMigrationMarkerFn
    ? await deps.readMigrationMarkerFn(deps.db, deps.familyId)
    : (deps.marker ?? null)
  const gate2: GateStatus =
    !marker
      ? gateStatus(false, 'migration marker absent (Gate 2 proof missing)')
      : !marker.walletHashOk
        ? gateStatus(false, `wallet hash BEFORE != AFTER (before=${marker.walletHashBefore} after=${marker.walletHashAfter})`)
        : gateStatus(true, `migration marker present; wallet hash BEFORE == AFTER (${marker.walletHashBefore})`)

  // Stage 6 — verifyPreCutover six-check report PASSED (mandatory, not advisory).
  const pre: Stage7PreCutoverReport = await deps.verifyPreCutoverFn(deps.familyId, {
    db: deps.db,
    report: deps.report,
    marker,
  })
  const stage6: GateStatus = pre.passed
    ? gateStatus(true, 'verifyPreCutover: all six checks passed')
    : gateStatus(false, `verifyPreCutover failed: ${pre.checks.filter((c) => !c.passed).map((c) => c.name).join(', ')}`)

  return evaluateStage7Readiness({ gate1, gate2, stage6 })
}

/**
 * MANDATORY gate: throw `Stage7BlockedError` unless Gate 1, Gate 2 and Stage 6
 * are all green. Returns the readiness verdict on success.
 */
export async function assertStage7Allowed(deps: Stage7GateDeps): Promise<Stage7Readiness> {
  assertEmulatorOnly('assertStage7Allowed')
  const readiness = await checkStage7Allowed(deps)
  if (!readiness.ready) {
    throw new Stage7BlockedError(
      `Stage 7 blocked: ${readiness.reasons.join('; ')}`,
      readiness,
    )
  }
  return readiness
}

/**
 * Per-writer cutover guard (GATE 3 granularity). A specific legacy writer may
 * only be re-pointed at V4 when:
 *   1. the family-wide Stage 7 gate is satisfied (all three gates green), AND
 *   2. the runtime cutover config has this writer's flag enabled for the family.
 *
 * This is the per-writer kill switch the audit required: flipping a single
 * writer's flag off (setWriterFlag / rollbackStage7) instantly disables it.
 */
export async function assertWriterCutoverAllowed(
  deps: Stage7GateDeps,
  writer: GamificationWriter,
): Promise<Stage7Readiness> {
  assertEmulatorOnly('assertWriterCutoverAllowed')
  const readiness = await assertStage7Allowed(deps)
  const config = await readCutoverConfig(deps.db, deps.familyId)
  if (!isCutoverActive(config)) {
    throw new Stage7BlockedError(
      `Writer ${writer} cutover refused: family ${deps.familyId} cutover status is '${config.status}' (not active).`,
      readiness,
    )
  }
  if (!isV4Active(config.flags, writer, deps.familyId)) {
    throw new Stage7BlockedError(
      `Writer ${writer} cutover refused: feature flag is disabled for family ${deps.familyId}.`,
      readiness,
    )
  }
  return readiness
}
