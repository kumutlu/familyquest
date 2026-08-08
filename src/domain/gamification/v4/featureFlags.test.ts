/**
 * Gamification V4 — feature flag framework tests (TDD-first, pure).
 *
 * No firebase import; runs under `vitest run --dir src` with no emulator.
 */

import { describe, expect, it } from 'vitest'

import {
  ALL_WRITERS,
  allLegacy,
  allV4,
  defaultFeatureFlags,
  isV4Active,
  resolveWriterRoute,
  withAllLegacy,
  withAllV4,
  withWriterDisabled,
  withWriterEnabled,
  type FeatureFlagSet,
} from './featureFlags'

describe('feature flag framework — fail-closed defaults', () => {
  it('enumerates exactly the 7 legacy writers from the audit', () => {
    expect(ALL_WRITERS).toHaveLength(7)
    expect(ALL_WRITERS).toEqual([
      'task_approval',
      'task_invalidation',
      'day_finalization',
      'behaviour',
      'reward_redemption',
      'challenge_claim',
      'avatar_unlock',
    ])
  })

  it('defaultFeatureFlags routes every writer to legacy', () => {
    const flags = defaultFeatureFlags()
    for (const w of ALL_WRITERS) {
      expect(isV4Active(flags, w)).toBe(false)
      expect(resolveWriterRoute(flags, w)).toBe('legacy')
    }
    expect(allLegacy(flags)).toBe(true)
    expect(allV4(flags)).toBe(false)
  })

  it('a missing / unread config can never activate V4 (default is safe)', () => {
    const missing = defaultFeatureFlags()
    expect(missing.writers.reward_redemption).toBe(false)
    expect(missing.writers.avatar_unlock).toBe(false)
  })
})

describe('feature flag framework — per-writer routing', () => {
  it('withWriterEnabled flips a single global writer to v4', () => {
    const flags = withWriterEnabled(defaultFeatureFlags(), 'behaviour')
    expect(isV4Active(flags, 'behaviour')).toBe(true)
    expect(resolveWriterRoute(flags, 'behaviour')).toBe('v4')
    // Other writers remain legacy.
    expect(isV4Active(flags, 'task_approval')).toBe(false)
    expect(allLegacy(flags)).toBe(false)
  })

  it('withWriterDisabled restores a writer to legacy', () => {
    const flags = withWriterDisabled(withAllV4(), 'reward_redemption')
    expect(isV4Active(flags, 'reward_redemption')).toBe(false)
    expect(isV4Active(flags, 'behaviour')).toBe(true)
  })

  it('withAllV4 / withAllLegacy are exact inverses', () => {
    const all = withAllV4()
    expect(allV4(all)).toBe(true)
    expect(allLegacy(all)).toBe(false)
    const back = withAllLegacy(all)
    expect(allLegacy(back)).toBe(true)
    expect(allV4(back)).toBe(false)
  })
})

describe('feature flag framework — per-family overrides (canary / rollback)', () => {
  const FAMILY = 'fam-canary'

  it('a family override routes only that family to v4', () => {
    const flags = withWriterEnabled(defaultFeatureFlags(), 'behaviour', FAMILY)
    expect(isV4Active(flags, 'behaviour', FAMILY)).toBe(true)
    expect(isV4Active(flags, 'behaviour', 'other-family')).toBe(false)
    expect(resolveWriterRoute(flags, 'behaviour', FAMILY)).toBe('v4')
  })

  it('a family override can be rolled back independently of the global default', () => {
    let flags: FeatureFlagSet = withWriterEnabled(defaultFeatureFlags(), 'behaviour')
    flags = withWriterEnabled(flags, 'behaviour', FAMILY)
    // Roll back only the canary family.
    flags = withWriterDisabled(flags, 'behaviour', FAMILY)
    expect(isV4Active(flags, 'behaviour', FAMILY)).toBe(false)
    expect(isV4Active(flags, 'behaviour')).toBe(true) // global still v4
  })

  it('an explicit false override beats the global true default', () => {
    const flags = withWriterDisabled(withAllV4(), 'avatar_unlock', FAMILY)
    expect(isV4Active(flags, 'avatar_unlock', FAMILY)).toBe(false)
    expect(isV4Active(flags, 'avatar_unlock')).toBe(true)
  })
})

describe('feature flag framework — immutability', () => {
  it('mutating a returned flag set does not affect the source', () => {
    const base = defaultFeatureFlags()
    const enabled = withWriterEnabled(base, 'task_approval')
    // base must be untouched.
    expect(isV4Active(base, 'task_approval')).toBe(false)
    expect(isV4Active(enabled, 'task_approval')).toBe(true)
  })

  it('overrides are cloned, not shared by reference', () => {
    const f1 = withWriterEnabled(defaultFeatureFlags(), 'behaviour', 'fam-a')
    const f2 = withWriterEnabled(f1, 'behaviour', 'fam-b')
    expect(isV4Active(f1, 'behaviour', 'fam-b')).toBe(false)
    expect(isV4Active(f2, 'behaviour', 'fam-b')).toBe(true)
  })
})
