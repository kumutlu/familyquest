/**
 * Gamification V4 — cutover-aware route resolver (Stage 7, GATE 3).
 *
 * This is the emulator-gated counterpart to the production-safe
 * `functions/src/gamification/routingShim.ts`. It is the ONLY place that reads
 * the persisted `gamification_cutover_config` and enforces the mandatory
 * `assertStage7Allowed` gate before a writer may resolve to V4.
 *
 * Hard requirements satisfied here:
 *   - `assertStage7Allowed()` is MANDATORY before any route resolves to V4.
 *   - The V4 route FAILS CLOSED if Gate 1 / Gate 2 / Stage 6 evidence is
 *     invalid: `assertStage7Allowed` throws `Stage7BlockedError`, so the
 *     resolver never returns `v4` on a failing gate.
 *   - Legacy route is returned unchanged when the writer is not cut over.
 *   - No dual write: exactly one route is returned.
 *
 * Emulator only: every entry point asserts `assertEmulatorOnly` so this module
 * can never run against production Firestore. Not referenced by
 * `functions/src/index.ts` (pinned by the architecture boundary test).
 */

import { assertEmulatorOnly } from './repository'
import { readCutoverConfig } from './cutoverConfig'
import { assertStage7Allowed, type Stage7GateDeps } from './stage7Gate'
import {
  resolveWriterRoute,
  type GamificationWriter,
  type WriterRoute,
} from '../../../../src/domain/gamification/v4/featureFlags'

/**
 * Resolve a writer's authoritative route for a family through the live cutover
 * config. If the resolved route is `v4`, the mandatory Stage 7 gate is enforced
 * first; on any gate failure this throws `Stage7BlockedError` (fail closed) and
 * never returns `v4`.
 */
export async function resolveStage7WriterRoute(
  deps: Stage7GateDeps,
  writer: GamificationWriter,
  familyId: string,
): Promise<WriterRoute> {
  assertEmulatorOnly('resolveStage7WriterRoute')
  const config = await readCutoverConfig(deps.db, familyId)
  const route = resolveWriterRoute(config.flags, writer, familyId)
  if (route === 'v4') {
    // MANDATORY: Stage 7 cannot start unless Gate 1 + Gate 2 + Stage 6 are all
    // green. Throws Stage7BlockedError on failure (fail closed).
    await assertStage7Allowed(deps)
  }
  return route
}
