import type { EffectSnapshot } from './reversalContracts'

export interface ReversalPayloadInput {
  familyId: string
  sourceKind: string
  sourceId: string
  reversalId: string
  actorId: string
  actorName: string
  reason: string
  original: EffectSnapshot
  inverse: EffectSnapshot
  timestamp: unknown
}

export function buildReversalPayloads(input: ReversalPayloadInput) {
  const common = {
    familyId: input.familyId,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    reversalId: input.reversalId,
    actorId: input.actorId,
    actorName: input.actorName,
  }
  return {
    record: {
      ...common,
      reason: input.reason,
      status: 'completed',
      originalEffectSnapshot: input.original,
      inverseEffectSnapshot: input.inverse,
      xpAdjustment: 0,
      xpReversed: false,
      completedAt: input.timestamp,
    },
    event: {
      ...common,
      reason: input.reason,
      effectSnapshot: input.inverse,
      xpAdjustment: 0,
      xpReversed: false,
      createdAt: input.timestamp,
    },
    wallet: (childId: string, amountPence: number) => ({
      type: 'reversal', ...common, childId, amountPence,
      effectSnapshot: input.inverse, createdAt: input.timestamp,
    }),
    fund: (fundId: string, amount: number) => ({
      type: 'reversal', ...common, fundId, amount,
      effectSnapshot: input.inverse, createdAt: input.timestamp,
    }),
  }
}
