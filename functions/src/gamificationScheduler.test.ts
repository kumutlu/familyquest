import { describe, expect, it, vi } from 'vitest'
import { finalizeFamilyDay, finalizeGamificationDaysOnce, type GamificationSchedulerRepository } from './gamificationScheduler'

function repository(): GamificationSchedulerRepository {
  return {
    finalizeFamilyDay: vi.fn().mockResolvedValue({ snapshotsCreated: 1, daysFinalized: 1 }),
    listFamiliesForFinalization: vi.fn().mockResolvedValue(['family-b', 'family-a']),
  }
}

describe('gamification scheduler', () => {
  it('uses the injected clock and one repository operation for a family day', async () => {
    const repo = repository()
    await finalizeFamilyDay({ repository: repo, now: () => 123 }, { familyId: 'family-1', dayKey: '2026-07-22' })
    expect(repo.finalizeFamilyDay).toHaveBeenCalledWith({ familyId: 'family-1', dayKey: '2026-07-22', processingAt: 123 })
  })

  it('finalizes all due families deterministically', async () => {
    const repo = repository()
    await finalizeGamificationDaysOnce({ repository: repo, now: () => 123 })
    expect(repo.finalizeFamilyDay).toHaveBeenNthCalledWith(1, { familyId: 'family-a', processingAt: 123 })
    expect(repo.finalizeFamilyDay).toHaveBeenNthCalledWith(2, { familyId: 'family-b', processingAt: 123 })
  })
})
