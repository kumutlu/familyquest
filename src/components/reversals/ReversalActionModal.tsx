import { useRef, useState } from 'react';
import type { HistoryAction } from '../../lib/reversalHistory';
import { reverseTransaction } from '../../lib/reversalApi';
import { Button } from '../ui/Button';

interface ReversalActionModalProps {
  open: boolean;
  familyId: string;
  historyAction: HistoryAction | null;
  onClose: () => void;
  onCancel?: (action: HistoryAction, reason: string) => Promise<unknown>;
  onSuccess?: (action: HistoryAction, reason: string) => void;
}

const signedValue = (amount: number, unit: 'money' | 'points') => unit === 'money'
  ? `${amount >= 0 ? '+' : '-'}£${(Math.abs(amount) / 100).toFixed(2)}`
  : `${amount >= 0 ? '+' : ''}${amount} pts`;

const balanceValue = (amount: number, unit: 'money' | 'points') => unit === 'money'
  ? `£${(amount / 100).toFixed(2)}` : `${amount} pts`;

export function ReversalActionModal({ open, familyId, historyAction, onClose, onCancel, onSuccess }: ReversalActionModalProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  if (!open || !historyAction?.action) return null;

  const submit = async () => {
    if (inFlight.current) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setError('Reason must be at least 3 characters.');
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setError('');
    try {
      if (historyAction.action === 'cancel') {
        if (!onCancel) throw new Error('Cancellation is not supported for this action');
        await onCancel(historyAction, trimmed);
      } else {
        await reverseTransaction({ familyId, sourceKind: historyAction.sourceKind, sourceId: historyAction.sourceId, reason: trimmed });
      }
      onSuccess?.(historyAction, trimmed);
      onClose();
    } catch (err: any) {
      setError(`${err?.code ? `${err.code}: ` : ''}${err?.message || 'Action failed.'}`);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const loadingLabel = historyAction.actionLabel === 'Refund' ? 'Refunding…'
    : historyAction.actionLabel === 'Cancel' ? 'Cancelling…' : 'Reversing…';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <h2 className="text-xl font-bold text-gray-900">{historyAction.actionLabel} action</h2>
        <p className="mt-1 text-sm text-gray-600">{historyAction.summary}</p>
        <div className="mt-4 space-y-2 rounded-2xl bg-gray-50 p-4">
          {historyAction.targets.map(target => (
            <div key={`${target.id}:${target.unit}`} className="text-sm">
              <p className="font-semibold text-gray-900">{target.label}</p>
              <p className="text-gray-600">Original: {signedValue(target.originalDelta, target.unit)}</p>
              {target.predictedBalance !== undefined && <p className="text-gray-600">Predicted balance: {balanceValue(target.predictedBalance, target.unit)}</p>}
            </div>
          ))}
        </div>
        <p className="mt-4 rounded-xl bg-warning-50 p-3 text-sm font-medium text-warning-800">This creates a linked reversal record. The original action will remain in history.</p>
        <label className="mt-4 block text-sm font-semibold text-gray-700" htmlFor="reversal-reason">Reason</label>
        <textarea id="reversal-reason" aria-label="Reason" value={reason} onChange={event => setReason(event.target.value)} className="mt-1 min-h-20 w-full rounded-xl border border-gray-200 p-3" />
        {error && <p role="alert" className="mt-2 text-sm font-medium text-danger-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Keep action</Button>
          <Button variant={historyAction.action === 'cancel' ? 'danger' : 'primary'} onClick={submit} disabled={loading}>
            {loading ? loadingLabel : historyAction.actionLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
