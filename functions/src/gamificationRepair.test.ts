import { describe, expect, it, vi } from 'vitest'
import {
  compareRebuildRecord,
  mergeRebuildStreams,
  repairGamificationPage,
  repairPostCutoverPage,
  takeCompleteCausalGroups,
  type GamificationRepairRepository,
  type RebuildRecord,
} from './gamificationRepair'

function record(id: string, effectiveAt: number, causalGroupId = id, transitionRank = 0, stream: 'eligibility' | 'event' = 'event'): RebuildRecord {
  return { id, effectiveAt, causalGroupId, transitionRank, stream, value: { id } }
}

describe('bounded gamification repair', () => {
  it('merges child-scoped streams by the full semantic tuple', () => {
    const merged = mergeRebuildStreams(
      [record('z', 1, 'a', 0, 'eligibility'), record('a', 3, 'a', 0, 'eligibility')],
      [record('b', 1, 'a', 0), record('a', 1, 'a', 1), record('a', 2, 'a', 0)],
    )
    expect(merged.map(item => item.id)).toEqual(['b', 'z', 'a', 'a', 'a'])
    expect([...merged].sort(compareRebuildRecord)).toEqual(merged)
  })

  it('carries a causal group split at a page boundary without exposing it', () => {
    const page = [record('a', 1, 'g'), record('b', 1, 'g'), record('c', 2, 'h')]
    expect(takeCompleteCausalGroups(page, false)).toEqual({ complete: page.slice(0, 2), pending: page.slice(2) })
    expect(takeCompleteCausalGroups(page.slice(0, 2), false)).toEqual({ complete: [], pending: page.slice(0, 2) })
    expect(takeCompleteCausalGroups(page.slice(0, 2), true)).toEqual({ complete: page.slice(0, 2), pending: [] })
  })

  it('rejects a causal group larger than eight records', () => {
    expect(() => takeCompleteCausalGroups(Array.from({ length: 9 }, (_, i) => record(String(i), 1, 'oversized')), true)).toThrow(/eight|8/)
  })

  it('passes the hard 250-record budget and injected generation clock to repository repair', async () => {
    const repository: GamificationRepairRepository = {
      repairGamificationPage: vi.fn().mockResolvedValue({ status: 'checkpointed', recordsRead: 250 }),
      repairPostCutoverPage: vi.fn().mockResolvedValue({ status: 'checkpointed', recordsRead: 250 }),
    }
    await repairGamificationPage({ repository, now: () => 99 }, { familyId: 'family-1', childId: 'child-1' })
    await repairPostCutoverPage({ repository, now: () => 100 }, { familyId: 'family-1' })
    expect(repository.repairGamificationPage).toHaveBeenCalledWith({ familyId: 'family-1', childId: 'child-1', processingAt: 99, maxRecords: 250 })
    expect(repository.repairPostCutoverPage).toHaveBeenCalledWith({ familyId: 'family-1', processingAt: 100, maxRecords: 250 })
  })
})
