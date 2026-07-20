import { assertTraceableSource, type EffectSnapshot } from './reversalContracts';
import type { ReversalSourceKind } from './reversalApi';
import i18n from '../i18n/config';

export type HistoryActionType = 'cancel' | 'reverse';
export type HistoryActionUnit = 'money' | 'points';

export interface HistoryActionTarget {
  id: string;
  label: string;
  originalDelta: number;
  predictedBalance?: number;
  unit: HistoryActionUnit;
}

export interface HistoryAction {
  sourceKind: ReversalSourceKind;
  sourceId: string;
  summary: string;
  action?: HistoryActionType;
  actionLabel: 'cancelRequest' | 'undo' | 'refund';
  targets: HistoryActionTarget[];
  reversal?: any;
  source: any;
  isLegacy?: boolean;
}

interface NormalizeHistoryActionInput {
  sourceKind: ReversalSourceKind;
  source: any;
  actor: { id: string; role: string } | null;
  reversals: any[];
  balances: {
    wallets?: Record<string, number>;
    funds?: Record<string, number>;
    points?: Record<string, number>;
  };
  names: Record<string, string>;
}

export function historyActionContext(state: any) {
  return {
    actor: state.currentUser,
    reversals: state.reversals || [],
    names: Object.fromEntries([
      ...(state.familyMembers || []).map((member: any) => [member.id, member.displayName]),
      ...(state.funds || []).map((fund: any) => [fund.id, fund.name]),
      ...(state.tasks || []).map((task: any) => [task.id, task.title]),
      ...(state.rewards || []).map((reward: any) => [reward.id, reward.title]),
    ]),
    balances: {
      wallets: Object.fromEntries((state.childWallets || []).map((wallet: any) => [wallet.id, wallet.balance])),
      funds: Object.fromEntries((state.funds || []).map((fund: any) => [fund.id, fund.balance])),
      points: Object.fromEntries((state.familyMembers || []).map((member: any) => [member.id, member.rewardPoints || 0])),
    },
  };
}

export function findReversal(reversals: any[], sourceKind: ReversalSourceKind, sourceId: string) {
  return reversals.find(reversal => reversal.sourceKind === sourceKind && reversal.sourceId === sourceId);
}

const summaryFor = (sourceKind: ReversalSourceKind, source: any, names: Record<string, string>) => {
  if (source.note || source.reason || source.message || source.title) return source.note || source.reason || source.message || source.title;
  if (sourceKind === 'task_completion') return i18n.t('reversals:summary.taskCompleted', { name: names[source.taskId] || 'Task' });
  if (sourceKind === 'reward_redemption') return i18n.t('reversals:summary.rewardRedeemed', { name: names[source.rewardId] || 'Reward' });
  if (sourceKind === 'transfer_request') return i18n.t('reversals:summary.transfer', { from: names[source.fromChildId] || 'Child', to: names[source.toChildId] || 'Child' });
  if (sourceKind === 'money_request') return i18n.t('reversals:summary.moneyRequest', { requester: names[source.requesterId] || 'Child', target: names[source.requestedFromId] || 'family' });
  if (sourceKind === 'petbox_request') return i18n.t('reversals:summary.petBoxDonation', { child: names[source.childId] || 'Child', fund: names[source.fundId] || 'fund' });
  if (sourceKind === 'profile_update') return i18n.t('reversals:summary.profileUpdate', { child: names[source.childId] || 'Child' });
  if (sourceKind === 'goal_request') return i18n.t(source.requestType === 'withdrawal' ? 'reversals:summary.goalWithdrawal' : 'reversals:summary.goalContribution', { child: names[source.childId] || 'Child' });
  return source.type?.replaceAll('_', ' ') || i18n.t('reversals:summary.recordedAction');
};

