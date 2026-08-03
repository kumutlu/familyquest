import { describe, expect, it } from 'vitest'
import {
  buildInitialGamificationMigration,
  GAMIFICATION_READY_STATUSES,
  isGamificationMigrationStatus,
  isGamificationReady,
  NEW_FAMILY_MIGRATION_STATUS,
  type GamificationMigrationStatus,
} from './migrationState'

describe('gamification migration state', () => {
  it('treats only inactive as not gamification-ready', () => {
    const all: readonly GamificationMigrationStatus[] = ['inactive', 'prepared', 'baseline_complete', 'active']
    expect(all.filter(isGamificationReady)).toEqual(['prepared', 'baseline_complete', 'active'])
    expect(isGamificationReady('inactive')).toBe(false)
  })

  it('exposes the ready statuses the processor gates on', () => {
    expect([...GAMIFICATION_READY_STATUSES].sort()).toEqual(['active', 'baseline_complete', 'prepared'])
    expect(GAMIFICATION_READY_STATUSES).not.toContain('inactive')
  })

  it('rejects unknown status values', () => {
    expect(isGamificationMigrationStatus('active')).toBe(true)
    expect(isGamificationMigrationStatus('ACTIVE')).toBe(false)
    expect(isGamificationMigrationStatus('')).toBe(false)
    expect(isGamificationMigrationStatus(undefined)).toBe(false)
    expect(isGamificationMigrationStatus(1)).toBe(false)
  })

  it('initializes new families into a gamification-ready state, never inactive', () => {
    expect(NEW_FAMILY_MIGRATION_STATUS).toBe('active')
    expect(isGamificationReady(NEW_FAMILY_MIGRATION_STATUS)).toBe(true)
  })

  it('builds the creation-time migration field with the caller-supplied cutover', () => {
    const cutover = { sentinel: 'serverTimestamp' }
    expect(buildInitialGamificationMigration(cutover)).toEqual({
      schemaVersion: 1,
      status: 'active',
      cutoverAt: cutover,
    })
  })
})
