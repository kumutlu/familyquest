import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { cancelPendingApproval, type PendingApprovalKind } from '../../lib/api';
import { normalizeHistoryAction, type HistoryAction } from '../../lib/reversalHistory';
import type { ReversalSourceKind } from '../../lib/reversalApi';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { ReversalActionModal } from './ReversalActionModal';
import { attributeHistorySource } from '../../lib/activityAttribution';
import { formatDate } from '../../i18n/format';

const sourceDate = (source: any) => {
  const value = source.createdAt || source.timestamp || source.completedAt || source.approvedAt || source.redeemedAt;
  return value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(0);
};

const reversalDate = (value: any) => value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value || 0);

/** "Today • 08:15" for today's entries, otherwise "13 Jul 2026 • 08:15". */
const entryTimestamp = (value: Date | null) => {
  if (!value || value.getTime() === 0) return '';
  const time = formatDate(value, undefined, { hour: '2-digit', minute: '2-digit' });
  const isToday = value.toDateString() === new Date().toDateString();
  return isToday ? time : `${formatDate(value)} • ${time}`;
};

export function ReversalHistoryPanel() {
  const { t } = useTranslation('reversals');
  const state = useStore();
  const [selected, setSelected] = useState<HistoryAction | null>(null);
  const [optimisticReversals, setOptimisticReversals] = useState<any[]>([]);
  const currentUser = state.currentUser;
  const isParent = currentUser && ['parent', 'owner'].includes(currentUser.role);

  const actions = useMemo(() => {
    if (!isParent) return [];
    const names = Object.fromEntries([
      ...state.familyMembers.map((member: any) => [member.id, member.displayName]),
      ...state.funds.map((fund: any) => [fund.id, fund.name]),
      ...(state.tasks || []).map((task: any) => [task.id, task.title]),
      ...(state.rewards || []).map((reward: any) => [reward.id, reward.title]),
    ]);
    const balances = {
      wallets: Object.fromEntries(state.childWallets.map((wallet: any) => [wallet.id, wallet.balance])),
      funds: Object.fromEntries(state.funds.map((fund: any) => [fund.id, fund.balance])),
      points: Object.fromEntries(state.familyMembers.map((member: any) => [member.id, member.rewardPoints || 0])),
    };
    const reversals = [...state.reversals, ...optimisticReversals.filter(item => !state.reversals.some((saved: any) => saved.sourceKind === item.sourceKind && saved.sourceId === item.sourceId))];
    const sources: Array<{ sourceKind: ReversalSourceKind; source: any }> = [
      ...state.walletTransactions.filter((source: any) => ['deposit', 'withdrawal', 'transfer'].includes(source.type)).map((source: any) => ({ sourceKind: 'wallet_transaction' as const, source })),
      ...state.fundTransactions.filter((source: any) => source.type === 'expense').map((source: any) => ({ sourceKind: 'fund_transaction' as const, source })),
      ...state.behaviourEvents.map((source: any) => ({ sourceKind: 'behaviour_event' as const, source })),
      ...state.taskCompletions.map((source: any) => ({ sourceKind: 'task_completion' as const, source })),
      ...state.redemptions.map((source: any) => ({ sourceKind: 'reward_redemption' as const, source })),
      ...state.transferRequests.map((source: any) => ({ sourceKind: 'transfer_request' as const, source })),
      ...state.moneyRequests.map((source: any) => ({ sourceKind: 'money_request' as const, source })),
      ...state.petboxRequests.map((source: any) => ({ sourceKind: 'petbox_request' as const, source })),
    ];
    return sources
      .map(({ sourceKind, source }) => normalizeHistoryAction({ sourceKind, source, actor: currentUser, reversals, balances, names }))
      .filter(action => action.action || action.reversal)
      .sort((left, right) => sourceDate(right.source).getTime() - sourceDate(left.source).getTime())
      .slice(0, 20);
  }, [currentUser, isParent, optimisticReversals, state.behaviourEvents, state.childWallets, state.familyMembers, state.fundTransactions, state.funds, state.moneyRequests, state.petboxRequests, state.redemptions, state.reversals, state.rewards, state.taskCompletions, state.tasks, state.transferRequests, state.walletTransactions]);

  if (!isParent || actions.length === 0) return null;

  const cancel = async (action: HistoryAction) => {
    const kindBySource: Partial<Record<ReversalSourceKind, PendingApprovalKind>> = {
      task_completion: 'task', transfer_request: 'transfer', money_request: 'money_request', petbox_request: 'petbox',
    };
    const kind = kindBySource[action.sourceKind];
    if (!kind) throw new Error('Cancellation is not supported for this action');
    await cancelPendingApproval(currentUser.familyId, kind, action.sourceId);
  };

  return (
    <section>
      <h2 className="mb-4 text-lg font-bold text-gray-900">{t('title')}</h2>
      <div className="space-y-3">
        {actions.map(action => {
          const attribution = attributeHistorySource(action.sourceKind, action.source, {
            tasks: state.tasks,
            familyMembers: state.familyMembers,
          });
          const occurredAt = entryTimestamp(sourceDate(action.source));
          return (
          <Card key={`${action.sourceKind}:${action.sourceId}`}>
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div>
                {attribution.subjectName && (
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {t('entry.by', { name: attribution.subjectName })}
                  </p>
                )}
                <p className="font-semibold text-gray-900">{attribution.taskTitle || action.summary}</p>
                {attribution.points !== undefined && (
                  <p className={`mt-0.5 text-sm font-bold ${attribution.points > 0 ? 'text-success-600' : 'text-danger-600'}`}>
                    {t('entry.points', { sign: attribution.points > 0 ? '+' : '−', points: Math.abs(attribution.points) })}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  {action.sourceKind.replaceAll('_', ' ')}{occurredAt ? ` • ${occurredAt}` : ''}
                </p>
                {attribution.approverName && (
                  <p className="text-xs text-gray-500">{t('entry.approvedBy', { name: attribution.approverName })}</p>
                )}
                {action.reversal && (
                  <div className="mt-2 text-xs text-gray-600">
                    <Badge variant="danger">{t('reversed')}</Badge>
                    <p className="mt-1 font-medium">{action.reversal.reason}</p>
                    <p>{t('byActor', { actor: action.reversal.actorName, date: reversalDate(action.reversal.occurredAt) })}</p>
                  </div>
                )}
              </div>
              {action.action && <Button size="sm" variant={action.action === 'cancel' ? 'danger' : 'secondary'} onClick={() => setSelected(action)}>{t(`actionLabel.${action.actionLabel}`)}</Button>}
            </CardContent>
          </Card>
          );
        })}
      </div>
      <ReversalActionModal
        open={!!selected}
        familyId={currentUser.familyId}
        historyAction={selected}
        onClose={() => setSelected(null)}
        onCancel={cancel}
        onSuccess={(action, reason, result) => {
          if (action.action !== 'reverse' || result?.status === 'already_reversed') return;
          setOptimisticReversals(previous => [...previous, {
            sourceKind: action.sourceKind, sourceId: action.sourceId, reason,
            actorName: currentUser.displayName || 'Parent', createdAt: new Date(),
          }]);
        }}
      />
    </section>
  );
}
