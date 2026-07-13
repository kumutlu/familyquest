import { describe, expect, it } from 'vitest'
import { buildReversalPayloads } from './reversalPayloads'
import { effectSnapshot } from './reversalContracts'

describe('reversal payload contract', () => {
  it('builds exact deterministic evidence with authenticated actor snapshots', () => {
    const original = effectSnapshot({ entityType: 'wallet_transaction', familyId: 'family-1', actorId: 'old-parent', childId: 'child-1', walletDeltaPence: 300 })
    const inverse = effectSnapshot({ entityType: 'reversal', familyId: 'family-1', actorId: 'parent-1', childId: 'child-1', walletDeltaPence: -300 })
    const payloads = buildReversalPayloads({
      familyId: 'family-1', sourceKind: 'wallet_transaction', sourceId: 'source-1', reversalId: 'wallet_transaction__source-1',
      actorId: 'parent-1', actorName: 'Parent', reason: 'Duplicate', original, inverse, timestamp: { server: true },
    })
    expect(payloads.record).toEqual(expect.objectContaining({ actorId: 'parent-1', actorName: 'Parent', originalEffectSnapshot: original, inverseEffectSnapshot: inverse }))
    expect(payloads.event).toEqual(expect.objectContaining({ actorId: 'parent-1', actorName: 'Parent', effectSnapshot: inverse }))
    expect(payloads.wallet('child-1', -300)).toEqual(expect.objectContaining({ actorName: 'Parent', amountPence: -300, reversalId: 'wallet_transaction__source-1' }))
  })
})
