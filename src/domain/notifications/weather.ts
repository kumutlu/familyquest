/**
 * Smart Notifications V1 — weather provider abstraction.
 *
 * Domain logic MUST depend only on the `WeatherProvider` interface and
 * the `WeatherContext` shape. No vendor SDK is imported here.
 *
 * V1 ships:
 *   - `WeatherProvider` interface
 *   - `FakeWeatherProvider` (deterministic for tests)
 *   - `DisabledWeatherProvider` (always returns null; used when no
 *     `weatherLocation` is configured or no live provider is enabled)
 *   - `weatherCacheKey(location, localDate)` for family-level cache
 *     addressing.
 *
 * Live vendor integration (e.g. Open-Meteo, Met Office) is intentionally
 * NOT shipped in V1. The design note documents the secret path and the
 * next-steps for enabling a live provider.
 */

import type { WeatherContext, WeatherLocation } from './types'

export interface WeatherProvider {
  getDailyWeather(input: {
    readonly location: WeatherLocation
    readonly localDate: string // yyyy-mm-dd in family-local time
  }): Promise<WeatherContext | null>
}

export class FakeWeatherProvider implements WeatherProvider {
  private readonly responses = new Map<string, WeatherContext | null>()
  readonly calls: { location: WeatherLocation; localDate: string }[] = []

  /** Pre-load a deterministic response for a (location, localDate) pair. */
  set(location: WeatherLocation, localDate: string, value: WeatherContext | null): void {
    this.responses.set(weatherCacheKey(location, localDate), value)
  }

  async getDailyWeather(input: { location: WeatherLocation; localDate: string }): Promise<WeatherContext | null> {
    this.calls.push(input)
    const key = weatherCacheKey(input.location, input.localDate)
    if (this.responses.has(key)) {
      return this.responses.get(key) ?? null
    }
    return null
  }
}

export class DisabledWeatherProvider implements WeatherProvider {
  async getDailyWeather(_input: { location: WeatherLocation; localDate: string }): Promise<WeatherContext | null> {
    return null
  }
}

/** Cache key: `weather_cache/{locationKey}_{yyyy-mm-dd}`. A family of
 *  N children with the same location produces ONE cache entry per
 *  local date. */
export function weatherCacheKey(location: WeatherLocation, localDate: string): string {
  const postal = (location.postalArea ?? '').toUpperCase().replace(/\s+/g, '')
  const city = (location.city ?? '').toLowerCase().replace(/\s+/g, '-')
  const parts = [location.countryCode.toUpperCase(), postal, city].filter(Boolean)
  const locationKey = parts.join('_') || 'unknown'
  return `weather_cache/${locationKey}_${localDate}`
}

/** Result wrapper that downstream code uses to decide whether to retry
 *  on cache miss / provider failure. */
export type WeatherLookupResult =
  | { readonly status: 'fresh'; readonly context: WeatherContext | null }
  | { readonly status: 'stale'; readonly context: WeatherContext | null; readonly cachedAt: number }
  | { readonly status: 'unavailable'; readonly reason: string }

/** Two-hour freshness window for cached weather (spec §14). */
export const WEATHER_FRESHNESS_MS = 2 * 60 * 60 * 1000

export function isWeatherCacheFresh(cachedAt: number, now: number): boolean {
  if (typeof cachedAt !== 'number' || !Number.isFinite(cachedAt)) return false
  return now - cachedAt < WEATHER_FRESHNESS_MS
}

/** Defensive normaliser for an upstream provider response. Unknown
 *  conditions collapse to null so the morning brief can still send
 *  with a degraded "weather unavailable" view. */
export function normaliseWeatherContext(raw: unknown): WeatherContext | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<WeatherContext>
  const validConditions: readonly WeatherContext['condition'][] = [
    'clear', 'cloudy', 'rain', 'snow', 'storm', 'fog', 'wind', 'mixed',
  ]
  if (typeof r.condition !== 'string' || !validConditions.includes(r.condition as WeatherContext['condition'])) {
    return null
  }
  const minC = typeof r.minC === 'number' && Number.isFinite(r.minC) ? r.minC : undefined
  const maxC = typeof r.maxC === 'number' && Number.isFinite(r.maxC) ? r.maxC : undefined
  const precipitationChance = typeof r.precipitationChance === 'number' && Number.isFinite(r.precipitationChance) && r.precipitationChance >= 0 && r.precipitationChance <= 100
    ? r.precipitationChance
    : undefined
  const advisories: readonly WeatherContext['advisory'][] = ['umbrella', 'coat', 'hot_weather', 'icy']
  const advisory = typeof r.advisory === 'string' && advisories.includes(r.advisory as WeatherContext['advisory'])
    ? (r.advisory as WeatherContext['advisory'])
    : undefined
  return {
    condition: r.condition as WeatherContext['condition'],
    minC,
    maxC,
    precipitationChance,
    advisory,
  }
}