/**
 * DEPRECATED shim — Phase 4 (B4) production-capable runtime cutover resolver
 * moved to `functions/src/gamification/runtimeCutoverConfig.ts` (outside the
 * emulator-only `v4/` directory, because it MUST be able to read production
 * Firestore).
 *
 * This file exists only so any legacy import path keeps resolving. It contains
 * no logic and no `export async function`, so the Stage 7 boundary guard
 * (tools/architecture/v4-cutover-boundary.test.ts) is unaffected.
 */

export * from '../runtimeCutoverConfig'
