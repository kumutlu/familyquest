/**
 * RED tests for `resolveDailyAdventurePresentation`.
 *
 * These tests pin the V1 precedence rule:
 *
 *   surge > mystery_ready > comeback > mystery_available > seasonal > normal
 *
 * They are pure — no React, no clock, no Firestore. The resolver is the
 * single source of truth for what gets shown at the top of the surface.
 */

import { describe, expect, it } from 'vitest'
import {
  resolveDailyAdventurePresentation,
  type DailyAdventureContext,
} from './presentation.v1'

function base(over: Partial<DailyAdventureContext> = {}): DailyAdventureContext {
  return {
    surge: null,
    mysteryDrop: null,
    comeback: null,
    seasonalActive: false,
    resolved: true,
    ...over,
  }
}

describe('resolveDailyAdventurePresentation', () => {
  it('returns normal when nothing is special', () => {
    const result = resolveDailyAdventurePresentation(base())
    expect(result.kind).toBe('normal')
    expect(result.reason).toBe('no_special_opportunity')
  })

  it('returns loading when state is unresolved', () => {
    const result = resolveDailyAdventurePresentation(base({ resolved: false }))
    expect(result.kind).toBe('loading')
    expect(result.reason).toBe('state_unresolved')
  })

  it('loading outranks every special opportunity', () => {
    const result = resolveDailyAdventurePresentation(base({
      resolved: false,
      surge: { surgeId: 's1', eligibleTaskCount: 3 },
      mysteryDrop: { id: 'm1', rarity: 'rare', isRevealReady: true },
      comeback: { tier: 'return_3d', inactivityDays: 3 },
    }))
    expect(result.kind).toBe('loading')
  })

  it('surge + ready mystery + comeback → surge', () => {
    const result = resolveDailyAdventurePresentation(base({
      surge: { surgeId: 's1', eligibleTaskCount: 2 },
      mysteryDrop: { id: 'm1', rarity: 'rare', isRevealReady: true },
      comeback: { tier: 'return_3d', inactivityDays: 3 },
    }))
    expect(result.kind).toBe('surge')
    expect(result.reason).toBe('active_surge')
  })

  it('ready mystery + comeback → mystery_ready (mystery beats comeback)', () => {
    const result = resolveDailyAdventurePresentation(base({
      mysteryDrop: { id: 'm1', rarity: 'epic', isRevealReady: true },
      comeback: { tier: 'return_7d', inactivityDays: 9 },
    }))
    expect(result.kind).toBe('mystery_ready')
    expect(result.reason).toBe('mystery_unlocked')
  })

  it('ready mystery + locked mystery → ready (lock collapses to first ready)', () => {
    const result = resolveDailyAdventurePresentation(base({
      mysteryDrop: { id: 'm1', rarity: 'epic', isRevealReady: true },
    }))
    expect(result.kind).toBe('mystery_ready')
  })

  it('comeback + locked mystery → comeback (comeback beats locked mystery)', () => {
    const result = resolveDailyAdventurePresentation(base({
      mysteryDrop: { id: 'm1', rarity: 'rare', isRevealReady: false },
      comeback: { tier: 'return_3d', inactivityDays: 3 },
    }))
    expect(result.kind).toBe('comeback')
    expect(result.reason).toBe('comeback_active')
  })

  it('locked mystery only → mystery_available', () => {
    const result = resolveDailyAdventurePresentation(base({
      mysteryDrop: { id: 'm1', rarity: 'common', isRevealReady: false },
    }))
    expect(result.kind).toBe('mystery_available')
    expect(result.reason).toBe('mystery_progressing')
  })

  it('return_1d comeback with no mystery → comeback', () => {
    const result = resolveDailyAdventurePresentation(base({
      comeback: { tier: 'return_1d', inactivityDays: 1 },
    }))
    expect(result.kind).toBe('comeback')
  })

  it('seasonal-only state surfaces when no special opportunity exists', () => {
    const result = resolveDailyAdventurePresentation(base({ seasonalActive: true }))
    expect(result.kind).toBe('seasonal')
    expect(result.reason).toBe('seasonal_only')
  })

  it('seasonal beats normal but loses to comeback', () => {
    const comeback = resolveDailyAdventurePresentation(base({
      seasonalActive: true,
      comeback: { tier: 'return_1d', inactivityDays: 1 },
    }))
    expect(comeback.kind).toBe('comeback')

    const alone = resolveDailyAdventurePresentation(base({ seasonalActive: true }))
    expect(alone.kind).toBe('seasonal')
  })

  it('surge with zero eligible tasks is NOT a surge', () => {
    const result = resolveDailyAdventurePresentation(base({
      surge: { surgeId: 's1', eligibleTaskCount: 0 },
    }))
    expect(result.kind).toBe('normal')
  })

  it('comeback with tier "none" is NOT a comeback', () => {
    const result = resolveDailyAdventurePresentation(base({
      comeback: { tier: 'none', inactivityDays: 0 },
    }))
    expect(result.kind).toBe('normal')
  })

  it('idempotent for the same context', () => {
    const ctx = base({
      surge: { surgeId: 's1', eligibleTaskCount: 2 },
    })
    expect(resolveDailyAdventurePresentation(ctx)).toEqual(
      resolveDailyAdventurePresentation(ctx),
    )
  })
})