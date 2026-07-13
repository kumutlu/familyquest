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
    const completedAt = { toDate: () => new Date('2026-07-13T10:00:00Z') };
    const reversed = normalizeHistoryAction({ sourceKind: 'fund_transaction', source, actor: parent, balances: { funds: { 'fund-1': 500 } }, names: { 'fund-1': 'Vet fund' }, reversals: [{ sourceKind: 'fund_transaction', sourceId: 'expense-1', reason: 'Duplicate', actorName: 'Owner', completedAt }] });
    expect(reversed.action).toBeUndefined();
    expect(reversed.actionLabel).toBe('Refund');
    expect(reversed.reversal).toMatchObject({ reason: 'Duplicate', actorName: 'Owner' });
    expect(reversed.reversal.occurredAt).toBe(completedAt);
    expect(reversed.targets[0]).toMatchObject({ originalDelta: -250, predictedBalance: 750 });
  });

  it('hides legacy, unsupported, child, and reversal-ledger actions', () => {
    const base = { sourceKind: 'wallet_transaction' as const, reversals: [], balances: {}, names: {} };
    expect(normalizeHistoryAction({ ...base, actor: parent, source: { id: 'legacy', type: 'deposit' } }).action).toBeUndefined();
    expect(normalizeHistoryAction({ ...base, actor: { id: 'child-1', role: 'child' }, source: { id: 'tx', type: 'deposit', effectSnapshot: effectSnapshot({ entityType: 'wallet_transaction', familyId: 'family-1', actorId: 'parent-1', childId: 'child-1', walletDeltaPence: 1 }) } }).action).toBeUndefined();
    expect(normalizeHistoryAction({ ...base, actor: parent, source: { id: 'reverse', type: 'reversal', effectSnapshot: effectSnapshot({ entityType: 'reversal', familyId: 'family-1', actorId: 'parent-1', childId: 'child-1', walletDeltaPence: 1 }) } }).action).toBeUndefined();
  });

  it.each([
    ['task_completion', { id: 'task-pending', status: 'pending_approval', assigneeId: 'child-1' }],
    ['transfer_request', { id: 'transfer-pending', status: 'pending', fromChildId: 'child-1' }],
    ['money_request', { id: 'money-pending', status: 'pending', requesterId: 'child-1' }],
    ['petbox_request', { id: 'pet-pending', status: 'pending', childId: 'child-1' }],
  ] as const)('offers parent cancellation for a real child-created %s', (sourceKind, source) => {
    expect(normalizeHistoryAction({ sourceKind, source, actor: parent, reversals: [], balances: {}, names: {} })).toMatchObject({ action: 'cancel', actionLabel: 'Cancel' });
  });

  it.each([
    ['behaviour_event', { id: 'behaviour-1', reason: 'Kind choice', childId: 'child-1', effectSnapshot: effectSnapshot({ entityType: 'behaviour_event', familyId: 'family-1', actorId: 'parent-1', childId: 'child-1', pointsDelta: 5 }) }, 'Kind choice', { points: { 'child-1': 20 } }],
    ['task_completion', { id: 'completion-1', taskId: 'task-1', effectSnapshot: effectSnapshot({ entityType: 'task_completion', familyId: 'family-1', actorId: 'parent-1', childId: 'child-1', pointsDelta: 10 }) }, 'Task completed: Tidy room', { points: { 'child-1': 20 } }],
    ['reward_redemption', { id: 'redemption-1', rewardId: 'reward-1', effectSnapshot: effectSnapshot({ entityType: 'reward_redemption', familyId: 'family-1', actorId: 'child-1', childId: 'child-1', rewardId: 'reward-1', pointsDelta: -10 }) }, 'Reward redeemed: Movie', { points: { 'child-1': 20 } }],
    ['transfer_request', { id: 'transfer-1', fromChildId: 'child-1', toChildId: 'child-2', effectSnapshot: effectSnapshot({ entityType: 'transfer_request', familyId: 'family-1', actorId: 'parent-1', childId: 'child-1', counterpartyChildId: 'child-2', walletDeltaPence: -100, counterpartyWalletDeltaPence: 100 }) }, 'Alex → Bea', { wallets: { 'child-1': 400, 'child-2': 200 } }],
    ['money_request', { id: 'money-1', requesterId: 'child-1', requestedFromId: 'child-2', effectSnapshot: effectSnapshot({ entityType: 'money_request', familyId: 'family-1', actorId: 'parent-1', childId: 'child-2', counterpartyChildId: 'child-1', walletDeltaPence: -100, counterpartyWalletDeltaPence: 100 }) }, 'Alex requested money from Bea', { wallets: { 'child-1': 400, 'child-2': 200 } }],
    ['petbox_request', { id: 'pet-1', childId: 'child-1', fundId: 'fund-1', effectSnapshot: effectSnapshot({ entityType: 'petbox_donation', familyId: 'family-1', actorId: 'parent-1', childId: 'child-1', fundId: 'fund-1', walletDeltaPence: -100, fundDeltaPence: 100 }) }, 'Alex donated to Vet fund', { wallets: { 'child-1': 400 }, funds: { 'fund-1': 500 } }],
  ] as const)('normalizes the %s source family with a meaningful summary', (sourceKind, source, summary, balances) => {
    const result = normalizeHistoryAction({ sourceKind, source, actor: parent, reversals: [], balances, names: { 'child-1': 'Alex', 'child-2': 'Bea', 'task-1': 'Tidy room', 'reward-1': 'Movie', 'fund-1': 'Vet fund' } });
    expect(result.summary).toBe(summary);
    expect(result.action).toBe('reverse');
  });
});
