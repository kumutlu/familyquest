import type { EffectSnapshot } from './reversalContracts';
import type { ReversalSourceKind } from './reversalApi';

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
  actionLabel: 'Cancel' | 'Reverse' | 'Refund';
  targets: HistoryActionTarget[];
  reversal?: any;
  source: any;
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

const originatorField: Partial<Record<ReversalSourceKind, string>> = {
  transfer_request: 'fromChildId', money_request: 'requesterId', petbox_request: 'childId', task_completion: 'assigneeId',
};

export function findReversal(reversals: any[], sourceKind: ReversalSourceKind, sourceId: string) {
  return reversals.find(reversal => reversal.sourceKind === sourceKind && reversal.sourceId === sourceId);
}

const summaryFor = (source: any) => source.note || source.reason || source.message || source.title || source.type?.replaceAll('_', ' ') || 'Recorded action';

function targetsFor(snapshot: EffectSnapshot | undefined, balances: NormalizeHistoryActionInput['balances'], names: Record<string, string>): HistoryActionTarget[] {
  if (!snapshot) return [];
  const targets: HistoryActionTarget[] = [];
  const add = (id: string | undefined, label: string, delta: number | undefined, balance: number | undefined, unit: HistoryActionUnit) => {
    if (!id || delta === undefined) return;
    targets.push({ id, label, originalDelta: delta, ...(balance !== undefined ? { predictedBalance: balance - delta } : {}), unit });
  };
  add(snapshot.childId, `${names[snapshot.childId || ''] || 'Child'} wallet`, snapshot.walletDeltaPence, balances.wallets?.[snapshot.childId || ''], 'money');
  add(snapshot.counterpartyChildId, `${names[snapshot.counterpartyChildId || ''] || 'Child'} wallet`, snapshot.counterpartyWalletDeltaPence, balances.wallets?.[snapshot.counterpartyChildId || ''], 'money');
  add(snapshot.fundId, names[snapshot.fundId || ''] || 'Fund', snapshot.fundDeltaPence, balances.funds?.[snapshot.fundId || ''], 'money');
  add(snapshot.childId, `${names[snapshot.childId || ''] || 'Child'} points`, snapshot.pointsDelta, balances.points?.[snapshot.childId || ''], 'points');
  return targets;
}

export function normalizeHistoryAction(input: NormalizeHistoryActionInput): HistoryAction {
  const { sourceKind, source, actor, reversals, balances, names } = input;
  const snapshot = source.effectSnapshot as EffectSnapshot | undefined;
  const reversal = findReversal(reversals, sourceKind, source.id);
  const targets = targetsFor(snapshot, balances, names);
  const refund = targets.some(target => target.originalDelta < 0);
  const normalized: HistoryAction = {
    sourceKind, sourceId: source.id, source, targets, reversal,
    summary: summaryFor(source), actionLabel: refund ? 'Refund' : 'Reverse',
  };
  if (!actor || !['parent', 'owner'].includes(actor.role)) return normalized;

  if (source.status === 'pending' || source.status === 'pending_acceptance' || source.status === 'pending_approval') {
    const field = originatorField[sourceKind];
    if (field && source[field] === actor.id) return { ...normalized, action: 'cancel', actionLabel: 'Cancel' };
    return normalized;
  }

  const hasEveryBalance = targets.length > 0 && targets.every(target => target.predictedBalance !== undefined);
  if (!reversal && source.type !== 'reversal' && snapshot?.schemaVersion === 1 && snapshot.entityType !== 'reversal' && hasEveryBalance) {
    return { ...normalized, action: 'reverse' };
  }
  return normalized;
}
