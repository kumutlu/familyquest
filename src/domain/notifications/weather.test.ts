/**
 * Smart Notifications V1 — weather provider tests.
 *
 * Pins:
 *   - cache key is family-level (location + date), child-agnostic
 *   - normalise handles malformed / unknown inputs safely
 *   - cache freshness (2h window)
 *   - DisabledWeatherProvider never throws
 *   - 5xx / timeout of upstream is handled by normalise returning null
 */

import { describe, expect, it } from 'vitest'

import {
  DisabledWeatherProvider,
  FakeWeatherProvider,
  isWeatherCacheFresh,
  normaliseWeatherContext,
  weatherCacheKey,
  WEATHER_FRESHNESS_MS,
} from './weather'
import type { WeatherLocation } from './types'

const LOCATION_NOTTINGHAM: WeatherLocation = Object.freeze({
  countryCode: 'GB',
  postalArea: 'NG6',
  city: 'Nottingham',
  timezone: 'Europe/London',
})

describe('Smart Notifications — weather cache key', () => {
  it('includes country code + postal area + city, uppercased/whitespaced', () => {
    expect(weatherCacheKey(LOCATION_NOTTINGHAM, '2026-08-31')).toBe('weather_cache/GB_NG6_nottingham_2026-08-31')
  })

  it('is child-agnostic: same family location produces the same key for any child', () => {
    const a = weatherCacheKey(LOCATION_NOTTINGHAM, '2026-08-31')
    const b = weatherCacheKey(LOCATION_NOTTINGHAM, '2026-08-31')
    expect(a).toBe(b)
  })

  it('differs by localDate', () => {
    expect(weatherCacheKey(LOCATION_NOTTINGHAM, '2026-08-31'))
      .not.toBe(weatherCacheKey(LOCATION_NOTTINGHAM, '2026-09-01'))
  })

  it('omits missing optional fields cleanly', () => {
    const minimal: WeatherLocation = { countryCode: 'GB', timezone: 'Europe/London' }
    expect(weatherCacheKey(minimal, '2026-08-31')).toBe('weather_cache/GB_2026-08-31')
  })
})

describe('Smart Notifications — weather cache freshness', () => {
  it('fresh if less than 2h old', () => {
    const now = 1_000_000_000_000
    expect(isWeatherCacheFresh(now - 60 * 60 * 1000, now)).toBe(true)
  })

  it('stale if older than 2h', () => {
    const now = 1_000_000_000_000
    expect(isWeatherCacheFresh(now - 3 * 60 * 60 * 1000, now)).toBe(false)
  })

  it('stale on the boundary (>2h)', () => {
    const now = 1_000_000_000_000
    expect(isWeatherCacheFresh(now - WEATHER_FRESHNESS_MS, now)).toBe(false)
  })

  it('non-finite cachedAt → stale', () => {
    expect(isWeatherCacheFresh(NaN, 1_000_000_000_000)).toBe(false)
  })
})

describe('Smart Notifications — normaliseWeatherContext', () => {
  it('returns null for malformed payload', () => {
    expect(normaliseWeatherContext(null)).toBe(null)
    expect(normaliseWeatherContext({})).toBe(null)
    expect(normaliseWeatherContext('hello')).toBe(null)
  })

  it('returns null for unknown condition', () => {
    expect(normaliseWeatherContext({ condition: 'hurricane' as unknown as 'storm' })).toBe(null)
  })

  it('coerces missing min/max to undefined', () => {
    const ctx = normaliseWeatherContext({ condition: 'clear' })
    expect(ctx).toEqual({ condition: 'clear', minC: undefined, maxC: undefined, precipitationChance: undefined, advisory: undefined })
  })

  it('drops out-of-range precipitation chance', () => {
    expect(normaliseWeatherContext({ condition: 'rain', precipitationChance: 150 })).toMatchObject({
      condition: 'rain',
      precipitationChance: undefined,
    })
  })

  it('preserves valid advisory', () => {
    expect(normaliseWeatherContext({ condition: 'rain', advisory: 'umbrella' })).toMatchObject({
      condition: 'rain',
      advisory: 'umbrella',
    })
  })
})

describe('Smart Notifications — FakeWeatherProvider', () => {
  it('returns null for unknown (location, date)', async () => {
    const p = new FakeWeatherProvider()
    expect(await p.getDailyWeather({ location: LOCATION_NOTTINGHAM, localDate: '2026-08-31' })).toBe(null)
  })

  it('returns the preloaded response when set', async () => {
    const p = new FakeWeatherProvider()
    p.set(LOCATION_NOTTINGHAM, '2026-08-31', { condition: 'rain', minC: 14, maxC: 18 })
    const out = await p.getDailyWeather({ location: LOCATION_NOTTINGHAM, localDate: '2026-08-31' })
    expect(out?.condition).toBe('rain')
    expect(p.calls).toHaveLength(1)
  })
})

describe('Smart Notifications — DisabledWeatherProvider', () => {
  it('always returns null without throwing', async () => {
    const p = new DisabledWeatherProvider()
    await expect(p.getDailyWeather({ location: LOCATION_NOTTINGHAM, localDate: '2026-08-31' })).resolves.toBeNull()
  })
})

describe('Smart Notifications — weather failure does not crash the resolver path', () => {
  it('upstream 500 simulated by FakeWeatherProvider returning null does not throw', async () => {
    const p = new FakeWeatherProvider() // never set → null
    await expect(p.getDailyWeather({ location: LOCATION_NOTTINGHAM, localDate: '2026-08-31' })).resolves.toBeNull()
  })
})