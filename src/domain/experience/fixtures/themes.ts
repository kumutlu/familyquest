/**
 * Curated theme catalog for the FamilyQuest / Queki engagement engine.
 *
 * This file is the SINGLE source of truth for theme definitions. Components
 * never branch on `if (theme === 'christmas')`; they read the resolved theme
 * and look up its tokens.
 *
 * Adding a new celebration (Diwali, Hanukkah, Lunar New Year, Summer
 * Adventure, New Year…) is a *content addition*: add a `ThemeDefinition`,
 * add an `EventDefinition` that references it, and the resolver does the
 * rest. No component or precedence code changes.
 */

import type { ThemeDefinition } from '../types';

/** Standard everyday look. The default unless an event overrides it. */
export const STANDARD_THEME: ThemeDefinition = Object.freeze({
  id: 'theme.standard',
  name: 'Queki Standard',
  category: 'standard',
  visuals: Object.freeze({
    backgroundToken: 'bg-queki-cream',
    cardToken: 'card-queki-default',
    accentToken: 'accent-queki-indigo',
  }),
  effects: Object.freeze({
    completionEffect: 'confetti.default',
    confettiPreset: 'sparkle.indigo',
  }),
  collection: Object.freeze({ permanentUnlockAvailable: false }) as ThemeDefinition['collection'],
}) as ThemeDefinition;

/**
 * Snow + festive lights + mascot festive hat. Child-friendly.
 * Tokens resolve to documented Tailwind / CSS variable classes; the
 * renderer layer maps tokens like `card-xmas-snow` to real styles.
 */
export const CHRISTMAS_THEME: ThemeDefinition = Object.freeze({
  id: 'theme.christmas',
  name: 'Festive Lights',
  category: 'seasonal',
  visuals: Object.freeze({
    backgroundToken: 'bg-xmas-snow',
    cardToken: 'card-xmas-frost',
    accentToken: 'accent-xmas-holly',
  }),
  effects: Object.freeze({
    completionEffect: 'confetti.snowfall',
    confettiPreset: 'sparkle.festive',
  }),
  mascotCostumeId: 'mascot.santa-hat',
  collection: Object.freeze({
    rarity: 'rare',
    permanentUnlockAvailable: true,
  }) as ThemeDefinition['collection'],
}) as ThemeDefinition;

/**
 * Spooky but child-friendly. Pumpkins + friendly ghost.
 */
export const HALLOWEEN_THEME: ThemeDefinition = Object.freeze({
  id: 'theme.halloween',
  name: 'Friendly Spooks',
  category: 'seasonal',
  visuals: Object.freeze({
    backgroundToken: 'bg-halloween-dusk',
    cardToken: 'card-halloween-pumpkin',
    accentToken: 'accent-halloween-glow',
  }),
  effects: Object.freeze({
    completionEffect: 'confetti.bat-swarm',
    confettiPreset: 'sparkle.glow',
  }),
  mascotCostumeId: 'mascot.witch-hat',
  collection: Object.freeze({
    rarity: 'rare',
    permanentUnlockAvailable: true,
  }) as ThemeDefinition['collection'],
}) as ThemeDefinition;

/**
 * Respectful, neutral visual language: lanterns, stars, moon, family
 * kindness. We deliberately never mint points for worship activities — the
 * engine may simply enable the *theme*; families create their own tasks.
 */
export const RAMADAN_THEME: ThemeDefinition = Object.freeze({
  id: 'theme.ramadan',
  name: 'Lanterns & Stars',
  category: 'seasonal',
  visuals: Object.freeze({
    backgroundToken: 'bg-ramadan-night',
    cardToken: 'card-ramadan-lantern',
    accentToken: 'accent-ramadan-gold',
  }),
  effects: Object.freeze({
    completionEffect: 'confetti.stars',
    confettiPreset: 'sparkle.gold',
  }),
  mascotCostumeId: 'mascot.lantern',
  collection: Object.freeze({
    rarity: 'rare',
    permanentUnlockAvailable: true,
  }) as ThemeDefinition['collection'],
}) as ThemeDefinition;

/**
 * Celebratory family visuals.
 */
export const EID_THEME: ThemeDefinition = Object.freeze({
  id: 'theme.eid',
  name: 'Eid Celebration',
  category: 'seasonal',
  visuals: Object.freeze({
    backgroundToken: 'bg-eid-celebration',
    cardToken: 'card-eid-festive',
    accentToken: 'accent-eid-emerald',
  }),
  effects: Object.freeze({
    completionEffect: 'confetti.fireworks',
    confettiPreset: 'sparkle.emerald',
  }),
  mascotCostumeId: 'mascot.festive-robe',
  collection: Object.freeze({
    rarity: 'rare',
    permanentUnlockAvailable: true,
  }) as ThemeDefinition['collection'],
}) as ThemeDefinition;

/** A rotating weekly accent. Resolves above base, below seasonal. */
export const NEON_WEEK_THEME: ThemeDefinition = Object.freeze({
  id: 'theme.weekly.neon',
  name: 'Neon Week',
  category: 'weekly',
  visuals: Object.freeze({
    backgroundToken: 'bg-neon-night',
    cardToken: 'card-neon-pulse',
    accentToken: 'accent-neon-cyan',
  }),
  effects: Object.freeze({
    completionEffect: 'confetti.neon',
    confettiPreset: 'sparkle.cyan',
  }),
  collection: Object.freeze({
    rarity: 'common',
    permanentUnlockAvailable: false,
  }) as ThemeDefinition['collection'],
}) as ThemeDefinition;

/**
 * The full theme catalog. Pure data — no behaviour. Keep the array
 * `as const`-compatible by using the explicit ThemeDefinition type.
 */
export const THEME_CATALOG: readonly ThemeDefinition[] = Object.freeze([
  STANDARD_THEME,
  CHRISTMAS_THEME,
  HALLOWEEN_THEME,
  RAMADAN_THEME,
  EID_THEME,
  NEON_WEEK_THEME,
]);

/** Look up a theme by id. Returns `undefined` when unknown. */
export function getThemeById(id: string | undefined | null): ThemeDefinition | undefined {
  if (typeof id !== 'string' || id.length === 0) return undefined;
  return THEME_CATALOG.find((theme) => theme.id === id);
}

/** The default base theme every family sees when nothing else applies. */
export function getBaseTheme(): ThemeDefinition {
  return STANDARD_THEME;
}