/**
 * Transaction History v2 - Transaction Details Sheet
 * ==================================================
 * Bottom sheet with full transaction details.
 */

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getTransactionAmountPrefix,
  getTransactionDisplayAmount,
  type NormalizedTransaction,
} from '../../lib/transactionModel';
import { currencyCodeFromSymbol, formatDate, formatPence } from '../../i18n/format';
import { Badge } from '../ui/Badge';
import { HistoryActionControl } from '../reversals/HistoryActionControl';
import { TransactionIcon } from './TransactionIcon';
import type { HistoryActionSource } from './historySourceResolver';

interface TransactionDetailsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: NormalizedTransaction | null;
  nameResolver?: (id: string) => string | undefined;
  goalResolver?: (id: string) => {
    title?: string;
    targetAmountPence?: number;
    currentAmountPence?: number;
  } | undefined;
  actionSource?: HistoryActionSource | null;
  currency: string;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function TransactionDetailsSheet({
  isOpen,
  onClose,
  transaction,
  nameResolver,
  goalResolver,
  actionSource,
  currency,
}: TransactionDetailsSheetProps) {
  const { t } = useTranslation(['wallet', 'goals', 'rewards', 'reversals']);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Capture the trigger element when the sheet opens and restore focus on close
  useEffect(() => {
    if (!isOpen) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const nestedDialog = dialog.querySelector('[role="dialog"][aria-modal="true"]');
      if (nestedDialog) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

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
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen || !transaction) return null;

  const {
    id,
    timestamp,
    direction,
    title,
    subtitle,
    balanceAfter,
    childId,
    parentRef,
    goalId,
    note,
    reversalReason,
    isReversed,
    isPending,
    isCompleted,
  } = transaction;

  const isCredit = direction === 'in';
  const amountPrefix = getTransactionAmountPrefix(transaction);
  const displayAmount = getTransactionDisplayAmount(
    transaction,
    points => t('wallet:ledger.points', { count: points }),
  );
  const date = formatDate(new Date(timestamp), undefined, { dateStyle: 'medium', timeStyle: 'short' });

  const childName = childId ? nameResolver?.(childId) : undefined;
  const parentName = parentRef ? nameResolver?.(parentRef) : undefined;
  const goal = goalId ? goalResolver?.(goalId) : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-details-title"
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-xl overflow-hidden flex flex-col max-h-[90dvh]"
      >
        <div
          className="px-6 py-4 flex justify-between items-center border-b border-gray-100 shrink-0"
          style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}
        >
          <h3 id="transaction-details-title" className="text-xl font-bold text-gray-900">
            {t('wallet:ledger.details.title') ?? 'Transaction Details'}
          </h3>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t('wallet:ledger.details.close')}
            className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          >
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          {/* Header with amount and icon */}
          <div className="flex flex-col items-center justify-center py-2">
            <div
              className={`w-16 h-16 rounded-full flex items-center justify-center shrink-0 mb-4 ${
                isCredit ? 'bg-success-50 text-success-600' : 'bg-danger-50 text-danger-600'
              }`}
            >
              <TransactionIcon iconName={transaction.icon} size={32} />
            </div>
            <h2
              className={`text-4xl font-extrabold tabular-nums ${
                isCredit ? 'text-success-600' : 'text-danger-600'
              }`}
            >
              {amountPrefix}
              {displayAmount}
            </h2>
            <p className="text-gray-500 font-medium mt-1 uppercase tracking-wider text-xs">
              {title}
            </p>
          </div>

          {/* Status badges */}
          <div className="flex justify-center gap-2">
            {isPending && <Badge variant="warning">{t('wallet:ledger.details.pending')}</Badge>}
            {isReversed && <Badge variant="danger">{t('reversals:reversed')}</Badge>}
            {!isPending && !isReversed && isCompleted && (
              <Badge variant="default">{t('wallet:ledger.details.completed')}</Badge>
            )}
          </div>

          {/* Detail rows */}
          <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-gray-500 text-sm">{t('wallet:ledger.details.date')}</span>
                <p className="font-medium text-gray-900 text-sm">{date}</p>
              </div>
              <div>
                <span className="text-gray-500 text-sm">{t('wallet:ledger.details.type')}</span>
                <p className="font-medium text-gray-900 text-sm">{title}</p>
              </div>
            </div>

            {childName && (
              <div>
                <span className="text-gray-500 text-sm">{t('wallet:ledger.details.child')}</span>
                <p className="font-medium text-gray-900 text-sm">{childName}</p>
              </div>
            )}

            {parentName && (
              <div>
                <span className="text-gray-500 text-sm">{t('wallet:ledger.details.actor')}</span>
                <p className="font-medium text-gray-900 text-sm">{parentName}</p>
              </div>
            )}

            {goal && (
              <div>
                <span className="text-gray-500 text-sm">{t('goals:title')}</span>
                <p className="font-medium text-gray-900 text-sm">{goal.title}</p>
              </div>
            )}

            {subtitle && (
              <div>
                <span className="text-gray-500 text-sm">{t('wallet:ledger.details.fromTo')}</span>
                <p className="font-medium text-gray-900 text-sm">{subtitle}</p>
              </div>
            )}

            {note && (
              <div>
                <span className="text-gray-500 text-sm">{t('wallet:ledger.details.note')}</span>
                <p className="font-medium text-gray-900 text-sm">{note}</p>
              </div>
            )}

            {balanceAfter !== undefined && (
              <div>
                <span className="text-gray-500 text-sm">{t('wallet:ledger.details.balanceAfter')}</span>
                <p className="font-medium text-gray-900 text-sm">
                  {formatPence(balanceAfter, currencyCodeFromSymbol(currency))}
                </p>
              </div>
            )}

            {isReversed && reversalReason && (
              <div>
                <span className="text-gray-500 text-sm">{t('reversals:modal.reason')}</span>
                <p className="font-medium text-gray-900 text-sm">{reversalReason}</p>
              </div>
            )}

            <div className="flex justify-between border-t border-gray-200 pt-3 mt-3">
              <span className="text-gray-400 text-xs">{t('wallet:ledger.details.reference')}</span>
              <span className="font-mono text-gray-400 text-xs">
                {String(id).slice(-6).toUpperCase()}
              </span>
            </div>
          </div>

          {/* Reversal control */}
          {actionSource && (
            <HistoryActionControl
              sourceKind={actionSource.sourceKind}
              source={actionSource.source}
            />
          )}
        </div>
      </div>
    </div>
  );
}
