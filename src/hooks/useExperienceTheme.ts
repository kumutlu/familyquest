/**
 * React hook for the FamilyQuest / Queki engagement engine.
 *
 * The hook is the ONLY place that turns Firestore / store inputs into a
 * `ResolvedExperienceTheme`. Components consume the resolved bundle.
 *
 * V1 sources:
 *   - Static theme + event catalog from `src/domain/experience/fixtures/*`
 *   - `now()` is `Date.now()`; tests inject deterministic clocks via
 *     `setExperienceClock` or by calling the resolver directly.
 *   - Family preferences and the equipped slot are pulled from a tiny
 *     local store so the resolver has zero external wiring.
 *
 * THEME SHOP layer: the child's profile `theme` field equips a theme
 * above events (a child's explicit choice wins), but only when they have
 * the RIGHT to use it — owned shop theme, the live Theme of the Week, or
 * the default. A promotion that has ended safely falls back to the
 * default theme; ownership is never affected. Local storage mirrors the
 * last known-good value so reloads and PWA relaunches render the right
 * world immediately without a Firestore round-trip.
 *
 * ARCHITECTURE GATE: this module must never import firebase or zustand.
 * The store-facing equip-rights bridge lives in `useChildThemeRights`
 * and is composed in below, so the engine stays pure and the pinned
 * source audit (`resolver.test.ts`) keeps passing.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { useChildThemeRights } from './useChildThemeRights';
import {
  DEFAULT_EXPERIENCE_PREFERENCES,
  EVENT_CATALOG,
  STANDARD_THEME,
  THEME_CATALOG,
  getBaseTheme,
  normaliseExperiencePreferences,
  pickLiveSeasonalEvent,
  pickLiveWeeklyEvent,
  resolveExperienceTheme,
  type EquippedCustomisation,
  type ExperiencePreferences,
  type ResolvedExperienceTheme,
  type ThemeDefinition,
} from '../domain/experience';

/* -------------------------------------------------------------------------- */
/* Clock injection (deterministic tests)                                      */
/* -------------------------------------------------------------------------- */

let clock: () => number = () => Date.now();

/**
 * Replace the hook's clock. Tests use this so `now` is stable.
 *
 * Returns a disposer so the test can restore the production clock.
 */
export function setExperienceClock(override: () => number): () => void {
  const previous = clock;
  clock = override;
  return () => {
    clock = previous;
  };
}

/* -------------------------------------------------------------------------- */
/* Family preferences store (minimal)                                         */
/* -------------------------------------------------------------------------- */

interface PreferencesState {
  preferences: ExperiencePreferences;
  listeners: Set<() => void>;
  setPreferences(next: ExperiencePreferences): void;
}

const preferencesState: PreferencesState = {
  preferences: DEFAULT_EXPERIENCE_PREFERENCES,
  listeners: new Set<() => void>(),
  setPreferences(next) {
    preferencesState.preferences = normaliseExperiencePreferences(next);
    for (const listener of preferencesState.listeners) listener();
  },
};

function subscribePreferences(listener: () => void): () => void {
  preferencesState.listeners.add(listener);
  return () => {
    preferencesState.listeners.delete(listener);
  };
}

function getPreferencesSnapshot(): ExperiencePreferences {
  return preferencesState.preferences;
}

function getServerPreferencesSnapshot(): ExperiencePreferences {
  return preferencesState.preferences;
}

/* -------------------------------------------------------------------------- */
/* Equipped customisation store (minimal)                                     */
/* -------------------------------------------------------------------------- */

interface EquippedState {
  equipped: EquippedCustomisation;
  listeners: Set<() => void>;
  setEquipped(next: EquippedCustomisation): void;
}

const equippedState: EquippedState = {
  equipped: Object.freeze({}) as EquippedCustomisation,
  listeners: new Set<() => void>(),
  setEquipped(next) {
    equippedState.equipped = Object.freeze({ ...next }) as EquippedCustomisation;
    for (const listener of equippedState.listeners) listener();
  },
};

