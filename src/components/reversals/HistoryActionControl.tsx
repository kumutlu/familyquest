import { useState } from 'react';
import { cancelPendingApproval, type PendingApprovalKind } from '../../lib/api';
import { historyActionContext, normalizeHistoryAction, type HistoryAction } from '../../lib/reversalHistory';
import type { ReversalSourceKind } from '../../lib/reversalApi';
import { useStore } from '../../store/useStore';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ReversalActionModal } from './ReversalActionModal';

const cancelKinds: Partial<Record<ReversalSourceKind, PendingApprovalKind>> = {
  task_completion: 'task', transfer_request: 'transfer', money_request: 'money_request', petbox_request: 'petbox',
};

const auditDate = (value: any) => {
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value || 0);
  return date.toLocaleString();
};

export function HistoryActionControl({ sourceKind, source }: { sourceKind: ReversalSourceKind; source: any }) {
  const state = useStore();
  const [selected, setSelected] = useState<HistoryAction | null>(null);
  const [optimisticReversal, setOptimisticReversal] = useState<any>(null);
  const [cancelled, setCancelled] = useState(false);
  const context = historyActionContext(state);
  const action = normalizeHistoryAction({
    sourceKind, source,
    ...context,
    reversals: optimisticReversal ? [...context.reversals, optimisticReversal] : context.reversals,
  });

  if (cancelled || source.status === 'cancelled') return <Badge variant="danger">Cancelled</Badge>;
  if (action.isLegacy) return <span className="text-xs text-gray-500">Legacy donation — refund unavailable</span>;
  if (!action.action && !action.reversal) return null;

  const cancel = async (historyAction: HistoryAction) => {
    const kind = cancelKinds[historyAction.sourceKind];
    if (!kind) throw new Error('Cancellation is not supported for this action');
    await cancelPendingApproval(state.currentUser.familyId, kind, historyAction.sourceId);
    setCancelled(true);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      {action.reversal ? (
        <div className="text-right text-xs text-gray-600">
          <Badge variant="danger">{sourceKind === 'petbox_request' ? 'Refunded' : 'Reversed'}</Badge>
          <p className="mt-1 font-medium">{action.reversal.reason}</p>
          <p>by {action.reversal.actorName} · {auditDate(action.reversal.occurredAt)}</p>
        </div>
      ) : action.action ? (
        <Button size="sm" variant={action.action === 'cancel' ? 'danger' : 'secondary'} onClick={() => {
          if (action.action === 'cancel') {
            cancel(action);
          } else {
            setSelected(action);
          }
        }}>
          {action.actionLabel}
        </Button>
      ) : null}
      <ReversalActionModal
        open={!!selected}
        familyId={state.currentUser?.familyId || ''}
        historyAction={selected}
        onClose={() => setSelected(null)}
        onCancel={cancel}
        onSuccess={(completedAction, reason, result) => {
          if (completedAction.action === 'cancel') {
            setCancelled(true);
          } else if (result?.status !== 'already_reversed') {
            setOptimisticReversal({
              sourceKind: completedAction.sourceKind, sourceId: completedAction.sourceId, reason,
              actorName: state.currentUser.displayName || 'Parent', completedAt: new Date(),
            });
          }
        }}
      />
    </div>
  );
}
