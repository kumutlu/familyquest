import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { currencyCodeFromSymbol, formatDate, formatPence } from '../../i18n/format';
import type { EventParty, HumanReadableFamilyEvent } from '../../lib/humanReadableFamilyEvent';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { MoneyValue } from '../privacy/MoneyValue';
import { useMoneyPrivacy } from '../privacy/MoneyPrivacyContext';
import { WalletMoneyText } from '../privacy/WalletMoneyText';
import { maskWalletMoneyText } from '../privacy/walletMoneyMask';
import { TransactionIcon } from './TransactionIcon';

interface HumanReadableEventCardProps {
  event: HumanReadableFamilyEvent;
  onClick: () => void;
}

function partyName(party: EventParty | undefined): string | undefined {
  return party?.name;
}

function signedAmount(event: Pick<HumanReadableFamilyEvent, 'amountPence' | 'unit' | 'currency'>, points: string): string {
  const prefix = event.amountPence > 0 ? '+' : event.amountPence < 0 ? '-' : '';
  const amount = event.unit === 'points'
    ? points
    : formatPence(Math.abs(event.amountPence), currencyCodeFromSymbol(event.currency));
  return `${prefix}${amount}`;
}

function statusVariant(status: HumanReadableFamilyEvent['status']) {
  if (status === 'reversed' || status === 'rejected' || status === 'cancelled') return 'danger' as const;
  if (status === 'pending' || status === 'pending_approval' || status === 'pending_acceptance') return 'warning' as const;
  return 'success' as const;
}

