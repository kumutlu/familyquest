/**
 * Smart Notifications V1 — family-level notification preferences.
 *
 * Architectural law:
 *   Engagement Engine decides whether something is worth surfacing.
 *   Notification Engine decides whether, when, and how to deliver it.
 *   Gamification Engine remains the only authority that awards value.
 *
 * This file owns the TYPE contract for family-level preferences. The
 * Firestore Rules validator (`isValidNotificationPreferences`,
 * mirrored from this shape) enforces the closed-key boundary on write
 * so a malicious parent cannot stash random data into a field that the
 * client engine reads. New keys must be added explicitly here AND in
 * the Rules validator.
 *
 * `intensity` is the only knob that drives `maxPerDay`. We never store
 * `maxPerDay` as a derived numeric — it is computed by
 * `intensityToMaxPerDay(intensity)` in `resolver.ts` so a client cannot
 * smuggle a higher cap.
 *
 * Defaults match the authoritative product default (intensity='high',
 * quietHours 20:30→07:00) BUT per rollout policy §28 the rolled-out
 * default for existing families with no explicit preference is
 * `enabled=false`. `DEFAULT_NOTIFICATION_PREFERENCES` therefore
 * deliberately carries `enabled=false`. Parent opt-in flips it.
 */

export type NotificationIntensity = 'off' | 'low' | 'normal' | 'high'

export interface QuietHours {
  /** HH:mm in family-local time. */
  readonly start: string
  /** HH:mm in family-local time. */
  readonly end: string
}

// WeatherLocation is defined in ./types and re-imported here so this
// module can reference it in its interfaces without re-defining it.
// The canonical shape is owned by ./types.
import type { WeatherLocation } from './types'
export type { WeatherLocation }

export interface NotificationPreferences {
  /** Master opt-in. Parent-controlled. */
  readonly enabled: boolean
  /** Drives `maxPerDay` via the resolver. */
  readonly intensity: NotificationIntensity
  readonly quietHours: QuietHours
  readonly morningBrief: boolean
  readonly weather: boolean
  readonly questReminders: boolean
  readonly surgeAlerts: boolean
  readonly streakAlerts: boolean
  readonly familyProgress: boolean
  readonly seasonalEvents: boolean
  readonly weatherLocation?: WeatherLocation
}

/** Rollout-safe default for families with no explicit preference.
 *  Matches spec §28 ("Notifications remain disabled until parent opts
 *  in"). The author-favoured product default (intensity='high', max 3
 *  per day, etc.) is reconstructed only once a parent opts in. */
export const ROLLOUT_DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = Object.freeze({
  enabled: false,
  intensity: 'high',
  quietHours: { start: '20:30', end: '07:00' },
  morningBrief: true,
  weather: true,
  questReminders: true,
  surgeAlerts: true,
  streakAlerts: true,
  familyProgress: true,
  seasonalEvents: true,
}) as NotificationPreferences

/** Product spec author defaults. Applied on explicit parent opt-in. */
export const PRODUCT_DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = Object.freeze({
  enabled: true,
  intensity: 'high',
  quietHours: { start: '20:30', end: '07:00' },
  morningBrief: true,
  weather: true,
  questReminders: true,
  surgeAlerts: true,
  streakAlerts: true,
  familyProgress: true,
  seasonalEvents: true,
}) as NotificationPreferences

const VALID_INTENSITIES: readonly NotificationIntensity[] = ['off', 'low', 'normal', 'high']

function isHHmm(value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return false
  return true
}

function isValidQuietHours(value: unknown): value is QuietHours {
  if (!value || typeof value !== 'object') return false
  const q = value as { start?: unknown; end?: unknown }
  return isHHmm(q.start) && isHHmm(q.end)
}

function isValidWeatherLocation(value: unknown): value is WeatherLocation {
  if (!value || typeof value !== 'object') return false
  const w = value as {
    countryCode?: unknown
    postalArea?: unknown
    city?: unknown
    timezone?: unknown
  }
  if (typeof w.countryCode !== 'string' || w.countryCode.length === 0 || w.countryCode.length > 8) return false
  if (typeof w.timezone !== 'string' || w.timezone.length === 0) return false
  if (w.postalArea !== undefined && (typeof w.postalArea !== 'string' || w.postalArea.length > 24)) return false
  if (w.city !== undefined && (typeof w.city !== 'string' || w.city.length > 80)) return false
  return true
}

/** Closed-shape validator (client-side mirror of Rules). */
export function isValidNotificationPreferences(value: unknown): value is NotificationPreferences {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v.enabled !== 'boolean') return false
  if (typeof v.intensity !== 'string' || !VALID_INTENSITIES.includes(v.intensity as NotificationIntensity)) return false
  if (!isValidQuietHours(v.quietHours)) return false
  for (const k of ['morningBrief', 'weather', 'questReminders', 'surgeAlerts', 'streakAlerts', 'familyProgress', 'seasonalEvents'] as const) {
    if (typeof v[k] !== 'boolean') return false
  }
  if (v.weatherLocation !== undefined && !isValidWeatherLocation(v.weatherLocation)) return false
  return true
}

/** Defensively merge a possibly-partial Firestore read. A missing/partial
 *  field never causes a feature to silently disable — rollout default is
 *  `enabled=false` which is the conservative direction. */
export function normaliseNotificationPreferences(
  raw: Partial<NotificationPreferences> | null | undefined,
): NotificationPreferences {
  const base = ROLLOUT_DEFAULT_NOTIFICATION_PREFERENCES
  return Object.freeze({
    enabled: raw?.enabled === true,
    intensity:
      typeof raw?.intensity === 'string' && VALID_INTENSITIES.includes(raw.intensity as NotificationIntensity)
        ? (raw.intensity as NotificationIntensity)
        : base.intensity,
    quietHours:
      raw?.quietHours && isValidQuietHours(raw.quietHours)
        ? Object.freeze({ start: raw.quietHours.start, end: raw.quietHours.end })
        : Object.freeze({ start: base.quietHours.start, end: base.quietHours.end }),
    morningBrief: raw?.morningBrief !== false,
    weather: raw?.weather !== false,
    questReminders: raw?.questReminders !== false,
    surgeAlerts: raw?.surgeAlerts !== false,
    streakAlerts: raw?.streakAlerts !== false,
    familyProgress: raw?.familyProgress !== false,
    seasonalEvents: raw?.seasonalEvents !== false,
    weatherLocation:
      raw?.weatherLocation && isValidWeatherLocation(raw.weatherLocation)
        ? Object.freeze({ ...raw.weatherLocation })
        : undefined,
  }) as NotificationPreferences
}

/** Map intensity → max-per-day cap. The resolver never trusts a
 *  client-provided numeric. */
export function intensityToMaxPerDay(intensity: NotificationIntensity): number {
  switch (intensity) {
    case 'off': return 0
    case 'low': return 1
    case 'normal': return 2
    case 'high': return 3
  }
}