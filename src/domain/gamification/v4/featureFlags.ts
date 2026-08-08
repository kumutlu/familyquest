/**
 * Gamification V4 — feature flag framework (Stage 7 prerequisite, GATE 3).
 *
 * Pure, framework-free module. It contains NO firebase / firebase-admin import
 * (pinned by `tools/architecture/v4-cutover-boundary.test.ts`) so it can be
 * imported by both the client bundle and Cloud Functions without dragging in
 * any runtime write path.
 *
 * This is the per-writer, per-family kill switch the Stage 7 readiness audit
 * (docs/gamification-v4/07-cutover-readiness-audit.md, finding B3) found
 * missing. Every legacy authoritative writer (the 7 enumerated in the audit
 * §6) is represented here so it can be routed independently to `legacy` or
 * `v4`. The DEFAULT is fail-closed: `defaultFeatureFlags()` routes every
 * writer to `legacy`, so a missing / unread config can never activate V4.
 *
 * The runtime cutover configuration layer (`functions/src/gamification/v4/
 * cutoverConfig.ts`) persists a `FeatureFlagSet` per family and is the only
 * thing that may flip a writer to `v4`. Nothing in this module writes
 * Firestore.
 *
 * See docs/gamification-v4/08-stage7-infrastructure.md for the full design.
 */

/** The seven legacy authoritative writers (audit §6). */
export type GamificationWriter =
  | 'task_approval' // functions/src/gamificationRepository.ts processApprovedCompletion
  | 'task_invalidation' // gamificationRepository.ts rewardPoints reversal
  | 'day_finalization' // gamificationRepository.ts finalizeChildDay
  | 'behaviour' // functions/src/behaviourRepository.ts
  | 'reward_redemption' // src/lib/api.ts (client, browser-trusted)
  | 'challenge_claim' // challenge claim + manual adjust (src/lib/api.ts)
  | 'avatar_unlock' // avatar unlock + goal reversal (src/lib/api.ts, reversalApi.ts)

/** Canonical ordered list of every writer. */
export const ALL_WRITERS: readonly GamificationWriter[] = [
  'task_approval',
  'task_invalidation',
  'day_finalization',
  'behaviour',
  'reward_redemption',
  'challenge_claim',
  'avatar_unlock',
] as const

/** Where a writer's balance mutation is currently applied. */
export type WriterRoute = 'legacy' | 'v4'

/**
 * A complete, serialisable feature-flag set.
 *
 * `writers` is the default route applied to every family. `familyOverrides`
 * lets a single family be moved independently (canary / per-family rollback)
 * without touching the global default.
 */
export interface FeatureFlagSet {
  readonly writers: Readonly<Record<GamificationWriter, boolean>>
  readonly familyOverrides: Readonly<Record<string, Partial<Record<GamificationWriter, boolean>>>>
}

/** True iff the writer is routed to the V4 engine for the given family. */
export function isV4Active(
  flags: FeatureFlagSet,
  writer: GamificationWriter,
  familyId?: string,
): boolean {
  if (familyId !== undefined) {
    const override = flags.familyOverrides[familyId]?.[writer]
    if (override !== undefined) return override
  }
  return flags.writers[writer] === true
}

/** Resolve the concrete route a writer takes for a family. */
export function resolveWriterRoute(
  flags: FeatureFlagSet,
  writer: GamificationWriter,
  familyId?: string,
): WriterRoute {
  return isV4Active(flags, writer, familyId) ? 'v4' : 'legacy'
}

/** Fail-closed default: every writer stays on the legacy engine. */
export function defaultFeatureFlags(): FeatureFlagSet {
  const writers = {} as Record<GamificationWriter, boolean>
  for (const w of ALL_WRITERS) writers[w] = false
  return { writers, familyOverrides: {} }
}