/** A factual, compact history row backed by the shared structured event model. */
export const HumanReadableEventCard = memo(function HumanReadableEventCard({
  event,
  onClick,
}: HumanReadableEventCardProps) {
  const { t } = useTranslation('wallet');
  const { isMoneyHidden, maskFormattedMoney } = useMoneyPrivacy();
  const subjectName = partyName(event.subject);
  const actorName = partyName(event.actor);
  const approverName = partyName(event.approver);
  const reverserName = partyName(event.reverser);
  const fromName = partyName(event.from);
  const toName = partyName(event.to);
  const unsignedAmount = event.unit === 'points'
    ? t('ledger.points', { count: Math.abs(event.amountPence) })
    : formatPence(Math.abs(event.amountPence), currencyCodeFromSymbol(event.currency));
  const displayHeadline = event.eventKind === 'deposit' && subjectName
    ? t('ledger.activity.depositHeadline', {
      amount: unsignedAmount,
      child: subjectName,
      defaultValue: event.headline,
    })
    : event.eventKind === 'withdrawal' && subjectName
      ? t('ledger.activity.withdrawalHeadline', {
        amount: unsignedAmount,
        child: subjectName,
        defaultValue: event.headline,
      })
      : (event.eventKind === 'transfer' || event.eventKind === 'transfer_in' || event.eventKind === 'transfer_out' || event.eventKind === 'transfer_request') && fromName && toName
        ? t('ledger.activity.transferHeadline', {
          amount: unsignedAmount,
          from: fromName,
          to: toName,
          defaultValue: event.headline,
        })
        : event.eventKind === 'reward_redemption' && subjectName
          ? t('ledger.activity.rewardRedemptionHeadline', {
            amount: unsignedAmount,
            child: subjectName,
            defaultValue: event.headline,
          })
          : event.headline;
  const attribution = [
    actorName && t('ledger.activity.performedBy', { name: actorName }),
    approverName && t('ledger.activity.approvedBy', { name: approverName }),
    reverserName && t('ledger.activity.reversedBy', { name: reverserName }),
  ].filter((line): line is string => Boolean(line));
  const amount = signedAmount(event, t('ledger.points', { count: Math.abs(event.amountPence) }));
  const status = t(`ledger.activity.status.${event.status}`, {
    defaultValue: event.status.replaceAll('_', ' '),
  });
  const time = typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)
    ? formatDate(new Date(event.timestamp), undefined, {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
    : undefined;
  const reversalTime = typeof event.reversalOccurredAt === 'number' && Number.isFinite(event.reversalOccurredAt)
    ? formatDate(new Date(event.reversalOccurredAt), undefined, {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
    : undefined;
  const accessibleHeadline = isMoneyHidden
    ? maskWalletMoneyText(displayHeadline, maskFormattedMoney(displayHeadline))
    : displayHeadline;
  const accessibleAmount = event.unit === 'money' && isMoneyHidden ? maskFormattedMoney(amount) : amount;
  const accessibleNote = event.note && (isMoneyHidden
    ? maskWalletMoneyText(event.note, maskFormattedMoney(event.note))
    : event.note);
  const supportingText = event.note || event.transaction.subtitle === event.rewardTitle || event.transaction.subtitle === event.goalTitle || event.transaction.subtitle === event.fundName
    ? undefined
    : event.transaction.subtitle || undefined;
  const accessibleSupportingText = supportingText && (isMoneyHidden
    ? maskWalletMoneyText(supportingText, maskFormattedMoney(supportingText))
    : supportingText);
  const accessibleTitles = [
    event.rewardTitle && (isMoneyHidden ? maskWalletMoneyText(event.rewardTitle, maskFormattedMoney(event.rewardTitle)) : event.rewardTitle),
    event.goalTitle,
    event.fundName && (isMoneyHidden ? maskWalletMoneyText(event.fundName, maskFormattedMoney(event.fundName)) : event.fundName),
  ].filter((title): title is string => Boolean(title));
  const balance = event.transaction.balanceAfter === undefined
    ? undefined
    : formatPence(event.transaction.balanceAfter, currencyCodeFromSymbol(event.currency));
  const accessibleBalance = balance && (isMoneyHidden ? maskFormattedMoney(balance) : balance);
  const ariaLabel = [
    accessibleHeadline,
    accessibleAmount,
    ...attribution,
    accessibleNote && `${t('ledger.activity.note')}: ${accessibleNote}`,
    accessibleSupportingText,
    ...accessibleTitles,
    time,
    reversalTime && t('ledger.activity.reversedAt', { date: reversalTime }),
    `${t('ledger.activity.statusLabel')}: ${status}`,
    accessibleBalance && `${t('balance')}: ${accessibleBalance}`,
  ].filter(Boolean).join('. ');

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="human-readable-event-card"
      aria-label={ariaLabel}
      className="w-full p-3 flex items-start justify-between gap-3 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:bg-gray-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {subjectName ? (
          <Avatar
            fallback={subjectName.slice(0, 1)}
            size="sm"
            aria-hidden="true"
            data-testid="history-subject-marker"
            className="shrink-0"
          />
        ) : (
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${event.transaction.iconBg} ${event.transaction.iconColor}`} aria-hidden="true">
            <TransactionIcon iconName={event.transaction.icon} size={16} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 text-sm break-words">
            <WalletMoneyText>{displayHeadline}</WalletMoneyText>
          </p>
          {event.rewardTitle && <p className="mt-0.5 text-xs text-gray-500 break-words"><WalletMoneyText>{event.rewardTitle}</WalletMoneyText></p>}
          {event.goalTitle && <p className="mt-0.5 text-xs text-gray-500 break-words">{event.goalTitle}</p>}
          {event.fundName && <p className="mt-0.5 text-xs text-gray-500 break-words"><WalletMoneyText>{event.fundName}</WalletMoneyText></p>}
          {attribution.map(line => (
            <p key={line} className="mt-0.5 text-xs text-gray-500 break-words">{line}</p>
          ))}
          {event.note && (
            <p className="mt-1 text-xs text-gray-500 break-words">
              <span>{t('ledger.activity.note')}: </span>
              <WalletMoneyText>{event.note}</WalletMoneyText>
            </p>
          )}
          {supportingText && (
            <p className="mt-1 text-xs text-gray-500 break-words">
              <WalletMoneyText>{supportingText}</WalletMoneyText>
            </p>
          )}
          {time && <p className="mt-1 text-xs text-gray-400 break-words">{time}</p>}
          {reversalTime && <p className="mt-1 text-xs text-gray-400 break-words">{t('ledger.activity.reversedAt', { date: reversalTime })}</p>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        <span className={`font-bold tabular-nums ${event.amountPence > 0 ? 'text-success-600' : event.amountPence < 0 ? 'text-gray-900' : 'text-gray-500'}`}>
          {event.unit === 'money' ? <MoneyValue>{amount}</MoneyValue> : amount}
        </span>
        <Badge variant={statusVariant(event.status)} className="text-xs normal-case tracking-normal">
          {status}
        </Badge>
        {balance && (
          <span className="text-xs text-gray-400 break-words">
            {t('balance')}: <MoneyValue>{balance}</MoneyValue>
          </span>
        )}
      </div>
    </button>
  );
});