function subscribeEquipped(listener: () => void): () => void {
  equippedState.listeners.add(listener);
  return () => {
    equippedState.listeners.delete(listener);
  };
}

function getEquippedSnapshot(): EquippedCustomisation {
  return equippedState.equipped;
}

function getServerEquippedSnapshot(): EquippedCustomisation {
  return equippedState.equipped;
}

/* -------------------------------------------------------------------------- */
/* Public hooks                                                               */
/* -------------------------------------------------------------------------- */

export interface UseExperienceThemeResult {
  /** The theme bundle every component should consume. */
  theme: ThemeDefinition;
  /** Where the theme came from. Diagnostic — never display raw. */
  source: ResolvedExperienceTheme['source'];
  /** Event name when one shaped the resolution, otherwise null. */
  appliedEventName: string | null;
  /** Live weekly event, if any. */
  weeklyEvent: ReturnType<typeof pickLiveWeeklyEvent>;
  /** Live seasonal event, if any. */
  seasonalEvent: ReturnType<typeof pickLiveSeasonalEvent>;
  /** The base theme (for fallbacks and edge rendering). */
  baseTheme: ThemeDefinition;
  /** The full theme catalog (read-only snapshot). */
  themes: readonly ThemeDefinition[];
}

/**
 * Resolve the family's effective experience theme.
 *
 * Components call this hook and consume the returned `theme`. They must
 * NOT reimplement precedence locally.
 */
export function useExperienceTheme(): UseExperienceThemeResult {
  const preferences = useSyncExternalStore(
    subscribePreferences,
    getPreferencesSnapshot,
    getServerPreferencesSnapshot,
  );
  const equipped = useSyncExternalStore(
    subscribeEquipped,
    getEquippedSnapshot,
    getServerEquippedSnapshot,
  );
  // Equip-rights bridge: turns the child's persisted choice, purchases
  // and the live promotion into an equipped slot value. It returns a
  // STABLE empty object when the child has no right to equip anything,
  // in which case the resolver keeps the seam state (direct callers and
  // tests may still equip through `setEquippedCustomisation`).
  const rightsEquipped = useChildThemeRights(clock(), setEquippedCustomisation);

  return useMemo(() => {
    const now = clock();
    const seasonalEvent = pickLiveSeasonalEvent(EVENT_CATALOG, preferences, now);
    const weeklyEvent = pickLiveWeeklyEvent(EVENT_CATALOG, preferences, now);
    const bridgeActive = Object.keys(rightsEquipped).length > 0;
    const resolved = resolveExperienceTheme({
      baseTheme: getBaseTheme(),
      weeklyEvent,
      seasonalEvent,
      equipped: bridgeActive ? rightsEquipped : equipped,
      preferences,
      now,
      themes: THEME_CATALOG,
    });
    return {
      theme: resolved.theme,
      source: resolved.source,
      appliedEventName: resolved.appliedEventName,
      weeklyEvent,
      seasonalEvent,
      baseTheme: STANDARD_THEME,
      themes: THEME_CATALOG,
    } as UseExperienceThemeResult;
  }, [preferences, equipped, rightsEquipped]);
}

/**
 * Imperatively update the family preferences used by the resolver.
 *
 * Used by future parent-facing settings UI. Tests call this directly to
 * simulate opt-in / opt-out without going through Firestore.
 */
export function setExperiencePreferences(next: ExperiencePreferences): void {
  preferencesState.setPreferences(next);
}

/**
 * Imperatively update the equipped customisation slot. Used by future
 * child-facing equip UI; tests call this directly.
 */
export function setEquippedCustomisation(next: EquippedCustomisation): void {
  equippedState.setEquipped(next);
}

/* -------------------------------------------------------------------------- */
/* Test helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Reset every test seam to the production defaults. */
export function resetExperienceState(): void {
  preferencesState.preferences = DEFAULT_EXPERIENCE_PREFERENCES;
  equippedState.equipped = Object.freeze({}) as EquippedCustomisation;
  clock = () => Date.now();
}