/** Enable one writer globally (or for a single family when `familyId` given). */
export function withWriterEnabled(
  flags: FeatureFlagSet,
  writer: GamificationWriter,
  familyId?: string,
): FeatureFlagSet {
  if (familyId !== undefined) {
    return {
      writers: { ...flags.writers },
      familyOverrides: {
        ...flags.familyOverrides,
        [familyId]: { ...flags.familyOverrides[familyId], [writer]: true },
      },
    }
  }
  return {
    writers: { ...flags.writers, [writer]: true },
    familyOverrides: flags.familyOverrides,
  }
}

/** Disable one writer globally (or for a single family when `familyId` given). */
export function withWriterDisabled(
  flags: FeatureFlagSet,
  writer: GamificationWriter,
  familyId?: string,
): FeatureFlagSet {
  if (familyId !== undefined) {
    return {
      writers: { ...flags.writers },
      familyOverrides: {
        ...flags.familyOverrides,
        [familyId]: { ...flags.familyOverrides[familyId], [writer]: false },
      },
    }
  }
  return {
    writers: { ...flags.writers, [writer]: false },
    familyOverrides: flags.familyOverrides,
  }
}

/** Route every writer to V4 (global cutover). */
export function withAllV4(_flags: FeatureFlagSet = defaultFeatureFlags()): FeatureFlagSet {
  const writers = {} as Record<GamificationWriter, boolean>
  for (const w of ALL_WRITERS) writers[w] = true
  return { writers, familyOverrides: {} }
}

/** Route every writer back to legacy (global rollback). */
export function withAllLegacy(_flags: FeatureFlagSet = defaultFeatureFlags()): FeatureFlagSet {
  return defaultFeatureFlags()
}

/** True iff no writer routes to V4 in any family (fully legacy). */
export function allLegacy(flags: FeatureFlagSet): boolean {
  if (ALL_WRITERS.some((w) => flags.writers[w] === true)) return false
  for (const ov of Object.values(flags.familyOverrides)) {
    if (Object.values(ov).some((v) => v === true)) return false
  }
  return true
}

/** True iff every writer routes to V4 in the default and every override. */
export function allV4(flags: FeatureFlagSet): boolean {
  if (ALL_WRITERS.some((w) => flags.writers[w] !== true)) return false
  for (const ov of Object.values(flags.familyOverrides)) {
    if (ALL_WRITERS.some((w) => ov[w] === false)) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Routing shim (production-safe, pure).
//
// The routing layer is the SINGLE decision point that resolves a writer to
// `legacy` or `v4` for a family. It is intentionally pure (no firebase) so it
// can be imported by both the Cloud Functions bundle and the web client
// without dragging in any write path. The emulator-gated, cutover-aware
// resolver (`functions/src/gamification/v4/routeResolver.ts`) is the only place
// that reads the persisted cutover config and enforces `assertStage7Allowed`
// before a V4 route is permitted.
//
// Default is fail-closed: `defaultRouteResolver()` always returns `legacy`, so
// an unconfigured family can never be routed to V4 in production.
// ---------------------------------------------------------------------------

/** A function that resolves the concrete route for a writer + family. */
export type ResolveRoute = (
  writer: GamificationWriter,
  familyId: string,
) => WriterRoute | Promise<WriterRoute>

/** Pluggable route resolver (injectable for tests / future cutover). */
export interface RouteResolver {
  readonly resolve: ResolveRoute
}

/** Fail-closed resolver: every writer stays on legacy. */
export function legacyRouteResolver(): RouteResolver {
  return { resolve: () => 'legacy' as const }
}

/** Resolver backed by an explicit feature-flag set (per-writer, per-family). */
export function flagRouteResolver(flags: FeatureFlagSet): RouteResolver {
  return { resolve: (writer, familyId) => resolveWriterRoute(flags, writer, familyId) }
}

/** The production default: all-legacy, fail closed. */
export function defaultRouteResolver(): RouteResolver {
  return legacyRouteResolver()
}

/** Resolve a writer's route through a resolver, defaulting to all-legacy. */
export async function resolveRouteSafe(
  resolver: RouteResolver | undefined,
  writer: GamificationWriter,
  familyId: string,
): Promise<WriterRoute> {
  if (resolver === undefined) return 'legacy' as const
  return resolver.resolve(writer, familyId)
}
