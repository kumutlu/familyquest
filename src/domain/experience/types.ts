/**
 * FamilyQuest / Queki — Engagement + Theme Engine (V1).
 *
 * Archetype
 * ----------
 * This module is the **engagement** side of the platform. It NEVER awards points,
 * XP, or wallet balance. Its only job is to describe *what is currently happening*
 * in the family's world — a quiet base look, a rotating weekly accent, or a
 * seasonal celebration — so the gamification engine can decide whether any value
 * is earned.
 *
 * "Engagement creates opportunities; Gamification awards value."
 *
 * Architectural rules (audit checklist)
 * -------------------------------------
 *  1. No write paths to authoritative XP / points / wallet collections.
 *  2. No Firestore Rules changes — this is a read-mostly schema.
 *  3. One resolver. One hook. Components consume the resolved theme, not the
 *     events directly, so precedence cannot drift across screens.
 *  4. Unknown / expired / disabled / future events fail safe to the base theme.
 *  5. Future event ids (Diwali, Hanukkah, etc.) require NO schema redesign —
 *     `EventDefinition.id` is the catalog key, `EventDefinition.preferenceKey`
 *     is the per-family opt-in key.
 */

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Engagement events are scheduled windows that change the family experience.
 * This is intentionally a *tiny* taxonomy — adding a new celebration
 * (Diwali, Hanukkah, Summer Adventure, New Year) is a content addition, not
 * a code change. New event kinds belong in {@link EventType}, not in code.
 */
export type EventType =
  | 'weekly_theme'
  | 'seasonal'
  | 'family_challenge'
  | 'special'
  // 'surge' reuses the generic event window/engagement infrastructure
  // for time-bounded bonus opportunities. The reward authority lives in
  // the Surge domain module; the Experience Engine NEVER awards bonuses.
  | 'surge';

/**
 * Lifecycle of a scheduled event. Authoritative events are written by future
 * scheduling tooling with one of these states; `draft` and `scheduled` are
 * never resolved into an active theme.
 */
export type EventStatus = 'draft' | 'scheduled' | 'active' | 'ended';

/**
 * A neutral, opt-in key. Families choose which celebrations appear in their
 * world. The keys are deliberately *not* the names of religions — a Diwali
 * preference means "we celebrate this at home", not "we are Hindu".
 *
 * Keys are open-ended: new celebrations register a new key and the resolver
 * accepts them automatically.
 */
export type ExperiencePreferenceKey = string;

/**
 * Per-family opt-in preferences. The shape is open by design: new
 * preferences are added under `seasonalEvents` without a schema migration.
 */
export interface ExperiencePreferences {
  /** Master toggle for the rotating weekly accent. */
  weeklyThemes: boolean;
  /**
   * Opt-in map for named celebrations. Unknown keys resolve to `false`,
   * which means an unknown preference cannot accidentally enable an event.
   */
  seasonalEvents: Record<ExperiencePreferenceKey, boolean>;
}

/**
 * A single scheduled event. Lives in `families/{familyId}/events/{eventId}` in
 * future, but for V1 we resolve purely from a static catalog + a family-level
 * "currently active" pointer so the engine has zero write surface.
 */
export interface EventDefinition {
  /** Stable catalog key. Used as Firestore document id and as the catalog lookup. */
  id: string;
  /** Engagement category. */
  type: EventType;
  /** Human-readable name shown in parent-facing UI. */
  name: string;
  /**
   * Inclusive start instant (epoch ms). Compared with `now` using the
   * supplied `clock.now()` so tests are deterministic.
   */
  startsAt: number;
  /** Exclusive end instant (epoch ms). */
  endsAt: number;
  /** Theme that this event renders, resolved through the theme catalog. */
  themeId?: string;
  /**
   * Cosmetic identifiers granted by this event for the duration. Used for
   * future inventory integration — see `InventoryReference`.
   */
  collectibles?: string[];
  /**
   * Optional eligibility — e.g. opt-in preference key. The resolver treats
   * any missing or unrecognised preference key as opt-in neutral (test
   * surfaces can override this).
   */
  eligibility?: {
    /** If set, the family must have this preference enabled. */
    preferenceKey?: ExperiencePreferenceKey;
  };
  /** Lifecycle status. Only `active` is ever resolved. */
  status: EventStatus;
}

/* -------------------------------------------------------------------------- */
/* Themes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Themes are visual *contexts*, not Tailwind colour swaps. A theme is a
 * structured bundle that progressively supports backgrounds, cards, accents,
 * completion effects, confetti presets, avatar frames, sound packs, and
 * mascot costume references. The resolver returns one of these; components
 * consume it instead of branching on `if (theme === 'christmas')`.
 */
export type ThemeCategory = 'weekly' | 'seasonal' | 'standard';

/** Rarity used by future inventory / shop work. Today: display-only. */
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface ThemeVisuals {
  /**
   * Token that maps to a documented CSS / Tailwind variable, e.g.
   * `'bg-snow'`, `'bg-cream'`. Renderers should look the token up, never
   * branch on theme identity.
   */
  backgroundToken: string;
  cardToken: string;
  accentToken: string;
}

