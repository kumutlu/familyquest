import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HistoryAction } from '../../lib/reversalHistory';
import { reverseTransaction } from '../../lib/reversalApi';
import { useStore } from '../../store/useStore';
import { formatPence, resolveFamilyCurrencyCode } from '../../i18n/format';
import { Button } from '../ui/Button';

interface ReversalActionModalProps {
  open: boolean;
  familyId: string;
  historyAction: HistoryAction | null;
  onClose: () => void;
  onCancel?: (action: HistoryAction, reason: string) => Promise<unknown>;
  onSuccess?: (action: HistoryAction, reason: string, result?: { status?: string }) => void;
}

const signedValue = (amount: number, unit: 'money' | 'points', currencyCode: string) => unit === 'money'
  ? `${amount >= 0 ? '+' : '-'}${formatPence(Math.abs(amount), currencyCode)}`
  : `${amount >= 0 ? '+' : ''}${amount} pts`;

const balanceValue = (amount: number, unit: 'money' | 'points', currencyCode: string) => unit === 'money'
  ? formatPence(amount, currencyCode) : `${amount} pts`;

export function ReversalActionModal({ open, familyId, historyAction, onClose, onCancel, onSuccess }: ReversalActionModalProps) {
  const { t } = useTranslation('reversals');
  const state = useStore();
  const currencyCode = resolveFamilyCurrencyCode(state.familyData);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const isRefund = historyAction?.actionLabel === 'refund';
  useEffect(() => {
    if (!open) return;
    setReason(isRefund ? t('modal.donationRefunded') : '');
    setError('');
    setLoading(false);
    inFlight.current = false;
  }, [open, isRefund, historyAction?.sourceId, historyAction?.sourceKind, t]);
  if (!open || !historyAction?.action) return null;

  const submit = async () => {
    if (inFlight.current) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setError(t('modal.reasonRequired'));
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setError('');
    try {
      let result: { status?: string } | undefined;
      if (historyAction.action === 'cancel') {
        if (!onCancel) throw new Error('Cancellation is not supported for this action');
        await onCancel(historyAction, trimmed);
      } else {
        result = await reverseTransaction({ familyId, sourceKind: historyAction.sourceKind, sourceId: historyAction.sourceId, reason: trimmed });
      }
      onSuccess?.(historyAction, trimmed, result);
      onClose();
    } catch (err: any) {
      setError(`${err?.code ? `${err.code}: ` : ''}${err?.message || t('modal.actionFailed')}`);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  const loadingLabel = t(`modal.loading.${historyAction.actionLabel}`);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <h2 className="text-xl font-bold text-gray-900">
          {historyAction.actionLabel === 'refund' ? t('modal.refundDonation') : t('modal.actionTitle', { actionLabel: t(`actionLabel.${historyAction.actionLabel}`) })}
        </h2>
        <p className="mt-1 text-sm text-gray-600">{historyAction.summary}</p>
        <div className="mt-4 space-y-2 rounded-2xl bg-gray-50 p-4">
          {historyAction.targets.map(target => (
            <div key={`${target.id}:${target.unit}`} className="text-sm">
              <p className="font-semibold text-gray-900">{target.label}</p>
              <p className="text-gray-600">{t('modal.original', { value: signedValue(target.originalDelta, target.unit, currencyCode) })}</p>
              {target.predictedBalance !== undefined && <p className="text-gray-600">{t('modal.predictedBalance', { value: balanceValue(target.predictedBalance, target.unit, currencyCode) })}</p>}
            </div>
          ))}
        </div>
        <p className="mt-4 rounded-xl bg-warning-50 p-3 text-sm font-medium text-warning-800">
          {historyAction.action === 'cancel'
            ? t('modal.cancelNoBalance')
            : t('modal.createsReversal')}
        </p>
        <label className="mt-4 block text-sm font-semibold text-gray-700" htmlFor="reversal-reason">
          {isRefund ? t('modal.reasonOptional') : t('modal.reason')}
        </label>
        <textarea id="reversal-reason" aria-label={t('modal.reason')} value={reason} onChange={event => setReason(event.target.value)} className="mt-1 min-h-20 w-full rounded-xl border border-gray-200 p-3" />
        {error && <p role="alert" className="mt-2 text-sm font-medium text-danger-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>{t('modal.keepAction')}</Button>
          <Button variant={historyAction.action === 'cancel' ? 'danger' : 'primary'} onClick={submit} disabled={loading}>
            {loading ? loadingLabel : t(`actionLabel.${historyAction.actionLabel}`)}
          </Button>
        </div>
      </div>
    </div>
  );
}
