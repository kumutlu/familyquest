/**
 * Gamification V4 — Phase 4 (blocker B4): PRODUCTION runtime cutover config.
 *
 * Preflight found that cutover/rollback was not production-capable:
 *   - every cutover config write was emulator-gated;
 *   - the deployed runtime never read the config, so a route change required a
 *     redeploy — and therefore so did a rollback.
 *
 * This module is the deployed-runtime half of the fix. It is DELIBERATELY
 * located OUTSIDE `functions/src/gamification/v4/` so it is NOT subject to the
 * Stage 7 boundary guard that forces every `v4/` module to be emulator-only
 * (see tools/architecture/v4-cutover-boundary.test.ts). This module MUST be
 * able to read production Firestore — that is its entire purpose.
 *
 *   - SERVER ONLY. It reads through the Admin `Firestore` handle. Firestore
 *     rules deny clients any access to `gamification_cutover_config` (read AND
 *     write), so the flag can never be set, seen or spoofed from a bundle. No
 *     secret of any kind is involved.
 *   - DYNAMIC. The route is resolved per invocation from Firestore, with a
 *     BOUNDED cache (default TTL 15s, hard max 60s). A rollback therefore takes
 *     effect within one TTL with NO deploy.
 *   - FAIL LEGACY. Missing document, unreadable document, malformed flags,
 *     Firestore error, unknown writer, empty familyId — every one of these
 *     resolves to `legacy`. There is no path where an error resolves to v4.
 *   - PER FAMILY / PER WRITER. Routing granularity comes from the existing
 *     `featureFlags` domain module; no second flag semantics.
 *   - NO DUAL WRITE. Exactly one route is returned per call.
 *
 * Activation/rollback (with their Gate 1 + Gate 2 + Stage 6 preconditions and
 * audit trail) live in `cutoverAdmin.ts`. This module never writes.
 */

import type { Firestore } from 'firebase-admin/firestore'

import { cutoverConfigDocPath, defaultCutoverConfig, type CutoverConfig } from './v4/cutoverConfig'
import {
  defaultFeatureFlags,
  resolveWriterRoute,
  type FeatureFlagSet,
  type GamificationWriter,
  type WriterRoute,
} from '../../../src/domain/gamification/v4/featureFlags'

/** Default cache TTL. Short by design: rollback must be near-instant. */
export const DEFAULT_CUTOVER_CACHE_TTL_MS = 15_000
/** Hard upper bound on the cache TTL, so a config can never go stale for long. */
export const MAX_CUTOVER_CACHE_TTL_MS = 60_000

/** The always-safe answer. */
export const LEGACY_ROUTE: WriterRoute = 'legacy'

export interface CutoverResolverOptions {
  readonly db: Firestore
  readonly ttlMs?: number
  readonly now?: () => number
  /** Structured logger for observability (defaults to console.warn). */
  readonly onError?: (message: string, error: unknown) => void
}

export interface CutoverResolution {
  readonly familyId: string
  readonly writer: GamificationWriter
  readonly route: WriterRoute
  /** Why this route was chosen (always populated; useful in logs/audits). */
  readonly reason: string
  readonly fromCache: boolean
}

export interface CutoverResolver {
  /** Resolve ONE writer's route for ONE family. Never throws. */
  resolve(writer: GamificationWriter, familyId: string): Promise<CutoverResolution>
  /** Resolve to a bare route (convenience). Never throws. */
  resolveRoute(writer: GamificationWriter, familyId: string): Promise<WriterRoute>
  /** Drop a family's cached config (used right after activate/rollback). */
  invalidate(familyId: string): void
  invalidateAll(): void
}

interface CacheEntry {
  readonly config: CutoverConfig
  readonly expiresAt: number
}

function isFeatureFlagSet(value: unknown): value is FeatureFlagSet {
  return value !== null && typeof value === 'object'
}

/**
 * Build the runtime resolver.
 *
 * The resolver is safe to construct at module scope in the deployed runtime:
 * it performs no I/O until `resolve()` is called, and it can only ever read.
 */
export function createCutoverResolver(options: CutoverResolverOptions): CutoverResolver {
  const { db } = options
  const now = options.now ?? (() => Date.now())
  const ttlMs = Math.min(
    Math.max(0, options.ttlMs ?? DEFAULT_CUTOVER_CACHE_TTL_MS),
    MAX_CUTOVER_CACHE_TTL_MS,
  )
  const onError =
    options.onError
    ?? ((message: string, error: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(`[gamification-cutover] ${message}; defaulting to legacy`, error)
    })

  const cache = new Map<string, CacheEntry>()

  async function loadConfig(familyId: string): Promise<{ config: CutoverConfig; fromCache: boolean }> {
    const cached = cache.get(familyId)
    if (cached && cached.expiresAt > now()) return { config: cached.config, fromCache: true }

    try {
      const snap = await db.doc(cutoverConfigDocPath(familyId)).get()
      const config: CutoverConfig = snap.exists
        ? (() => {
            const data = snap.data() as Partial<CutoverConfig>
            const flags = isFeatureFlagSet(data.flags) ? data.flags : defaultFeatureFlags()
            return { ...defaultCutoverConfig(familyId), ...data, familyId, flags }
          })()
        : defaultCutoverConfig(familyId)
      cache.set(familyId, { config, expiresAt: now() + ttlMs })
      return { config, fromCache: false }
    } catch (error) {
      onError(`could not read cutover config for family ${familyId}`, error)
      // Deliberately NOT cached: a transient read failure must not pin a family.
      return { config: defaultCutoverConfig(familyId), fromCache: false }
    }
  }

  async function resolve(
    writer: GamificationWriter,
    familyId: string,
  ): Promise<CutoverResolution> {
    if (!familyId || typeof familyId !== 'string' || familyId.includes('/')) {
      return { familyId: String(familyId), writer, route: LEGACY_ROUTE, reason: 'invalid familyId', fromCache: false }
    }

    const { config, fromCache } = await loadConfig(familyId)

    if (config.status !== 'active') {
      return { familyId, writer, route: LEGACY_ROUTE, reason: `cutover status=${config.status}`, fromCache }
    }

    let route: WriterRoute = LEGACY_ROUTE
    try {
      route = resolveWriterRoute(config.flags, writer, familyId)
    } catch (error) {
      onError(`malformed cutover flags for family ${familyId}`, error)
      return { familyId, writer, route: LEGACY_ROUTE, reason: 'malformed flags', fromCache }
    }

    return {
      familyId,
      writer,
      route: route === 'v4' ? 'v4' : LEGACY_ROUTE,
      reason: route === 'v4' ? 'cutover active for this writer' : 'writer not cut over',
      fromCache,
    }
  }

  return {
    resolve,
    async resolveRoute(writer, familyId) {
      return (await resolve(writer, familyId)).route
    },
    invalidate(familyId: string) {
      cache.delete(familyId)
    },
    invalidateAll() {
      cache.clear()
    },
  }
}
