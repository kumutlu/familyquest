import { describe, expect, it } from 'vitest'
import { planReversal, reversalRecordId, type ReversalBalances } from './reversalDomain'
import { effectSnapshot } from './reversalContracts'

const balances: ReversalBalances = { childWalletPence: 1_000, counterpartyWalletPence: 200, fundPence: 700, points: 50 }

describe('reversal domain', () => {
  it('plans the exact inverse of a two-account wallet and fund effect without reversing XP', () => {
    const snapshot = effectSnapshot({
      entityType: 'petbox_donation', familyId: 'family-1', actorId: 'parent-1', childId: 'child-1',
      counterpartyChildId: 'child-2', fundId: 'fund-1', walletDeltaPence: -300,
      counterpartyWalletDeltaPence: 300, fundDeltaPence: 300, pointsDelta: -5,
    })
    expect(planReversal(snapshot, balances, -500)).toEqual({
      childWalletPence: 1_300, counterpartyWalletPence: -100, fundPence: 400, points: 55,
      inverseWalletDeltaPence: 300, inverseCounterpartyWalletDeltaPence: -300,
      inverseFundDeltaPence: -300, inversePointsDelta: 5, xpAdjustment: 0, xpReversed: false,
    })
  })

  it('rejects a reversal that would breach wallet debt or points sufficiency, but permits a negative fund balance', () => {
    const walletCredit = effectSnapshot({ entityType: 'deposit', familyId: 'f', actorId: 'p', childId: 'c', walletDeltaPence: 800 })
    expect(() => planReversal(walletCredit, { ...balances, childWalletPence: 100 }, -500)).toThrow('Insufficient wallet balance to reverse')
    // A fund reversal may legitimately drive the balance negative (parents pay real
    // pet expenses; children later cover the deficit), so no sufficiency check is thrown.
    const fundCredit = effectSnapshot({ entityType: 'fund', familyId: 'f', actorId: 'p', fundId: 'fund', fundDeltaPence: 800 })
    expect(planReversal(fundCredit, balances, -500).fundPence).toBe(-100)
    const pointsCredit = effectSnapshot({ entityType: 'task', familyId: 'f', actorId: 'p', childId: 'c', pointsDelta: 80 })
    expect(() => planReversal(pointsCredit, balances, -500)).toThrow('Insufficient points to reverse')
  })

  it('creates a deterministic collision-safe record id', () => {
    expect(reversalRecordId('wallet_transaction', 'abc/123')).toBe('wallet_transaction__abc%2F123')
  })
})
