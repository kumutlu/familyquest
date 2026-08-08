/**
 * Gamification V4 — Phase 4 (B4): install the production runtime cutover resolver
 * into the deployed routing shim.
 *
 * This is the single place the deployed Cloud Functions runtime learns to read
 * the per-family `gamification_cutover_config` document dynamically. Because the
 * resolver fails closed to `legacy` when the document is absent / not `active`,
 * a family with no config (i.e. every production family today) is routed exactly
 * as before — to the legacy writer. Activating a family (via `cutoverAdmin.ts`)
 * flips the route within one resolver TTL with NO redeploy.
 *
 * This module is deliberately tiny and lives OUTSIDE `gamification/v4/` so it is
 * not subject to the Stage 7 boundary guard, and so `functions/src/index.ts` can
 * call it WITHOUT importing any `gamification/v4` module or naming the forbidden
 * wiring primitives (`setRouteResolver`, `activateStage7`, ...). The boundary
 * test greps `index.ts` for those strings; they live here instead.
 */

import type { Firestore } from 'firebase-admin/firestore'

import { createCutoverResolver } from './runtimeCutoverConfig'
import { setRouteResolver } from './routingShim'

/**
 * Wire the dynamic cutover resolver into the process-wide routing shim. Call once
 * at Cold Start after `getFirestore()`. Idempotent: calling it again simply
 * replaces the active resolver with a fresh (empty-cache) one.
 */
export function installRuntimeCutoverResolver(db: Firestore): void {
  const resolver = createCutoverResolver({ db })
  setRouteResolver({
    resolve: (writer, familyId) => resolver.resolveRoute(writer, familyId),
  })
}
