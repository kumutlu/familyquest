/**
 * FamilyQuest / Queki — Seasonal World Resolver (V1).
 *
 * The resolver is a pure function. It consumes what the Experience
 * Theme resolver already decided (and an optional preview override)
 * and returns the matching {@link WorldDefinition}. It NEVER
 * re-derives eligibility, NEVER inspects a clock, NEVER reaches into
 * Firestore.
 *
 * The output is consumed by the React hook `useExperienceWorld` and
 * by tests. The renderer component paints the resolved definition.
 *
 * Precedence (top wins):
 *
 *   PREVIEW OVERRIDE        (dev / test only — never reaches prod)
 *      ↓
 *   EQUIPPED THEME          (a child has pinned a year-round theme)
 *      ↓
 *   SEASONAL EVENT
 *      ↓
 *   WEEKLY EVENT
 *      ↓
 *   BASE WORLD
 */

import type { WorldId, ResolveWorldInput, ResolvedWorld, WorldDefinition } from './types';
import { getWorldById, THEME_ID_TO_WORLD_ID } from './catalog';

const BASE_WORLD: WorldDefinition = getWorldById('world.normal')!;

/**
 * Map a theme id to a world id. Falls back to the base world when the
 * theme is unknown. The mapping is data, not behaviour, and lives in
 * the catalog module so adding a theme updates the world layer too.
 */
function worldIdForThemeId(themeId: string | undefined | null): WorldId {
  if (typeof themeId !== 'string' || themeId.length === 0) return 'world.normal';
  return THEME_ID_TO_WORLD_ID[themeId] ?? 'world.normal';
}

/**
 * Resolve the seasonal world from the resolved theme bundle.
 *
 * The function is intentionally tolerant. A missing or malformed
 * theme resolves to the base world, never throws, and never crashes
 * the render.
 */
export function resolveWorld(input: ResolveWorldInput): ResolvedWorld {
  const { resolvedTheme, previewOverride, catalog, originatingEvent } = input;
  const safeCatalog = catalog ?? [];

  // 1) Preview override — DEV/TEST only. It must NEVER come from a
  //    user-controlled value in production. The hook enforces that by
  //    ignoring `previewOverride` when the build is in production.
  if (previewOverride) {
    const found = safeCatalog.find((w) => w.id === previewOverride)
      ?? getWorldById(previewOverride)
      ?? null;
    if (found) {
      return Object.freeze({
        definition: found,
        source: 'preview-override',
        eventId: found.eventId ?? null,
      }) as ResolvedWorld;
    }
  }

  // 2) The Experience Theme resolver has already decided which theme
  //    is in effect. We translate theme id → world id. The translation
  //    is the ONLY place that knows the relationship; the renderer is
  //    fully generic.
  if (!resolvedTheme) {
    return Object.freeze({
      definition: BASE_WORLD,
      source: 'base',
      eventId: null,
    }) as ResolvedWorld;
  }

  const themeId = resolvedTheme.theme?.id;
  const worldId = worldIdForThemeId(themeId);
  const definition =
    safeCatalog.find((w) => w.id === worldId)
    ?? getWorldById(worldId)
    ?? BASE_WORLD;

  let source: ResolvedWorld['source'] = 'base';
  if (resolvedTheme.source === 'equipped') source = 'equipped-theme';
  else if (resolvedTheme.source === 'seasonal') source = 'seasonal-event';
  else if (resolvedTheme.source === 'weekly') source = 'weekly-event';
  else if (resolvedTheme.source === 'unknown-event-theme') source = 'unknown';
  else source = 'base';

  return Object.freeze({
    definition,
    source,
    eventId: originatingEvent?.id ?? null,
  }) as ResolvedWorld;
}

/**
 * Convenience: list the world catalog. The hook owns the production
 * list; tests use a smaller fixture list to assert resolver behaviour.
 */
export function listWorlds(catalog: readonly WorldDefinition[]): readonly WorldDefinition[] {
  return catalog;
}
