/**
 * Smart Notifications V1 — public surface.
 *
 * Re-exports the domain contract for callers (UI Settings, server-side
 * schedulers, weather integration). Stable and exhaustive.
 */

export * from './types'
export * from './preferences'
export * from './resolver'
export * from './catalog'
export * from './delivery'
export * from './state'
export * from './weather'
export * from './scheduler'