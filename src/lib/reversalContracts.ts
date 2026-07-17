export interface EffectSnapshot {
  schemaVersion: 1
  entityType: string
  familyId: string
  actorId: string
  childId?: string
  counterpartyChildId?: string
  fundId?: string
  rewardId?: string
  sourceRequestId?: string
  walletDeltaPence?: number
  counterpartyWalletDeltaPence?: number
  fundDeltaPence?: number
  pointsDelta?: number
  xpAdjustment: 0
}

export function manualWalletEffectSnapshot(type: 'deposit' | 'withdrawal', familyId: string, childId: string, amountPence: number, actorId: string): EffectSnapshot {
  return { schemaVersion: 1, entityType: 'wallet_transaction', familyId, childId, walletDeltaPence: type === 'deposit' ? amountPence : -amountPence, actorId, xpAdjustment: 0 }
}

export function effectSnapshot(fields: Omit<EffectSnapshot, 'schemaVersion' | 'xpAdjustment'>): EffectSnapshot {
  return { schemaVersion: 1, ...fields, xpAdjustment: 0 }
}

export function assertTraceableSource<T extends object>(source: T & { effectSnapshot?: unknown }, sourceKind?: string, sourceId?: string): T & { effectSnapshot: EffectSnapshot } {
  if (!source.effectSnapshot) {
    if (sourceKind === 'petbox_request' && (source as any).status === 'approved' && (source as any).amountPence && (source as any).childId && (source as any).fundId && sourceId && (source as any).familyId) {
      return {
        ...source,
        effectSnapshot: effectSnapshot({
          entityType: 'petbox_donation',
          familyId: (source as any).familyId,
          actorId: (source as any).reviewedBy || (source as any).childId,
          childId: (source as any).childId,
          fundId: (source as any).fundId,
          sourceRequestId: sourceId,
          walletDeltaPence: -(source as any).amountPence,
          fundDeltaPence: (source as any).amountPence,
        })
      } as T & { effectSnapshot: EffectSnapshot }
    }
    throw new Error('This legacy transaction cannot be reversed automatically. Missing effectSnapshot.')
  }
  return source as T & { effectSnapshot: EffectSnapshot }
}
