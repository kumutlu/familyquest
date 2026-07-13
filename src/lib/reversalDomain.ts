import type { EffectSnapshot } from './reversalContracts'

export interface ReversalBalances {
  childWalletPence?: number
  counterpartyWalletPence?: number
  fundPence?: number
  points?: number
}

export interface ReversalPlan extends ReversalBalances {
  inverseWalletDeltaPence?: number
  inverseCounterpartyWalletDeltaPence?: number
  inverseFundDeltaPence?: number
  inversePointsDelta?: number
  xpAdjustment: 0
  xpReversed: false
}

function exactInverse(current: number | undefined, delta: number, missingMessage: string): number {
  if (!Number.isSafeInteger(current)) throw new Error(missingMessage)
  return current! - delta
}

export function planReversal(snapshot: EffectSnapshot, balances: ReversalBalances, debtLimitPence: number): ReversalPlan {
  const plan: ReversalPlan = { xpAdjustment: 0, xpReversed: false }

  if (snapshot.walletDeltaPence !== undefined) {
    plan.inverseWalletDeltaPence = -snapshot.walletDeltaPence
    plan.childWalletPence = exactInverse(balances.childWalletPence, snapshot.walletDeltaPence, 'Wallet balance unavailable')
    if (plan.childWalletPence < debtLimitPence) throw new Error('Insufficient wallet balance to reverse')
  }
  if (snapshot.counterpartyWalletDeltaPence !== undefined) {
    plan.inverseCounterpartyWalletDeltaPence = -snapshot.counterpartyWalletDeltaPence
    plan.counterpartyWalletPence = exactInverse(balances.counterpartyWalletPence, snapshot.counterpartyWalletDeltaPence, 'Counterparty wallet balance unavailable')
    if (plan.counterpartyWalletPence < debtLimitPence) throw new Error('Insufficient wallet balance to reverse')
  }
  if (snapshot.fundDeltaPence !== undefined) {
    plan.inverseFundDeltaPence = -snapshot.fundDeltaPence
    plan.fundPence = exactInverse(balances.fundPence, snapshot.fundDeltaPence, 'Fund balance unavailable')
    if (plan.fundPence < 0) throw new Error('Insufficient fund balance to reverse')
  }
  if (snapshot.pointsDelta !== undefined) {
    plan.inversePointsDelta = -snapshot.pointsDelta
    plan.points = exactInverse(balances.points, snapshot.pointsDelta, 'Points balance unavailable')
    if (plan.points < 0) throw new Error('Insufficient points to reverse')
  }

  return plan
}

export function reversalRecordId(sourceKind: string, sourceId: string): string {
  return `${sourceKind}__${encodeURIComponent(sourceId)}`
}
