import { describe, expect, it } from 'vitest';
import type { NormalizedTransaction } from '../../lib/transactionModel';
import { normalizeHistoryAction } from '../../lib/reversalHistory';
import { buildHistoryActionSourceResolver } from './historySourceResolver';

function transaction(overrides: Partial<NormalizedTransaction>): NormalizedTransaction {
  return {
    id: 'tx-1',
    timestamp: Date.now(),
    type: 'deposit',
    amountPence: 100,
    currency: '£',
    unit: 'money',
    direction: 'in',
    status: 'completed',
    title: 'Money added',
    subtitle: '',
    icon: 'ArrowDownRight',
    iconBg: 'bg-success-50',
    iconColor: 'text-success-600',
    reversible: false,
    searchText: '',
    category: 'income',
    isPending: false,
    isCompleted: true,
    isReversed: false,
    ...overrides,
  };
}

describe('buildHistoryActionSourceResolver', () => {
  it('preserves a raw wallet effect snapshot so the real action normalizer exposes refund', () => {
    const rawWallet = {
      id: 'wallet-1',
      type: 'withdrawal',
      status: 'completed',
      effectSnapshot: {
        schemaVersion: 1,
        entityType: 'wallet_transaction',
        familyId: 'family-1',
        actorId: 'parent-1',
        childId: 'child-1',
        walletDeltaPence: -250,
        xpAdjustment: 0,
      },
    };
    const resolve = buildHistoryActionSourceResolver({ walletTransactions: [rawWallet] });
    const resolved = resolve(transaction({
      id: 'wallet-1',
      source: 'wallet_transaction',
      sourceId: 'wallet-1',
      type: 'withdrawal',
    }));

    expect(resolved).toEqual({ sourceKind: 'wallet_transaction', source: rawWallet });
    expect(normalizeHistoryAction({
      ...resolved!,
      actor: { id: 'parent-1', role: 'parent' },
      reversals: [],
      balances: { wallets: { 'child-1': 500 } },
      names: { 'child-1': 'Alex' },
    })).toMatchObject({ action: 'reverse', actionLabel: 'refund' });
  });

  it('keeps a deduplicated canonical request leg attached to its wallet row, not the request document', () => {
    const rawWallet = {
      id: 'wallet-leg-1',
      type: 'transfer_out',
      transferRequestId: 'transfer-1',
      effectSnapshot: {
        schemaVersion: 1,
        entityType: 'transfer_request',
        familyId: 'family-1',
        actorId: 'parent-1',
        childId: 'child-1',
        walletDeltaPence: -400,
        sourceRequestId: 'transfer-1',
        xpAdjustment: 0,
      },
    };
    const rawRequest = { id: 'transfer-1', status: 'approved' };
    const resolve = buildHistoryActionSourceResolver({
      walletTransactions: [rawWallet],
      transferRequests: [rawRequest],
    });

    expect(resolve(transaction({
      id: 'wallet-leg-1',
      source: 'wallet_transaction',
      sourceId: 'transfer-1',
      transferRequestId: 'transfer-1',
      type: 'transfer_out',
    }))).toEqual({ sourceKind: 'wallet_transaction', source: rawWallet });
  });

  it('resolves a standalone pending request to its exact raw cancellation source', () => {
    const rawRequest = { id: 'transfer-1', status: 'pending', fromChildId: 'child-1' };
    const resolve = buildHistoryActionSourceResolver({ transferRequests: [rawRequest] });

    expect(resolve(transaction({
      id: 'transfer-1',
      source: 'transfer_request',
      sourceId: 'transfer-1',
      type: 'transfer_request',
      status: 'pending',
      isPending: true,
      isCompleted: false,
    }))).toEqual({ sourceKind: 'transfer_request', source: rawRequest });
  });
});
