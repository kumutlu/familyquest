import { describe, it, expect } from 'vitest'
import {
  AVATAR_CATALOG,
  getAvatarById,
  getAvatarCost,
  isStarterAvatar,
  isPremiumAvatar,
  resolveAvatarImage,
  mapLegacyUrlToAvatarId,
  TIER_LABELS,
} from './avatarCatalog'

describe('avatar catalog', () => {
  it('exposes 10 free starter avatars', () => {
    const starters = AVATAR_CATALOG.filter(a => a.tier === 'starter')
    expect(starters.length).toBeGreaterThanOrEqual(8)
    expect(starters.length).toBeLessThanOrEqual(12)
    for (const s of starters) {
      expect(s.costPoints).toBe(0)
      expect(s.unlockType).toBe('free')
    }
  })

  it('has tiers rare (100-250), epic (500-1000), legendary (2000+)', () => {
    const rare = AVATAR_CATALOG.filter(a => a.tier === 'rare')
    const epic = AVATAR_CATALOG.filter(a => a.tier === 'epic')
    const legendary = AVATAR_CATALOG.filter(a => a.tier === 'legendary')
    for (const a of rare) expect(a.costPoints).toBeGreaterThanOrEqual(100)
    for (const a of rare) expect(a.costPoints).toBeLessThanOrEqual(250)
    for (const a of epic) expect(a.costPoints).toBeGreaterThanOrEqual(500)
    for (const a of epic) expect(a.costPoints).toBeLessThanOrEqual(1000)
    for (const a of legendary) expect(a.costPoints).toBeGreaterThanOrEqual(2000)
  })

  it('uses deterministic, curated image urls (no random seeds)', () => {
    for (const a of AVATAR_CATALOG) {
      expect(a.imageUrl).toMatch(/^https:\/\/api\.dicebear\.com/)
      expect(a.imageUrl).toContain('seed=')
    }
  })

  it('every id is unique and active by default', () => {
    const ids = AVATAR_CATALOG.map(a => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of AVATAR_CATALOG) expect(a.isActive).toBe(true)
  })

  it('getAvatarById / getAvatarCost resolve authoritative prices', () => {
    expect(getAvatarById('rare-neon')?.costPoints).toBe(150)
    expect(getAvatarCost('rare-neon')).toBe(150)
    expect(getAvatarCost('starter-robot')).toBe(0)
    expect(getAvatarCost('does-not-exist')).toBeNull()
  })

  it('isStarterAvatar / isPremiumAvatar classify correctly', () => {
    expect(isStarterAvatar('starter-robot')).toBe(true)
    expect(isStarterAvatar('rare-neon')).toBe(false)
    expect(isPremiumAvatar('rare-neon')).toBe(true)
    expect(isPremiumAvatar('starter-robot')).toBe(false)
  })

  it('resolveAvatarImage prefers catalog id over legacy url', () => {
    const def = getAvatarById('starter-cat')!
    expect(resolveAvatarImage('starter-cat', 'https://old')).toBe(def.imageUrl)
    expect(resolveAvatarImage(null, 'https://old')).toBe('https://old')
    expect(resolveAvatarImage(null, null)).toBeUndefined()
  })

  it('mapLegacyUrlToAvatarId maps a known dicebear seed', () => {
    const mapped = mapLegacyUrlToAvatarId('https://api.dicebear.com/7.x/avataaars/svg?seed=starter-cat')
    expect(mapped).toBe('starter-cat')
    expect(mapLegacyUrlToAvatarId('https://example.com/unknown')).toBeUndefined()
  })

  it('tier labels are present', () => {
    expect(TIER_LABELS.starter).toBe('Starter')
    expect(TIER_LABELS.legendary).toBe('Legendary')
  })
})
