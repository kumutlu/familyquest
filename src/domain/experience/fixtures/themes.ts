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
import {
  CALM_PERSONALITY,
  NEON_ARCADE_PERSONALITY,
  SPACE_PERSONALITY,
} from './themePersonalities';

/**
 * Theme token values — real CSS values (colours / opacity numbers) the
 * shell cascades as `--qk-theme-*` custom properties. Keys mirror the
 * world palette vocabulary (ambient gradient + accent) so a theme and
 * its world read as one coherent visual personality.
 *
 * These values must stay presentation-only. They never encode eligibility
 * or ownership; the shop and the resolver own those decisions.
 */
export interface ThemeTokens {
  /** Chip / highlight accent used by the pattern layer + mascot halo. */
  accent: string;
  /** Soft accent tint applied mid-gradient (falls through to accent). */
  accentSoft?: string;
  /** Ambient gradient top stop. */
  ambientFrom: string;
  /** Ambient gradient bottom stop. */
  ambientTo: string;
  /** Pattern density 0..1 — 0 keeps the base world calm. */
  patternDensity?: number;
}

/**
 * Validate raw theme tokens from an untrusted document shape. Returns a
 * fully-formed token bundle when every required field is present and of
 * the right primitive type, otherwise `undefined` so callers fail safe
 * to the default theme instead of rendering a broken world.
 */
export function validThemeTokens(raw: unknown): ThemeTokens | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const tokens = raw as Record<string, unknown>;
  const isColour = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= 64;
  if (!isColour(tokens.accent) || !isColour(tokens.ambientFrom) || !isColour(tokens.ambientTo)) {
    return undefined;
  }
  const accentSoft = isColour(tokens.accentSoft) ? tokens.accentSoft : undefined;
  const density = typeof tokens.patternDensity === 'number' && Number.isFinite(tokens.patternDensity)
    ? Math.min(1, Math.max(0, tokens.patternDensity))
    : undefined;
  return {
    accent: tokens.accent,
    accentSoft,
    ambientFrom: tokens.ambientFrom,
    ambientTo: tokens.ambientTo,
    patternDensity: density,
  };
}

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
  tokens: Object.freeze({
    accent: '#7c3aed',
    accentSoft: 'rgba(124, 58, 237, 0.10)',
    ambientFrom: '#f5f3fb',
    ambientTo: '#ffffff',
    patternDensity: 0,
  }) as ThemeDefinition['tokens'],
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
  tokens: Object.freeze({
    accent: '#dc2626',
    accentSoft: 'rgba(248, 113, 113, 0.18)',
    ambientFrom: '#7f1d1d',
    ambientTo: '#fff7ed',
    patternDensity: 0.32,
  }) as ThemeDefinition['tokens'],
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
  tokens: Object.freeze({
    accent: '#7c3aed',
    accentSoft: 'rgba(167, 139, 250, 0.18)',
    ambientFrom: '#1f2937',
    ambientTo: '#fde68a',
    patternDensity: 0.30,
  }) as ThemeDefinition['tokens'],
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
  tokens: Object.freeze({
    accent: '#0d9488',
    accentSoft: 'rgba(20, 184, 166, 0.18)',
    ambientFrom: '#0b1530',
    ambientTo: '#fefce8',
    patternDensity: 0.30,
  }) as ThemeDefinition['tokens'],
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
  tokens: Object.freeze({
    accent: '#047857',
    accentSoft: 'rgba(16, 185, 129, 0.18)',
    ambientFrom: '#0e1f3a',
    ambientTo: '#fffbe6',
    patternDensity: 0.30,
  }) as ThemeDefinition['tokens'],
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
  tokens: Object.freeze({
    accent: '#06b6d4',
    accentSoft: 'rgba(34, 211, 238, 0.18)',
    ambientFrom: '#0f172a',
    ambientTo: '#1e1b4b',
    patternDensity: 0.35,
  }) as ThemeDefinition['tokens'],
  effects: Object.freeze({
    completionEffect: 'confetti.neon',
    confettiPreset: 'sparkle.cyan',
  }),
  collection: Object.freeze({
    rarity: 'common',
    permanentUnlockAvailable: false,
  }) as ThemeDefinition['collection'],
}) as ThemeDefinition;

