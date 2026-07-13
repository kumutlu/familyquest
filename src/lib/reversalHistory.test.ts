import { describe, expect, it } from 'vitest';
import { normalizeHistoryAction } from './reversalHistory';
import { effectSnapshot } from './reversalContracts';

const parent = { id: 'parent-1', role: 'parent' };

describe('reversal history normalization', () => {
  it('builds a signed wallet reversal preview for a traceable completed source', () => {
    const action = normalizeHistoryAction({
      sourceKind: 'wallet_transaction', source: { id: 'tx-1', type: 'deposit', status: 'completed', note: 'Pocket money', effectSnapshot: effectSnapshot({ entityType: 'wallet_transaction', familyId: 'family-1', actorId: 'parent-1', childId: 'child-1', walletDeltaPence: 300 }) },
      actor: parent, reversals: [], balances: { wallets: { 'child-1': 500 } }, names: { 'child-1': 'Alex' },
    });
    expect(action).toMatchObject({ sourceId: 'tx-1', action: 'reverse', actionLabel: 'Reverse', summary: 'Pocket money' });
    expect(action.targets).toEqual([{ id: 'child-1', label: 'Alex wallet', originalDelta: 300, predictedBalance: 200, unit: 'money' }]);
  });

  it('uses Refund for debit-like sources and joins immutable reversal metadata', () => {
    const source = { id: 'expense-1', type: 'expense', status: 'completed', effectSnapshot: effectSnapshot({ entityType: 'fund_transaction', familyId: 'family-1', actorId: 'parent-1', fundId: 'fund-1', fundDeltaPence: -250 }) };
    const reversed = normalizeHistoryAction({ sourceKind: 'fund_transaction', source, actor: parent, balances: { funds: { 'fund-1': 500 } }, names: { 'fund-1': 'Vet fund' }, reversals: [{ sourceKind: 'fund_transaction', sourceId: 'expense-1', reason: 'Duplicate', actorName: 'Owner', createdAt: 'time' }] });
    expect(reversed.action).toBeUndefined();
    expect(reversed.actionLabel).toBe('Refund');
    expect(reversed.reversal).toMatchObject({ reason: 'Duplicate', actorName: 'Owner' });
    expect(reversed.targets[0]).toMatchObject({ originalDelta: -250, predictedBalance: 750 });
  });

  it('hides legacy, unsupported, child, and reversal-ledger actions', () => {
    const base = { sourceKind: 'wallet_transaction' as const, reversals: [], balances: {}, names: {} };
    expect(normalizeHistoryAction({ ...base, actor: parent, source: { id: 'legacy', type: 'deposit' } }).action).toBeUndefined();
    expect(normalizeHistoryAction({ ...base, actor: { id: 'child-1', role: 'child' }, source: { id: 'tx', type: 'deposit', effectSnapshot: effectSnapshot({ entityType: 'wallet_transaction', familyId: 'family-1', actorId: 'parent-1', childId: 'child-1', walletDeltaPence: 1 }) } }).action).toBeUndefined();
    expect(normalizeHistoryAction({ ...base, actor: parent, source: { id: 'reverse', type: 'reversal', effectSnapshot: effectSnapshot({ entityType: 'reversal', familyId: 'family-1', actorId: 'parent-1', childId: 'child-1', walletDeltaPence: 1 }) } }).action).toBeUndefined();
  });

  it('uses Cancel only for a pending request owned by the current parent', () => {
    const owned = normalizeHistoryAction({ sourceKind: 'transfer_request', source: { id: 'request-1', status: 'pending', fromChildId: 'parent-1', amountPence: 100 }, actor: parent, reversals: [], balances: {}, names: {} });
    const other = normalizeHistoryAction({ sourceKind: 'transfer_request', source: { id: 'request-2', status: 'pending', fromChildId: 'child-1', amountPence: 100 }, actor: parent, reversals: [], balances: {}, names: {} });
    expect(owned).toMatchObject({ action: 'cancel', actionLabel: 'Cancel' });
    expect(other.action).toBeUndefined();
  });
});
