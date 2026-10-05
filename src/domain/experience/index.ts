/**
 * Public surface of the Experience / Theme Engine.
 *
 * Anything that wants to participate in family experiences imports from
 * here. Components never reach into fixtures directly — they read the
 * resolved theme through `useExperienceTheme`.
 */

export type {
  EventDefinition,
  EventType,
  EventStatus,
  ExperiencePreferenceKey,
  ExperiencePreferences,
  ThemeDefinition,
  ThemeCategory,
  ThemeVisuals,
  ThemeEffects,
  ThemeTokens,
  ThemeCollection,
  Rarity,
  InventoryReference,
  InventoryItemType,
  InventoryItemSource,
  EquippedCustomisation,
  ResolveExperienceThemeInput,
  ResolvedExperienceTheme,
} from './types';

export {
  DEFAULT_EXPERIENCE_PREFERENCES,
  normaliseExperiencePreferences,
} from './types';

export {
  isEventLive,
  isPreferenceEnabled,
  pickLiveSeasonalEvent,
  pickLiveWeeklyEvent,
  resolveExperienceTheme,
} from './resolver';

export {
  THEME_ID_TO_PLATE_ID,
  getThemePlate,
} from './themePlate';

export type {
  ThemePersonality,
  ThemeShadow,
  ThemeBorderStyle,
  ThemePattern,
  ThemeProgressTrack,
  ThemeProgressEffect,
  ThemeSurfaceScheme,
} from './themePersonality';

export {
  NEUTRAL_PERSONALITY,
  validThemePersonality,
  themePersonalityCustomProperties,
  themePersonalityAttributes,
  PERSONALITY_CUSTOM_PROPERTIES,
  PERSONALITY_ATTRIBUTES,
} from './themePersonality';

export {
  DEFAULT_SHOP_PERSONALITY,
  NEON_ARCADE_PERSONALITY,
  SPACE_PERSONALITY,
  CALM_PERSONALITY,
  SHOP_THEME_PERSONALITY,
} from './fixtures/themePersonalities';

export {
  THEME_CATALOG,
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
  SHOP_THEME_IDS,
  DEFAULT_SHOP_PRICES,
  getShopThemeByItemId,
  defaultShopThemeId,
  validThemeTokens,
  getThemeById,
  getBaseTheme,
} from './fixtures/themes';

export {
  EVENT_CATALOG,
  CHRISTMAS_EVENT_2026,
  HALLOWEEN_EVENT_2026,
  RAMADAN_EVENT_2026,
  EID_EVENT_2026,
  NEON_WEEK_EVENT,
  getEventById,
} from './fixtures/events';