/* -------------------------------------------------------------------------- */
/* Shop themes — purchasable / Theme-of-the-Week candidates                   */
/* -------------------------------------------------------------------------- */

/**
 * Shop themes are the child Theme Shop's purchasable catalogue. They are
 * permanently-owned cosmetics bought with rewardPoints; the Theme of the
 * Week promotion can temporarily unlock one of them for free.
 *
 * IDs are stable content keys (`theme.shop.*`) — they appear in Firestore
 * purchase records and must never be renamed. `shopItemId` ties each theme
 * to its canonical `families/{familyId}/themes/{shopItemId}` document.
 */
export const SPACE_THEME: ThemeDefinition = Object.freeze({
  id: 'theme.shop.space',
  name: 'Space Explorer',
  category: 'standard',
  shopItemId: 'space',
  visuals: Object.freeze({
    backgroundToken: 'bg-shop-space',
    cardToken: 'card-shop-space',
    accentToken: 'accent-shop-space',
  }),
  tokens: Object.freeze({
    accent: '#4f46e5',
    accentSoft: 'rgba(79, 70, 229, 0.12)',
    ambientFrom: '#0b1026',
    ambientTo: '#1e1b4b',
    patternDensity: 0.30,
  }) as ThemeDefinition['tokens'],
  effects: Object.freeze({
    completionEffect: 'confetti.stars',
    confettiPreset: 'sparkle.indigo',
  }),
  personality: SPACE_PERSONALITY as ThemeDefinition['personality'],
  collection: Object.freeze({
    rarity: 'epic',
    permanentUnlockAvailable: true,
  }) as ThemeDefinition['collection'],
}) as ThemeDefinition;

export const RAINBOW_THEME: ThemeDefinition = Object.freeze({
  id: 'theme.shop.rainbow',
  name: 'Rainbow Pop',
  category: 'standard',
  shopItemId: 'rainbow',
  visuals: Object.freeze({
    backgroundToken: 'bg-shop-rainbow',
    cardToken: 'card-shop-rainbow',
    accentToken: 'accent-shop-rainbow',
  }),
  tokens: Object.freeze({
    accent: '#d946ef',
    accentSoft: 'rgba(217, 70, 239, 0.10)',
    ambientFrom: '#fdf4ff',
    ambientTo: '#ffffff',
    patternDensity: 0.26,
  }) as ThemeDefinition['tokens'],
  effects: Object.freeze({
    completionEffect: 'confetti.default',
    confettiPreset: 'sparkle.festive',
  }),
  collection: Object.freeze({
    rarity: 'rare',
    permanentUnlockAvailable: true,
  }) as ThemeDefinition['collection'],
}) as ThemeDefinition;

export const PIXEL_THEME: ThemeDefinition = Object.freeze({
  id: 'theme.shop.pixel',
  name: 'Pixel Quest',
  category: 'standard',
  shopItemId: 'pixel',
  visuals: Object.freeze({
    backgroundToken: 'bg-shop-pixel',
    cardToken: 'card-shop-pixel',
    accentToken: 'accent-shop-pixel',
  }),
  tokens: Object.freeze({
    accent: '#16a34a',
    accentSoft: 'rgba(22, 163, 74, 0.10)',
    ambientFrom: '#0d1f14',
    ambientTo: '#14532d',
    patternDensity: 0.28,
  }) as ThemeDefinition['tokens'],
  effects: Object.freeze({
    completionEffect: 'confetti.default',
    confettiPreset: 'sparkle.emerald',
  }),
  collection: Object.freeze({
    rarity: 'rare',
    permanentUnlockAvailable: true,
  }) as ThemeDefinition['collection'],
}) as ThemeDefinition;

