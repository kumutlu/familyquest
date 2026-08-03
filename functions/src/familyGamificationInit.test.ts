import { describe, expect, it } from 'vitest'
import { decideGamificationInit } from './familyGamificationInit'

describe('decideGamificationInit', () => {
  it('initializes a family with no gamificationMigration field', () => {
    // This is exactly the shape produced by the buggy family-creation path.
    expect(decideGamificationInit({ name: 'Family' })).toEqual({ action: 'initialize' })
    expect(decideGamificationInit(undefined)).toEqual({ action: 'initialize' })
    expect(decideGamificationInit({ gamificationMigration: null })).toEqual({ action: 'initialize' })
  })

  it('initializes a family explicitly parked in inactive', () => {
    expect(decideGamificationInit({ gamificationMigration: { schemaVersion: 1, status: 'inactive' } }))
      .toEqual({ action: 'initialize' })
  })

  it.each(['prepared', 'baseline_complete', 'active'])('leaves a %s family untouched', status => {
    expect(decideGamificationInit({ gamificationMigration: { schemaVersion: 1, status } }))
      .toEqual({ action: 'skip', reason: 'already_ready' })
  })

  it('never rewrites metadata it cannot understand', () => {
    expect(decideGamificationInit({ gamificationMigration: { schemaVersion: 999, status: 'inactive' } }))
      .toEqual({ action: 'skip', reason: 'malformed' })
    expect(decideGamificationInit({ gamificationMigration: { schemaVersion: 1, status: 'bogus' } }))
      .toEqual({ action: 'skip', reason: 'malformed' })
    expect(decideGamificationInit({ gamificationMigration: 'active' }))
      .toEqual({ action: 'skip', reason: 'malformed' })
  })
})
