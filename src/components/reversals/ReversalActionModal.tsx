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

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

type PointsFormatter = (points: number) => string;

const signedValue = (
  amount: number,
  unit: 'money' | 'points',
  currencyCode: string,
  formatPoints: PointsFormatter,
) => unit === 'money'
  ? `${amount >= 0 ? '+' : '-'}${formatPence(Math.abs(amount), currencyCode)}`
  : `${amount >= 0 ? '+' : '-'}${formatPoints(Math.abs(amount))}`;

const balanceValue = (
  amount: number,
  unit: 'money' | 'points',
  currencyCode: string,
  formatPoints: PointsFormatter,
) => unit === 'money'
  ? formatPence(amount, currencyCode)
  : formatPoints(amount);

export function ReversalActionModal({ open, familyId, historyAction, onClose, onCancel, onSuccess }: ReversalActionModalProps) {
  const { t } = useTranslation(['reversals', 'wallet']);
  const state = useStore();
  const currencyCode = resolveFamilyCurrencyCode(state.familyData);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isRefund = historyAction?.actionLabel === 'refund';
  useEffect(() => {
    if (!open) return;
    setReason(isRefund ? t('modal.donationRefunded') : '');
    setError('');
    setLoading(false);
    inFlight.current = false;
  }, [open, isRefund, historyAction?.sourceId, historyAction?.sourceKind, t]);

  useEffect(() => {
    if (!open || !historyAction?.action) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    reasonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter(element => element.getAttribute('aria-hidden') !== 'true');
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [open, historyAction?.action]);

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
  const formatPoints = (points: number) => t('wallet:ledger.points', { count: points });
  const title = historyAction.actionLabel === 'refund'
    ? t('modal.refundDonation')
    : t('modal.actionTitle', { actionLabel: t(`actionLabel.${historyAction.actionLabel}`) });

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reversal-action-title"
      tabIndex={-1}
    >
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <h2 id="reversal-action-title" className="text-xl font-bold text-gray-900">
          {title}
        </h2>
        <p className="mt-1 text-sm text-gray-600">{historyAction.summary}</p>
        <div className="mt-4 space-y-2 rounded-2xl bg-gray-50 p-4">
          {historyAction.targets.map(target => (
            <div key={`${target.id}:${target.unit}`} className="text-sm">
              <p className="font-semibold text-gray-900">{target.label}</p>
              <p className="text-gray-600">{t('modal.original', { value: signedValue(target.originalDelta, target.unit, currencyCode, formatPoints) })}</p>
              {target.predictedBalance !== undefined && <p className="text-gray-600">{t('modal.predictedBalance', { value: balanceValue(target.predictedBalance, target.unit, currencyCode, formatPoints) })}</p>}
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
        <textarea ref={reasonRef} id="reversal-reason" aria-label={t('modal.reason')} value={reason} onChange={event => setReason(event.target.value)} className="mt-1 min-h-20 w-full rounded-xl border border-gray-200 p-3" />
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