export const CALM_THEME: ThemeDefinition = Object.freeze({
  id: 'theme.shop.calm',
  name: 'Calm Pastel',
  category: 'standard',
  shopItemId: 'calm',
  visuals: Object.freeze({
    backgroundToken: 'bg-shop-calm',
    cardToken: 'card-shop-calm',
    accentToken: 'accent-shop-calm',
  }),
  tokens: Object.freeze({
    accent: '#0d9488',
    accentSoft: 'rgba(13, 148, 136, 0.08)',
    ambientFrom: '#fbf7f4',
    ambientTo: '#ffffff',
    patternDensity: 0,
  }) as ThemeDefinition['tokens'],
  effects: Object.freeze({
    completionEffect: 'confetti.default',
    confettiPreset: 'sparkle.indigo',
  }),
  personality: CALM_PERSONALITY as ThemeDefinition['personality'],
  collection: Object.freeze({
    rarity: 'common',
    permanentUnlockAvailable: true,
  }) as ThemeDefinition['collection'],
}) as ThemeDefinition;

/**
 * Neon Arcade — the always-on purchasable version of the weekly neon
 * world. Distinct id from `theme.weekly.neon` so the promotion and the
 * permanent purchase never collide: a child who bought Neon keeps it
 * after the weekly event window ends.
 */
export const NEON_ARCADE_THEME: ThemeDefinition = Object.freeze({
  id: 'theme.shop.neon',
  name: 'Neon Arcade',
  category: 'standard',
  shopItemId: 'neon',
  visuals: Object.freeze({
    backgroundToken: 'bg-shop-neon',
    cardToken: 'card-shop-neon',
    accentToken: 'accent-shop-neon',
  }),
  tokens: Object.freeze({
    accent: '#22d3ee',
    accentSoft: 'rgba(34, 211, 238, 0.20)',
    ambientFrom: '#0f172a',
    ambientTo: '#1e1b4b',
    patternDensity: 0.32,
  }) as ThemeDefinition['tokens'],
  effects: Object.freeze({
    completionEffect: 'confetti.neon',
    confettiPreset: 'sparkle.cyan',
  }),
  personality: NEON_ARCADE_PERSONALITY as ThemeDefinition['personality'],
  collection: Object.freeze({
    rarity: 'epic',
    permanentUnlockAvailable: true,
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
  SPACE_THEME,
  RAINBOW_THEME,
  PIXEL_THEME,
  CALM_THEME,
  NEON_ARCADE_THEME,
]);

/**
 * Shop item ids in display order (Classic is intentionally absent — it is
 * the default and never purchasable). These are the canonical
 * `families/{familyId}/themes/{shopItemId}` document ids, NOT theme ids.
 */
export const SHOP_THEME_IDS: readonly string[] = Object.freeze([
  'neon',
  'space',
  'rainbow',
  'pixel',
  'calm',
]);

/**
 * Look up a shop theme by its canonical shop item id. Returns `undefined`
 * for unknown / non-shop ids.
 */
export function getShopThemeByItemId(shopItemId: string | null | undefined): ThemeDefinition | undefined {
  if (typeof shopItemId !== 'string' || shopItemId.length === 0) return undefined;
  const match = THEME_CATALOG.find((theme) => theme.shopItemId === shopItemId);
  return match && match.id.startsWith('theme.shop.') ? match : undefined;
}

/**
 * Built-in shop defaults — the authoritative fallback prices when a family
 * has no explicit `families/{familyId}/themes/{shopItemId}` catalog row.
 *
 * These values MUST stay in sync with `themeCatalogPrice()` in
 * firestore.rules (a unit test pins the parity). A parent-published row
 * overrides the price without a code deployment.
 */
export const DEFAULT_SHOP_PRICES: Readonly<Record<string, number>> = Object.freeze({
  neon: 500,
  space: 500,
  rainbow: 300,
  pixel: 300,
  calm: 300,
});

/** Built-in canonical theme id for a shop item (mirrors the rules fallback). */
export function defaultShopThemeId(shopItemId: string): string {
  return `theme.shop.${shopItemId}`;
}

/** Look up a theme by id. Returns `undefined` when unknown. */
export function getThemeById(id: string | undefined | null): ThemeDefinition | undefined {
  if (typeof id !== 'string' || id.length === 0) return undefined;
  return THEME_CATALOG.find((theme) => theme.id === id);
}

/** The default base theme every family sees when nothing else applies. */
export function getBaseTheme(): ThemeDefinition {
  return STANDARD_THEME;
}