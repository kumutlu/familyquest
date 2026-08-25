/**
 * Transaction History v2 - Transaction Card
 * ==========================================
 * Individual transaction display with icon, title, subtitle, time, amount, and badges.
 */

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getTransactionAmountPrefix,
  getTransactionDisplayAmount,
  type NormalizedTransaction,
} from '../../lib/transactionModel';
import { currencyCodeFromSymbol, formatDate, formatPence } from '../../i18n/format';
import { Badge } from '../ui/Badge';
import { TransactionIcon } from './TransactionIcon';
import { MoneyValue } from '../privacy/MoneyValue';
import { useMoneyPrivacy } from '../privacy/MoneyPrivacyContext';
import { WalletMoneyText } from '../privacy/WalletMoneyText';
import { maskWalletMoneyText } from '../privacy/walletMoneyMask';

interface TransactionCardProps {
  transaction: NormalizedTransaction;
  currency: string;
  onClick: () => void;
}

export const TransactionCard = memo(function TransactionCard({
  transaction,
  currency,
  onClick,
}: TransactionCardProps) {
  const { t } = useTranslation(['wallet', 'reversals']);
  const { isMoneyHidden, maskFormattedMoney } = useMoneyPrivacy();

  const {
    timestamp,
    direction,
    title,
    subtitle,
    icon,
    iconBg,
    iconColor,
    balanceAfter,
    isPending,
    isReversed,
    unit,
  } = transaction;

  const amountPrefix = getTransactionAmountPrefix(transaction);
  const displayAmount = getTransactionDisplayAmount(
    transaction,
    points => t('wallet:ledger.points', { count: points }),
  );
  const amountColor = direction === 'in' ? 'text-success-600' : direction === 'out' ? 'text-gray-900' : 'text-gray-500';

  const date = new Date(timestamp);
  const timeStr = formatDate(date, undefined, { hour: '2-digit', minute: '2-digit' });

  const isPrivateMoney = unit === 'money' && isMoneyHidden;
  const accessibleTitle = isPrivateMoney
    ? maskWalletMoneyText(title, maskFormattedMoney(title))
    : title;
  const accessibleSubtitle = isPrivateMoney
    ? maskWalletMoneyText(subtitle, maskFormattedMoney(subtitle))
    : subtitle;
  const accessibleAmount = isPrivateMoney ? maskFormattedMoney(displayAmount) : displayAmount;
  const ariaLabel = `${accessibleTitle}. ${accessibleSubtitle ? `${accessibleSubtitle}. ` : ''}${amountPrefix}${accessibleAmount}.`;

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="transaction-card"
      aria-label={ariaLabel}
      className="w-full p-3 flex items-center justify-between text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:bg-gray-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${iconBg} ${iconColor}`}>
          <TransactionIcon iconName={icon} size={20} />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 text-sm break-words">
            {unit === 'money' ? <WalletMoneyText>{title}</WalletMoneyText> : title}
          </p>
          <p className="text-xs text-gray-400 mt-0.5 break-words">
            {unit === 'money' ? <WalletMoneyText>{subtitle}</WalletMoneyText> : subtitle}
            {subtitle && timeStr ? ' · ' : ''}
            {timeStr}
          </p>
        </div>
      </div>
      <div className="flex flex-col items-end shrink-0 text-right">
        <div className="flex items-center gap-2">
          <span className={`font-bold tabular-nums ${amountColor}`}>
            {amountPrefix}
            {unit === 'money' ? <MoneyValue>{displayAmount}</MoneyValue> : displayAmount}
          </span>
          {isPending && (
            <Badge variant="warning" className="bg-warning-100 text-warning-700 text-xs">
              {t('wallet:ledger.details.pending')}
            </Badge>
          )}
          {isReversed && (
            <Badge variant="danger" className="bg-danger-100 text-danger-700 text-xs">
              {t('reversals:reversed')}
            </Badge>
          )}
        </div>
        {balanceAfter !== undefined && (
          <span className="text-xs text-gray-400 mt-0.5">
            {t('wallet:balance')}: <MoneyValue>{formatPence(balanceAfter, currencyCodeFromSymbol(currency))}</MoneyValue>
          </span>
        )}
      </div>
    </button>
  );
});
