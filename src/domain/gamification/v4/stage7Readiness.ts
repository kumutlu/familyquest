/**
 * Gamification V4 — Stage 7 readiness evaluation (pure, GATE 3 gate logic).
 *
 * Pure module (no firebase import; pinned by the architecture boundary test).
 * It encodes the MANDATORY precondition chain for Stage 7 writer cutover:
 *
 *   GATE 1  — owner-approved replay report (`GATE_1_REACHED`)
 *   GATE 2  — migration marker present + wallet hash BEFORE == AFTER
 *   STAGE 6 — `verifyPreCutover()` six-check report PASSED
 *
 * Stage 7 (writer cutover) MUST NOT start unless ALL THREE are green. This
 * module is the pure decision core; the emulator-gated `assertStage7Allowed`
 * (functions/src/gamification/v4/stage7Gate.ts) gathers the live evidence and
 * calls `evaluateStage7Readiness`, throwing on any failure.
 *
 * Keeping the decision pure means it is exhaustively unit-testable without a
 * Firestore emulator, and the gate can never silently diverge from the audit's
 * GATE 3 exit criteria (docs/gamification-v4/07-cutover-readiness-audit.md B3).
 */

/** One named gate result. `passed: false` is always reported with a reason. */
export interface GateStatus {
  readonly passed: boolean
  readonly detail: string
}

/** The three mandatory gates that must all be green before Stage 7. */
export type Stage7GateName = 'gate1' | 'gate2' | 'stage6'

/** Structured input to the readiness evaluator. */
export interface Stage7ReadinessInput {
  readonly gate1: GateStatus
  readonly gate2: GateStatus
  readonly stage6: GateStatus
}

/** Deterministic readiness verdict. */
export interface Stage7Readiness {
  /** True only when EVERY gate passed. Fail closed. */
  readonly ready: boolean
  readonly gates: {
    readonly gate1: GateStatus
    readonly gate2: GateStatus
    readonly stage6: GateStatus
  }
  /** Names of the gates that failed (empty when ready). */
  readonly failedGates: ReadonlyArray<Stage7GateName>
  /** Human-readable reasons for every failure (empty when ready). */
  readonly reasons: ReadonlyArray<string>
}

/** Build a `GateStatus` from a boolean + message. */
export function gateStatus(passed: boolean, detail: string): GateStatus {
  return { passed, detail }
}

const GATE_ORDER: ReadonlyArray<Stage7GateName> = ['gate1', 'gate2', 'stage6']

/**
 * Evaluate whether Stage 7 may start.
 *
 * Pure and deterministic: the same input always yields the same verdict, and
 * `ready` is false unless `gate1`, `gate2` AND `stage6` all report `passed`.
 * Every failing gate contributes its `detail` to `reasons` so the operator sees
 * exactly which precondition blocked cutover.
 */
export function evaluateStage7Readiness(input: Stage7ReadinessInput): Stage7Readiness {
  const gates = {
    gate1: input.gate1,
    gate2: input.gate2,
    stage6: input.stage6,
  }
  const failedGates: Stage7GateName[] = []
  const reasons: string[] = []
  for (const name of GATE_ORDER) {
    const status = gates[name]
    if (!status.passed) {
      failedGates.push(name)
      reasons.push(`${name}: ${status.detail}`)
    }
  }
  return {
    ready: failedGates.length === 0,
    gates,
    failedGates,
    reasons,
  }
}

/** Convenience: build a fully-green input (used by tests and the happy path). */
export function allGatesPassed(detail = 'ok'): Stage7ReadinessInput {
  return {
    gate1: gateStatus(true, detail),
    gate2: gateStatus(true, detail),
    stage6: gateStatus(true, detail),
  }
}
