import { describe, expect, it, vi } from 'vitest'
import {
  processApprovedCompletion,
  processTaskInvalidation,
  type GamificationProcessorRepository,
} from './gamificationProcessor'

function repository(): GamificationProcessorRepository {
  return {
    processApprovedCompletion: vi.fn().mockResolvedValue({ status: 'processed', logicalCompletionKey: 'key' }),
    processTaskInvalidation: vi.fn().mockResolvedValue({ status: 'processed', logicalCompletionKey: 'key' }),
  }
}

describe('gamificationProcessor dependency boundary', () => {
  it('uses one trusted repository path for manual and auto-approved completions', async () => {
    const repo = repository()
    const now = vi.fn(() => 1_700_000_000_000)
    await processApprovedCompletion({ repository: repo, now }, { familyId: 'family-1', completionId: 'manual' })
    await processApprovedCompletion({ repository: repo, now }, { familyId: 'family-1', completionId: 'auto' })
    expect(repo.processApprovedCompletion).toHaveBeenNthCalledWith(1, {
      familyId: 'family-1', completionId: 'manual', processingAt: 1_700_000_000_000,
    })
    expect(repo.processApprovedCompletion).toHaveBeenNthCalledWith(2, {
      familyId: 'family-1', completionId: 'auto', processingAt: 1_700_000_000_000,
    })
  })

  it('passes immutable reversal identity and an injected clock to invalidation processing', async () => {
    const repo = repository()
    await processTaskInvalidation({ repository: repo, now: () => 42 }, {
      familyId: 'family-1', completionId: 'completion-1', immutableReversalId: 'task_completion__completion-1',
    })
    expect(repo.processTaskInvalidation).toHaveBeenCalledWith({
      familyId: 'family-1', completionId: 'completion-1', immutableReversalId: 'task_completion__completion-1', processingAt: 42,
    })
  })

  it.each(['', 'bad/id'])('rejects invalid family or completion identifiers before repository writes', async invalid => {
    const repo = repository()
    await expect(processApprovedCompletion({ repository: repo, now: () => 1 }, {
      familyId: invalid, completionId: 'completion-1',
    })).rejects.toThrow(/familyId/)
    await expect(processApprovedCompletion({ repository: repo, now: () => 1 }, {
      familyId: 'family-1', completionId: invalid,
    })).rejects.toThrow(/completionId/)
    expect(repo.processApprovedCompletion).not.toHaveBeenCalled()
  })
})