export interface ThemeEffects {
  completionEffect?: string;
  confettiPreset?: string;
}

export interface ThemeCollection {
  rarity?: Rarity;
  /**
   * When true, the theme becomes a permanent collectible once acquired
   * during the event window. The engine never mints items here; it merely
   * advertises the *contract* so a future inventory write can match it.
   */
  permanentUnlockAvailable?: boolean;
}

/**
 * A theme definition. Lives in `src/domain/experience/fixtures/themes.ts`
 * for V1. Themes are NEVER hard-coded into components — components read the
 * resolved theme bundle and look up its tokens.
 */
export interface ThemeDefinition {
  id: string;
  name: string;
  category: ThemeCategory;
  visuals: ThemeVisuals;
  effects?: ThemeEffects;
  /** Optional mascot costume reference. */
  mascotCostumeId?: string;
  collection?: Record<string, unknown> & ThemeCollection;
}

/* -------------------------------------------------------------------------- */
/* Inventory compatibility                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Future-facing inventory item reference. The engine NEVER writes these; it
 * only describes what *would* be owned. When the inventory subsystem ships,
 * callers will hydrate `InventoryReference` from `users/{uid}/inventory/{itemId}`.
 *
 * `type === 'theme'` items can be equipped to override any active event.
 */
export type InventoryItemType = 'theme' | 'frame' | 'badge' | 'effect';
export type InventoryItemSource = 'event' | 'purchase' | 'achievement';

export interface InventoryReference {
  itemId: string;
  type: InventoryItemType;
  source: InventoryItemSource;
  /** Optional reference back to the originating event. */
  eventId?: string;
  rarity?: Rarity;
  acquiredAt: number;
}

/**
 * The equipped/owned theme id chosen by a child. Resolves above every event
 * precedence layer so a child can pin a favourite holiday year-round.
 *
 * V1 is read-only: we model the slot but no UI writes to it yet.
 */
export interface EquippedCustomisation {
  themeId?: string;
  frameId?: string;
  badgeId?: string;
}

/* -------------------------------------------------------------------------- */
/* Resolver inputs                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Everything the resolver needs in one shape. The hook hides Firestore and
 * Zustand wiring behind a single props bag, so unit tests can call the
 * resolver with literal data and assert precedence behaviour.
 */
export interface ResolveExperienceThemeInput {
  /** Always provided. */
  baseTheme: ThemeDefinition;
  /**
   * The currently active weekly-theme event, if any. Already filtered by
   * status + window + preference at the hook boundary.
   */
  weeklyEvent?: EventDefinition | null;
  /**
   * The currently active seasonal event, if any. Already filtered. The
   * resolver still re-checks eligibility because the call site may pass a
   * permissive event and rely on the resolver as the single source of truth.
   */
  seasonalEvent?: EventDefinition | null;
  /** Child-owned/equipped cosmetic override. Wins when present. */
  equipped?: EquippedCustomisation | null;
  /**
   * Family preference snapshot. Used to enforce the opt-in gate even when
   * the event document itself was filtered upstream.
   */
  preferences: ExperiencePreferences;
  /** Clock injected for deterministic window checks (epoch ms). */
  now: number;
  /** Theme catalog used to look up referenced themeIds. */
  themes: readonly ThemeDefinition[];
}

/**
 * What the resolver returns. `source` makes the precedence layer observable
 * for debugging, analytics, and tests — never display it raw.
 */
export interface ResolvedExperienceTheme {
  theme: ThemeDefinition;
  source:
    | 'base'
    | 'weekly'
    | 'seasonal'
    | 'equipped'
    | 'seasonal-pref-disabled'
    | 'weekly-pref-disabled'
    | 'unknown-event-theme';
  /**
   * Human-readable event name when the resolution path passed through an
   * event. `null` when the base theme was used.
   */
  appliedEventName: string | null;
}

/* -------------------------------------------------------------------------- */
/* Defaults                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Default family preferences. New families opt in to nothing by default;
 * the UI must explicitly ask "Which celebrations would you like to appear
 * in your family's world?". This is the only place the defaults are owned.
 */
export const DEFAULT_EXPERIENCE_PREFERENCES: ExperiencePreferences = Object.freeze({
  weeklyThemes: true,
  seasonalEvents: Object.freeze({}) as Record<ExperiencePreferenceKey, boolean>,
}) as ExperiencePreferences;

/**
 * Defence-in-depth: build a preferences object that always has both
 * required keys. Used by the hook before passing into the resolver so a
 * missing/partial Firestore field never causes `preferenceKey === undefined`
 * to silently disable an event.
 */
export function normaliseExperiencePreferences(
  raw: Partial<ExperiencePreferences> | null | undefined,
): ExperiencePreferences {
  const seasonal = (raw?.seasonalEvents ?? {}) as Record<ExperiencePreferenceKey, boolean>;
  return Object.freeze({
    weeklyThemes: raw?.weeklyThemes ?? DEFAULT_EXPERIENCE_PREFERENCES.weeklyThemes,
    seasonalEvents: Object.freeze({ ...seasonal }) as Record<ExperiencePreferenceKey, boolean>,
  }) as ExperiencePreferences;
}