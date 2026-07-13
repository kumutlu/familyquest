import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectSnapshot } from './reversalContracts'

const firestore = vi.hoisted(() => ({
  doc: vi.fn((_first: unknown, ...parts: string[]) => ({ id: parts.at(-1), path: parts.join('/') })),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => ({ server: true })),
}))
const authState = vi.hoisted(() => ({ currentUser: { uid: 'parent-1' } as any }))
vi.mock('firebase/firestore', () => firestore)
vi.mock('./firebase', () => ({ db: {}, auth: authState }))

import { reverseTransaction, sourceCollectionFor } from './reversalApi'

function snapshot(data?: Record<string, any>) { return { exists: () => data !== undefined, data: () => data } }
function transactionWith(docs: Record<string, Record<string, any> | undefined>) {
  const tx = {
    get: vi.fn(async (ref: { path: string }) => snapshot(docs[ref.path])),
    update: vi.fn(), set: vi.fn(),
  }
  firestore.runTransaction.mockImplementation(async (_db: unknown, callback: any) => callback(tx))
  return tx
}

describe('reversal API dispatcher', () => {
  beforeEach(() => { vi.clearAllMocks(); authState.currentUser = { uid: 'parent-1' } })

  it('maps every traceable action family to its immutable source collection', () => {
    expect([
      'wallet_transaction', 'fund_transaction', 'behaviour_event', 'task_completion',
      'reward_redemption', 'transfer_request', 'money_request', 'petbox_request',
    ].map(sourceCollectionFor)).toEqual([
      'wallet_transactions', 'fund_transactions', 'behaviour_events', 'task_completions',
      'redemptions', 'transfer_requests', 'money_requests', 'petbox_requests',
    ])
  })

  it('atomically reverses a traceable wallet source and writes deterministic immutable evidence', async () => {
    const reversalId = 'wallet_transaction__source-1'
    const tx = transactionWith({
      'users/parent-1': { familyId: 'family-1', role: 'parent' },
      'families/family-1': { debtLimitPence: -500 },
      'families/family-1/wallet_transactions/source-1': {
        effectSnapshot: effectSnapshot({ entityType: 'wallet_transaction', familyId: 'family-1', actorId: 'parent-1', childId: 'child-1', walletDeltaPence: 300 }),
      },
      [`families/family-1/reversals/${reversalId}`]: undefined,
      'families/family-1/wallets/child-1': { balance: 500 },
    })

    await expect(reverseTransaction({ familyId: 'family-1', sourceKind: 'wallet_transaction', sourceId: 'source-1', reason: 'Entered twice' })).resolves.toEqual({ reversalId, status: 'completed' })
    expect(tx.update).toHaveBeenCalledWith(expect.objectContaining({ path: 'families/family-1/wallets/child-1' }), { balance: 200, lastReversalId: reversalId })
    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({ path: `families/family-1/wallet_transactions/${reversalId}__wallet` }), expect.objectContaining({
      type: 'reversal', reversalId, sourceId: 'source-1', amountPence: -300, actorId: 'parent-1',
    }))
    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({ path: `families/family-1/reversals/${reversalId}` }), expect.objectContaining({
      status: 'completed', sourceKind: 'wallet_transaction', sourceId: 'source-1', xpAdjustment: 0, xpReversed: false,
    }))
  })

  it('returns the deterministic prior result on retry without applying another inverse', async () => {
    const reversalId = 'wallet_transaction__source-1'
    const tx = transactionWith({
      'users/parent-1': { familyId: 'family-1', role: 'owner' },
      'families/family-1': { debtLimitPence: -500 },
      [`families/family-1/reversals/${reversalId}`]: { status: 'completed', sourceId: 'source-1' },
    })
    await expect(reverseTransaction({ familyId: 'family-1', sourceKind: 'wallet_transaction', sourceId: 'source-1', reason: 'Retry' })).resolves.toEqual({ reversalId, status: 'already_reversed' })
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.set).not.toHaveBeenCalled()
  })

  it('rejects legacy sources with the exact compatibility error before any write', async () => {
    const reversalId = 'wallet_transaction__legacy-1'
    const tx = transactionWith({
      'users/parent-1': { familyId: 'family-1', role: 'parent' },
      'families/family-1': {},
      [`families/family-1/reversals/${reversalId}`]: undefined,
      'families/family-1/wallet_transactions/legacy-1': { type: 'deposit', amount: 100 },
    })
    await expect(reverseTransaction({ familyId: 'family-1', sourceKind: 'wallet_transaction', sourceId: 'legacy-1', reason: 'Bad legacy' })).rejects.toThrow('This legacy transaction cannot be reversed automatically. Missing effectSnapshot.')
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.set).not.toHaveBeenCalled()
  })
})
