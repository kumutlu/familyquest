/**
 * `useExperienceWorld` — the React hook that turns the resolved
 * Experience Theme into a {@link ResolvedWorld}.
 *
 * The hook does NOT decide eligibility, does NOT inspect a clock,
 * does NOT reimplement the Experience Theme resolver. It just reads
 * the resolved theme from `useExperienceTheme()` and asks the world
 * resolver for the matching atmospheric world.
 *
 * Preview override
 * ----------------
 * DEV/TEST only. The override is sourced from a tiny store that is
 * ONLY writable when the build is not production. In production the
 * store silently ignores all writes. This keeps the override as a
 * fixture-only switch without polluting the production call site.
 *
 * The override is exposed via `setExperienceWorldOverride(id)` for
 * the Engagement Preview. Components that read the world in
 * production NEVER call this function.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { useExperienceTheme } from './useExperienceTheme';
import { resolveWorld, WORLD_CATALOG, type ResolvedWorld, type WorldId } from '../domain/experienceWorld';

/* -------------------------------------------------------------------------- */
/* Preview override store (DEV-only)                                          */
/* -------------------------------------------------------------------------- */

interface OverrideState {
  override: WorldId | null;
  listeners: Set<() => void>;
  setOverride(next: WorldId | null): void;
}

const overrideState: OverrideState = {
  override: null,
  listeners: new Set<() => void>(),
  setOverride(next) {
    // Production guard — the override is for preview tooling only.
    if (isProductionBuild()) return;
    overrideState.override = next;
    for (const listener of overrideState.listeners) listener();
  },
};

function subscribeOverride(listener: () => void): () => void {
  overrideState.listeners.add(listener);
  return () => {
    overrideState.listeners.delete(listener);
  };
}

function getOverrideSnapshot(): WorldId | null {
  return overrideState.override;
}
function getServerOverrideSnapshot(): WorldId | null {
  return overrideState.override;
}

declare const importMetaEnv: { PROD?: boolean } | undefined;

function isProductionBuild(): boolean {
  try {
    const env = (import.meta as any)?.env;
    if (env && typeof env.PROD === 'boolean') return env.PROD;
  } catch {
    // ignore
  }
  return typeof importMetaEnv !== 'undefined'
    ? importMetaEnv.PROD === true
    : false;
}

/**
 * Set the world override. In production builds this is a no-op. The
 * Engagement Preview calls this when the PO toggles between worlds.
 */
export function setExperienceWorldOverride(next: WorldId | null): void {
  overrideState.setOverride(next);
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

export interface UseExperienceWorldResult {
  /** The resolved world bundle. */
  readonly world: ResolvedWorld;
  /**
   * Convenience: the current world id. Matches `world.definition.id`.
   */
  readonly worldId: WorldId;
  /**
   * Convenience: the optional short seasonal line for the current
   * world. `null` when the base world has no seasonal copy.
   */
  readonly seasonalLine: string | null;
  /**
   * Whether the world is currently being driven by a DEV preview
   * override. Components that show QA labels can read this; production
   * components MUST NOT branch on it.
   */
  readonly isPreviewOverride: boolean;
}

/**
 * Resolve the active seasonal world.
 *
 * The hook reads:
 *   - the resolved theme from `useExperienceTheme()` (no second resolver)
 *   - the optional preview override (DEV-only)
 *
 * The hook writes nothing.
 */
export function useExperienceWorld(): UseExperienceWorldResult {
  const resolved = useExperienceTheme();
  const override = useSyncExternalStore(
    subscribeOverride,
    getOverrideSnapshot,
    getServerOverrideSnapshot,
  );

  return useMemo<UseExperienceWorldResult>(() => {
    const world = resolveWorld({
      resolvedTheme: resolved
        ? {
            theme: resolved.theme,
            source: resolved.source,
            appliedEventName: resolved.appliedEventName,
          }
        : null,
      previewOverride: override,
      catalog: WORLD_CATALOG,
    });
    return {
      world,
      worldId: world.definition.id,
      seasonalLine: world.definition.seasonalLine ?? null,
      isPreviewOverride: world.source === 'preview-override',
    };
  }, [resolved, override]);
}

/** Reset the preview override (DEV-only). */
export function resetExperienceWorldOverride(): void {
  if (isProductionBuild()) return;
  overrideState.setOverride(null);
}
