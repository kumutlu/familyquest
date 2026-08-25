import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { ArrowDownRight, ArrowUpRight, ArrowRightLeft } from 'lucide-react';
import { HistoryActionControl } from '../reversals/HistoryActionControl';
import type { ReversalSourceKind } from '../../lib/reversalApi';
import { signedTransactionAmount, transactionPresentation } from '../../lib/walletPresentation';
import { formatDate } from '../../i18n/format';
import { WalletMoneyText } from '../privacy/WalletMoneyText';

interface TransactionDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: any;
  nameResolver?: (id: string) => string | undefined;
}

function formatDateTime(value: any): string {
  if (!value) return '';
  let date: Date | null = null;
  if (typeof value?.toMillis === 'function') date = new Date(value.toMillis());
  else if (typeof value?.seconds === 'number') date = new Date(value.seconds * 1000);
  else if (value instanceof Date) date = value;
  return date ? formatDate(date, undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

export function TransactionDetailsModal({
  isOpen,
  onClose,
  transaction,
  nameResolver,
}: TransactionDetailsModalProps) {
  const { t } = useTranslation('wallet');
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Capture the trigger element when the sheet opens and restore focus on close.
  useEffect(() => {
    if (!isOpen) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen || !transaction) return null;

  const amount = signedTransactionAmount(transaction);
  const isCredit = amount > 0;
  const isTransfer =
    transaction.type === 'transfer' ||
    transaction.type === 'transfer_in' ||
    transaction.type === 'transfer_out';
  const txAmount = Math.abs(amount);
  const txTitle = transactionPresentation(transaction, { t, nameResolver }).title;

  const date = formatDateTime(transaction.timestamp ?? transaction.createdAt);
  const sourceKind: ReversalSourceKind =
    transaction.type === 'transfer_request_out'
      ? 'transfer_request'
      : transaction.type === 'money_request'
        ? 'money_request'
        : transaction.type === 'petbox_donation_request'
          ? 'petbox_request'
          : 'wallet_transaction';

  const resolve = (id?: string) => (id ? nameResolver?.(id) : undefined);
  const parent = t('tx.parent');
  const anotherChild = t('tx.anotherChild');
  const petBox = t('tx.petBox');

  // Build a from/to line from available fields (no raw IDs leaked).
  let fromTo: string | null = null;
  if (transaction.type === 'deposit') {
    fromTo = t('tx.from', { name: resolve(transaction.parentRef) || parent });
  } else if (transaction.type === 'withdrawal') {
    fromTo = t('tx.by', { actor: resolve(transaction.parentRef) || parent });
  } else if (transaction.type === 'transfer_out') {
    fromTo = t('tx.to', { name: resolve(transaction.counterpartyChildId) || anotherChild });
  } else if (transaction.type === 'transfer_in') {
    fromTo = t('tx.from', { name: resolve(transaction.counterpartyChildId) || anotherChild });
  } else if (transaction.type === 'request_payment') {
    fromTo = t('tx.from', { name: resolve(transaction.actorId) || parent });
  } else if (transaction.type === 'petbox_donation') {
    fromTo = t('tx.to', { name: petBox });
  }

  const actor =
    transaction.createdByName ||
    transaction.reviewedByName ||
    (transaction.parentRef ? resolve(transaction.parentRef) || parent : null);

  const detailRows: { label: string; value: string }[] = [];
  if (fromTo) detailRows.push({ label: t('ledger.details.fromTo'), value: fromTo });
  if (actor) detailRows.push({ label: t('ledger.details.actor'), value: actor });
  if (transaction.note || transaction.message) {
    detailRows.push({ label: t('ledger.details.note'), value: transaction.note || transaction.message });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-details-title"
        onClick={e => e.stopPropagation()}
        className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-xl overflow-hidden flex flex-col max-h-[90dvh]"
      >
        <div
          className="px-6 py-4 flex justify-between items-center border-b border-gray-100 shrink-0"
          style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}
        >
          <h3 id="transaction-details-title" className="text-xl font-bold text-gray-900">
            {t('ledger.details.title')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('ledger.details.close')}
            className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          >
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          <div className="flex flex-col items-center justify-center py-4">
            <div
              className={`w-16 h-16 rounded-full flex items-center justify-center shrink-0 mb-4 ${
                isCredit ? 'bg-success-50 text-success-600' : 'bg-danger-50 text-danger-600'
              }`}
            >
              {isTransfer ? (
                <ArrowRightLeft size={32} aria-hidden="true" />
              ) : isCredit ? (
                <ArrowUpRight size={32} aria-hidden="true" />
              ) : (
                <ArrowDownRight size={32} aria-hidden="true" />
              )}
            </div>
            <h2
              className={`text-4xl font-extrabold tabular-nums ${
                isCredit ? 'text-success-600' : 'text-danger-600'
              }`}
            >
              {isCredit ? '+' : '-'}
              <CurrencyDisplay amountPence={txAmount} forceColor={false} privacy="wallet" />
            </h2>
            <p className="text-gray-500 font-medium mt-1 uppercase tracking-wider text-xs">
              <WalletMoneyText>{txTitle}</WalletMoneyText>
            </p>
          </div>

          <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-500 text-sm">{t('ledger.details.status')}</span>
              <span className="font-bold text-gray-900 text-sm capitalize">
                {transaction.status || t('ledger.details.completed')}
              </span>
            </div>
            {date && (
              <div className="flex justify-between">
                <span className="text-gray-500 text-sm">{t('ledger.details.date')}</span>
                <span className="font-medium text-gray-900 text-sm text-right">{date}</span>
              </div>
            )}
            {detailRows.map(row => (
              <div key={row.label} className="flex justify-between gap-4">
                <span className="text-gray-500 text-sm shrink-0">{row.label}</span>
                <span className="font-medium text-gray-900 text-sm text-right">
                  <WalletMoneyText>{row.value}</WalletMoneyText>
                </span>
              </div>
            ))}
            <div className="flex justify-between border-t border-gray-200 pt-3 mt-3">
              <span className="text-gray-400 text-xs">{t('ledger.details.reference')}</span>
              <span className="font-mono text-gray-400 text-xs">
                {String(transaction.id).slice(-6).toUpperCase()}
              </span>
            </div>
          </div>

          <div className="flex justify-end">
            <HistoryActionControl sourceKind={sourceKind} source={transaction} />
          </div>
        </div>
      </div>
    </div>
  );
}
