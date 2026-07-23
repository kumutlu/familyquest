import { describe, expect, it, vi } from 'vitest'
import { handleGamificationReversalCreated, handleTaskCompletionWritten } from './gamificationTriggers'

describe('gamification trigger handlers', () => {
  it('processes approved create and pending-to-approved update through the same callback', async () => {
    const approved = vi.fn().mockResolvedValue(undefined)
    const invalidated = vi.fn().mockResolvedValue(undefined)
    await handleTaskCompletionWritten({ approved, invalidated }, {
      familyId: 'family-1', completionId: 'auto', before: undefined, after: { status: 'approved' },
    })
    await handleTaskCompletionWritten({ approved, invalidated }, {
      familyId: 'family-1', completionId: 'manual', before: { status: 'pending_approval' }, after: { status: 'approved' },
    })
    expect(approved).toHaveBeenCalledTimes(2)
    expect(invalidated).not.toHaveBeenCalled()
  })

  it('ignores irrelevant updates and routes approved cancellation/invalidation', async () => {
    const approved = vi.fn().mockResolvedValue(undefined)
    const invalidated = vi.fn().mockResolvedValue(undefined)
    await handleTaskCompletionWritten({ approved, invalidated }, {
      familyId: 'family-1', completionId: 'same', before: { status: 'approved' }, after: { status: 'approved' },
    })
    await handleTaskCompletionWritten({ approved, invalidated }, {
      familyId: 'family-1', completionId: 'cancelled', before: { status: 'approved' }, after: { status: 'cancelled' },
    })
    expect(approved).not.toHaveBeenCalled()
    expect(invalidated).toHaveBeenCalledOnce()
  })

  it('routes only task-completion reversal documents with their immutable ID', async () => {
    const invalidated = vi.fn().mockResolvedValue(undefined)
    await handleGamificationReversalCreated({ invalidated }, {
      familyId: 'family-1', reversalId: 'task_completion__c1', data: { sourceKind: 'task_completion', sourceId: 'c1' },
    })
    await handleGamificationReversalCreated({ invalidated }, {
      familyId: 'family-1', reversalId: 'wallet__w1', data: { sourceKind: 'wallet_transaction', sourceId: 'w1' },
    })
    expect(invalidated).toHaveBeenCalledOnce()
    expect(invalidated).toHaveBeenCalledWith({ familyId: 'family-1', completionId: 'c1', immutableReversalId: 'task_completion__c1' })
  })
})