const canonicalEntityTypes: Record<ReversalSourceKind, readonly string[]> = {
  wallet_transaction: ['wallet_transaction', 'wallet_transfer'],
  fund_transaction: ['fund_transaction'],
  behaviour_event: ['behaviour_event'],
  task_completion: ['task_completion'],
  reward_redemption: ['reward_redemption'],
  transfer_request: ['transfer_request'],
  money_request: ['money_request'],
  petbox_request: ['petbox_donation'],
  profile_update: [],
  goal_request: ['goal_contribution_request', 'goal_withdrawal_request'],
};

function targetsFor(snapshot: EffectSnapshot | undefined, balances: NormalizeHistoryActionInput['balances'], names: Record<string, string>): HistoryActionTarget[] {
  if (!snapshot) return [];
  const targets: HistoryActionTarget[] = [];
  const add = (id: string | undefined, label: string, delta: number | undefined, balance: number | undefined, unit: HistoryActionUnit) => {
    if (!id || delta === undefined) return;
    targets.push({ id, label, originalDelta: delta, ...(balance !== undefined ? { predictedBalance: balance - delta } : {}), unit });
  };
  add(snapshot.childId, i18n.t('reversals:target.wallet', { name: names[snapshot.childId || ''] || 'Child' }), snapshot.walletDeltaPence, balances.wallets?.[snapshot.childId || ''], 'money');
  add(snapshot.counterpartyChildId, i18n.t('reversals:target.wallet', { name: names[snapshot.counterpartyChildId || ''] || 'Child' }), snapshot.counterpartyWalletDeltaPence, balances.wallets?.[snapshot.counterpartyChildId || ''], 'money');
  add(snapshot.fundId, i18n.t('reversals:target.fund'), snapshot.fundDeltaPence, balances.funds?.[snapshot.fundId || ''], 'money');
  add(snapshot.childId, i18n.t('reversals:target.points', { name: names[snapshot.childId || ''] || 'Child' }), snapshot.pointsDelta, balances.points?.[snapshot.childId || ''], 'points');
  return targets;
}

export function normalizeHistoryAction(input: NormalizeHistoryActionInput): HistoryAction {
  const { sourceKind, source, actor, reversals, balances, names } = input;
  let snapshot = source.effectSnapshot as EffectSnapshot | undefined;
  let isLegacy = false;
  if (!snapshot) {
    try {
      const synthesized = assertTraceableSource(source, sourceKind, source.id);
      snapshot = synthesized.effectSnapshot;
    } catch {
      if (sourceKind === 'petbox_request' && source.status === 'approved') {
        isLegacy = true;
      }
    }
  }
  const storedReversal = findReversal(reversals, sourceKind, source.id);
  const reversal = storedReversal ? { ...storedReversal, occurredAt: storedReversal.completedAt ?? storedReversal.createdAt } : undefined;
  const targets = targetsFor(snapshot, balances, names);
  const refund = targets.some(target => target.originalDelta < 0);
  const normalized: HistoryAction = {
    sourceKind, sourceId: source.id, source, targets, reversal, isLegacy,
    summary: summaryFor(sourceKind, source, names), actionLabel: refund ? 'refund' : 'undo',
  };
  if (!actor || !['parent', 'owner'].includes(actor.role)) return normalized;

  if (source.status === 'pending' || source.status === 'pending_acceptance' || source.status === 'pending_approval') {
    if (['task_completion', 'transfer_request', 'money_request', 'petbox_request'].includes(sourceKind)) {
      return { ...normalized, action: 'cancel', actionLabel: 'cancelRequest' };
    }
    return normalized;
  }

  const hasEveryBalance = targets.length > 0 && targets.every(target => target.predictedBalance !== undefined);
  const isCanonicalSource = snapshot?.schemaVersion === 1
    && canonicalEntityTypes[sourceKind].includes(snapshot.entityType)
    && (!snapshot.sourceRequestId || snapshot.sourceRequestId === source.id);
  if (!reversal && source.type !== 'reversal' && isCanonicalSource && hasEveryBalance) {
    return { ...normalized, action: 'reverse' };
  }
  return normalized;
}
