/**
 * The single deterministic Experience Theme resolver.
 *
 * Precedence (top wins):
 *
 *   CHILD OWNED / EQUIPPED CUSTOMISATION
 *      ↓
 *   SEASONAL EVENT THEME    (family must have opted in)
 *      ↓
 *   WEEKLY THEME             (family must have opted in)
 *      ↓
 *   BASE THEME
 *
 * The resolver is the only place this precedence is encoded. Components
 * consume the resolved theme; they NEVER reimplement the rules.
 *
 * Safety contract:
 *   - Unknown preference keys default to opt-OUT (deny by default).
 *   - Unknown theme ids fall back to the base theme.
 *   - Events outside their window, in `draft` / `scheduled` / `ended`,
 *     are ignored.
 *   - Future events (`startsAt > now`) are ignored.
 *   - Disabled seasonal preference falls back to weekly (or base).
 *   - Unknown future event kinds do not crash; they fall back to base.
 *
 * No gamification side effects. No writes. Pure function of inputs.
 */

import type {
  EventDefinition,
  ExperiencePreferences,
  ResolveExperienceThemeInput,
  ResolvedExperienceTheme,
  ThemeDefinition,
} from './types';

/**
 * Decide whether an event is currently *active* given the caller's clock.
 * Defensive: any malformed event falls back to `inactive`.
 */
export function isEventLive(event: EventDefinition | null | undefined, now: number): boolean {
  if (!event) return false;
  if (event.status !== 'active') return false;
  if (!Number.isFinite(event.startsAt) || !Number.isFinite(event.endsAt)) return false;
  if (event.endsAt <= event.startsAt) return false;
  return now >= event.startsAt && now < event.endsAt;
}

/**
 * Determine whether the family has opted in to a given preference key.
 *
 * Returns `false` for unknown / missing keys — we never auto-enable a
 * celebration because the family hasn't told us about it yet.
 */
export function isPreferenceEnabled(
  preferences: ExperiencePreferences,
  preferenceKey: string | undefined,
): boolean {
  if (!preferenceKey) return true; // No opt-in requirement at all.
  const value = preferences?.seasonalEvents?.[preferenceKey];
  return value === true;
}

/**
 * Pick the first theme in the catalog matching `id`, or `fallback` if
 * nothing matches. Never throws.
 */
function themeOrFallback(
  themes: readonly ThemeDefinition[],
  id: string | undefined,
  fallback: ThemeDefinition,
): { theme: ThemeDefinition; unknown: boolean } {
  if (typeof id !== 'string' || id.length === 0) {
    return { theme: fallback, unknown: false };
  }
  const match = themes.find((theme) => theme.id === id);
  if (!match) {
    return { theme: fallback, unknown: true };
  }
  return { theme: match, unknown: false };
}

/**
 * Resolve the effective experience theme.
 *
 * Pure function. Same inputs ⇒ same outputs. Safe to call from anywhere.
 */
export function resolveExperienceTheme(
  input: ResolveExperienceThemeInput,
): ResolvedExperienceTheme {
  const { baseTheme, preferences, now, themes } = input;

  // Defence-in-depth: if the caller passed a malformed baseTheme, the only
  // honest answer is to refuse to crash. We pick the first catalog theme
  // as a last-resort fallback and surface a `base` source.
  const fallbackBase = themes[0] ?? baseTheme;
  const safeBase = baseTheme ?? fallbackBase;

  // Layer 1 — child equipped customisation. Wins where appropriate.
  const equippedThemeId = input.equipped?.themeId;
  if (equippedThemeId) {
    const owned = themeOrFallback(themes, equippedThemeId, safeBase);
    if (!owned.unknown) {
      return Object.freeze({
        theme: owned.theme,
        source: 'equipped',
        appliedEventName: null,
      }) as ResolvedExperienceTheme;
    }
  }

  // Layer 2 — seasonal event. Resolved only if it's live AND the family
  // has opted in. A disabled preference never blocks the *weekly* layer.
  const seasonal = input.seasonalEvent;
  if (seasonal && isEventLive(seasonal, now)) {
    const key = seasonal.eligibility?.preferenceKey;
    if (!isPreferenceEnabled(preferences, key)) {
      // Continue to weekly resolution — do not silently return base.
      // Fall through.
    } else {
      const themed = themeOrFallback(themes, seasonal.themeId, safeBase);
      if (!themed.unknown) {
        return Object.freeze({
          theme: themed.theme,
          source: 'seasonal',
          appliedEventName: seasonal.name,
        }) as ResolvedExperienceTheme;
      }
      // Unknown theme id attached to a live seasonal event: surface the
      // base theme but flag the source so the operator can see a misconfig.
      return Object.freeze({
        theme: safeBase,
        source: 'unknown-event-theme',
        appliedEventName: seasonal.name,
      }) as ResolvedExperienceTheme;
    }
  }

  // Layer 3 — weekly theme. Honours the family's weeklyThemes master
  // toggle (opt-out completely) AND any per-event preference key.
  const weekly = input.weeklyEvent;
  if (weekly && isEventLive(weekly, now)) {
    const weeklyAllowed = preferences.weeklyThemes === true;
    const key = weekly.eligibility?.preferenceKey;
    const perEventAllowed = isPreferenceEnabled(preferences, key);
    if (weeklyAllowed && perEventAllowed) {
      const themed = themeOrFallback(themes, weekly.themeId, safeBase);
      if (!themed.unknown) {
        return Object.freeze({
          theme: themed.theme,
          source: 'weekly',
          appliedEventName: weekly.name,
        }) as ResolvedExperienceTheme;
      }
      return Object.freeze({
        theme: safeBase,
        source: 'unknown-event-theme',
        appliedEventName: weekly.name,
      }) as ResolvedExperienceTheme;
    }
  }

  // Layer 4 — base. Always safe.
  return Object.freeze({
    theme: safeBase,
    source: 'base',
    appliedEventName: null,
  }) as ResolvedExperienceTheme;
}

/**
 * Convenience: pick the currently live seasonal event from a list, using
 * the supplied clock. Honours `status`, the window, and family opt-in.
 *
 * The resolver still re-checks everything internally; this helper exists
 * so the hook does not duplicate the live-window logic.
 */
export function pickLiveSeasonalEvent(
  events: readonly EventDefinition[] | undefined,
  preferences: ExperiencePreferences,
  now: number,
): EventDefinition | null {
  if (!events || events.length === 0) return null;
  for (const event of events) {
    if (event.type !== 'seasonal') continue;
    if (!isEventLive(event, now)) continue;
    if (!isPreferenceEnabled(preferences, event.eligibility?.preferenceKey)) continue;
    return event;
  }
  return null;
}

/**
 * Convenience: pick the currently live weekly event from a list. Mirrors
 * `pickLiveSeasonalEvent` so callers never inline the live-window check.
 */
export function pickLiveWeeklyEvent(
  events: readonly EventDefinition[] | undefined,
  preferences: ExperiencePreferences,
  now: number,
): EventDefinition | null {
  if (!events || events.length === 0) return null;
  if (preferences.weeklyThemes !== true) return null;
  for (const event of events) {
    if (event.type !== 'weekly_theme') continue;
    if (!isEventLive(event, now)) continue;
    // Weekly events carry no preferenceKey in V1, but if one is added we
    // still gate it by opt-in so the same rules apply across kinds.
    if (!isPreferenceEnabled(preferences, event.eligibility?.preferenceKey)) continue;
    return event;
  }
  return null;
}