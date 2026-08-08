/**
 * Gamification routing shim — production-safe, fail-closed (Stage 7 pre-cutover).
 *
 * This is the SINGLE routing decision point the 7 real authoritative writers
 * call. It is intentionally free of any firebase / firebase-admin import (it
 * only depends on the pure domain `featureFlags`) so it can be imported by the
 * production Cloud Functions bundle without dragging in a V4 write path.
 *
 * Design (see docs/gamification-v4/08-stage7-infrastructure.md):
 *   - The DEFAULT resolver is `legacyRouteResolver()` → every writer resolves to
 *     `legacy`. An unconfigured family can NEVER be routed to V4 in production.
 *   - The cutover-aware, emulator-gated resolver that reads the persisted
 *     `gamification_cutover_config` and enforces `assertStage7Allowed` before a
 *     V4 route lives in `functions/src/gamification/v4/routeResolver.ts`. It is
 *     injected here (via `setRouteResolver`) only in the emulator / cutover
 *     path; it is never referenced by `functions/src/index.ts`, so it can never
 *     become a production write path.
 *   - `resolveWriterRouteSafe` is the one call every writer makes. Because the
 *     default is legacy and no flag is switched pre-7.1, production behaviour is
 *     byte-for-byte unchanged and no V4 writer is ever activated.
 *
 * No dual write: the resolver returns exactly ONE route; the caller must use
 * that single route as the authoritative engine. One source = one route.
 */

import {
  defaultRouteResolver,
  type GamificationWriter,
  type RouteResolver,
  type WriterRoute,
} from '../../../src/domain/gamification/v4/featureFlags'

/** Currently active resolver. Defaults to all-legacy (fail closed). */
let activeResolver: RouteResolver = defaultRouteResolver()

/** Override the active resolver (emulator / cutover / tests only). */
export function setRouteResolver(resolver: RouteResolver | undefined): void {
  activeResolver = resolver ?? defaultRouteResolver()
}

/** Read the currently active resolver (primarily for tests). */
export function getRouteResolver(): RouteResolver {
  return activeResolver
}

/**
 * Resolve a writer's authoritative route for a family through the active
 * resolver. Always returns a single concrete route (`legacy` | `v4`).
 */
export async function resolveWriterRouteSafe(
  writer: GamificationWriter,
  familyId: string,
): Promise<WriterRoute> {
  return activeResolver.resolve(writer, familyId)
}

/**
 * Resolve a writer's route and enforce that it is `legacy`. This is the
 * fail-closed pre-cutover guard every authoritative writer calls: if a route
 * ever resolves to `v4` before the V4 engine is deployed (Task 7.1), the writer
 * refuses rather than performing an undefined dual/partial write. Because the
 * default resolver is all-legacy, this is a no-op in production today.
 */
export async function requireLegacyRoute(
  writer: GamificationWriter,
  familyId: string,
): Promise<void> {
  const route = await resolveWriterRouteSafe(writer, familyId)
  if (route !== 'legacy') {
    throw new Error(`V4 writer not deployed for "${writer}" (pre-cutover): route resolved to "${route}"`)
  }
}

/** Re-export the pure types so callers import from one place. */
export type { GamificationWriter, RouteResolver, WriterRoute }
export { ALL_WRITERS } from '../../../src/domain/gamification/v4/featureFlags'
