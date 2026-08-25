/**
 * Transaction History v2 - Transaction Details Sheet
 * ==================================================
 * Bottom sheet with full transaction details.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getTransactionAmountPrefix,
  getTransactionDisplayAmount,
} from '../../lib/transactionModel';
import { formatDate } from '../../i18n/format';
import type { EventParty, HumanReadableFamilyEvent } from '../../lib/humanReadableFamilyEvent';
import { Badge } from '../ui/Badge';
import { HistoryActionControl } from '../reversals/HistoryActionControl';
import { TransactionIcon } from './TransactionIcon';
import type { HistoryActionSource } from './historySourceResolver';
import { MoneyValue } from '../privacy/MoneyValue';
import { WalletMoneyText } from '../privacy/WalletMoneyText';

interface TransactionDetailsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Structured event data used by the history presentation. */
  event: HumanReadableFamilyEvent | null;
  actionSource?: HistoryActionSource | null;
  currency: string;
}

function partyName(party: EventParty | undefined): string | undefined {
  return party?.name;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="text-gray-500 text-sm">{label}</span>
      <div className="font-medium text-gray-900 text-sm break-words">{children}</div>
    </div>
  );
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
  event,
  actionSource,
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

  if (!isOpen || !event) return null;

  const selectedTransaction = event.transaction;

  const {
    direction,
    reversalReason,
  } = selectedTransaction;

  const isCredit = direction === 'in';
  const amountPrefix = getTransactionAmountPrefix(selectedTransaction);
  const displayAmount = getTransactionDisplayAmount(
    selectedTransaction,
    points => t('wallet:ledger.points', { count: points }),
  );
  const date = typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)
    ? formatDate(new Date(event.timestamp), undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : undefined;
  const reversalDate = typeof event.reversalOccurredAt === 'number' && Number.isFinite(event.reversalOccurredAt)
    ? formatDate(new Date(event.reversalOccurredAt), undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : undefined;
  const childName = partyName(event.subject);
  const actorName = partyName(event.actor);
  const approverName = partyName(event.approver);
  const reverserName = partyName(event.reverser);
  const fromName = partyName(event.from);
  const toName = partyName(event.to);
  const eventStatus = t(`wallet:ledger.activity.status.${event.status}`, {
    defaultValue: event.status.replaceAll('_', ' '),
  });
  const amount = `${amountPrefix}${displayAmount}`;

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
              <TransactionIcon iconName={selectedTransaction.icon} size={32} />
            </div>
            <h2
              className={`text-4xl font-extrabold tabular-nums ${
                isCredit ? 'text-success-600' : 'text-danger-600'
              }`}
            >
              {event.unit === 'money' ? <MoneyValue>{amount}</MoneyValue> : amount}
            </h2>
            <p className="text-gray-500 font-medium mt-1 uppercase tracking-wider text-xs">
              <WalletMoneyText>{event.headline}</WalletMoneyText>
            </p>
          </div>

          {/* Detail rows */}
          <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
            <DetailRow label={t('wallet:ledger.details.event')}>
              <WalletMoneyText>{event.headline}</WalletMoneyText>
            </DetailRow>
            <DetailRow label={t('wallet:ledger.details.amount')}>
              {event.unit === 'money' ? <MoneyValue>{amount}</MoneyValue> : amount}
            </DetailRow>
            {childName && <DetailRow label={t('wallet:ledger.details.child')}>{childName}</DetailRow>}
            {fromName && <DetailRow label={t('wallet:ledger.details.from')}>{fromName}</DetailRow>}
            {toName && <DetailRow label={t('wallet:ledger.details.to')}>{toName}</DetailRow>}
            {actorName && <DetailRow label={t('wallet:ledger.details.performedBy')}>{actorName}</DetailRow>}
            {approverName && <DetailRow label={t('wallet:ledger.details.approvedBy')}>{approverName}</DetailRow>}
            {reverserName && <DetailRow label={t('wallet:ledger.details.reversedBy')}>{reverserName}</DetailRow>}
            {date && <DetailRow label={t('wallet:ledger.details.dateTime')}>{date}</DetailRow>}
            {reversalDate && <DetailRow label={t('wallet:ledger.details.reversedAt')}>{reversalDate}</DetailRow>}
            {event.note && (
              <DetailRow label={t('wallet:ledger.details.note')}>
                <WalletMoneyText>{event.note}</WalletMoneyText>
              </DetailRow>
            )}
            {reversalReason && (
              <DetailRow label={t('reversals:modal.reason')}>
                <WalletMoneyText>{reversalReason}</WalletMoneyText>
              </DetailRow>
            )}
            <DetailRow label={t('wallet:ledger.details.status')}>
              <Badge variant={event.status === 'reversed' ? 'danger' : selectedTransaction.isPending ? 'warning' : 'default'}>
                {eventStatus}
              </Badge>
            </DetailRow>
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
