import { describe, expect, it } from 'vitest'
import { assertTraceableSource, manualWalletEffectSnapshot } from './reversalContracts'

describe('reversal source contracts', () => {
  it('creates an immutable signed manual-wallet effect snapshot', () => {
    expect(manualWalletEffectSnapshot('deposit', 'family-1', 'child-1', 500, 'owner-1')).toEqual({
      schemaVersion: 1, entityType: 'wallet_transaction', familyId: 'family-1', childId: 'child-1',
      walletDeltaPence: 500, actorId: 'owner-1', xpAdjustment: 0,
    })
    expect(manualWalletEffectSnapshot('withdrawal', 'family-1', 'child-1', 500, 'owner-1').walletDeltaPence).toBe(-500)
  })

  it('rejects incomplete legacy sources with the exact compatibility error', () => {
    expect(() => assertTraceableSource({ type: 'deposit', amount: 500 })).toThrow(
      'This legacy transaction cannot be reversed automatically. Missing effectSnapshot.',
    )
  })

  it('accepts a complete immutable source snapshot', () => {
    expect(assertTraceableSource({ effectSnapshot: manualWalletEffectSnapshot('deposit', 'f', 'c', 1, 'p') })).toBeTruthy()
  })
})
