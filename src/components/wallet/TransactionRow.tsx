import { useTranslation } from 'react-i18next';
import {
  signedTransactionAmount,
  transactionPresentation,
  transactionRowDate,
} from '../../lib/walletPresentation';
import { formatPence, currencyCodeFromSymbol } from '../../i18n/format';
import { MoneyValue } from '../privacy/MoneyValue';
import { useMoneyPrivacy } from '../privacy/MoneyPrivacyContext';
import { WalletMoneyText } from '../privacy/WalletMoneyText';
import { maskWalletMoneyText } from '../privacy/walletMoneyMask';

interface TransactionRowProps {
  tx: any;
  currency: string;
  nameResolver?: (id: string) => string | undefined;
  currentUserId?: string;
  onSelect: (tx: any) => void;
}

// A single banking-statement row. Rendered as a real <button> so it is
// keyboard-actionable and focusable for free. Direction is conveyed by the
// +/- prefix AND colour AND an aria-label (never colour alone).
export function TransactionRow({ tx, currency, nameResolver, currentUserId, onSelect }: TransactionRowProps) {
  const { t } = useTranslation('wallet');
  const { isMoneyHidden, maskFormattedMoney } = useMoneyPrivacy();
  const p = transactionPresentation(tx, { nameResolver, currentUserId, t });
  const Icon = p.icon;
  const abs = Math.abs(signedTransactionAmount(tx));
  const prefix = p.direction === 'in' ? '+' : p.direction === 'out' ? '-' : '';
  const amountColor =
    p.direction === 'in' ? 'text-success-600' : p.direction === 'out' ? 'text-gray-900' : 'text-gray-500';
  const date = transactionRowDate(tx, new Date(), t);
  const formattedAmount = formatPence(abs, currencyCodeFromSymbol(currency));
  const accessibleTitle = isMoneyHidden
    ? maskWalletMoneyText(p.title, maskFormattedMoney(p.title))
    : p.title;
  const accessibleSubtitle = isMoneyHidden
    ? maskWalletMoneyText(p.subtitle, maskFormattedMoney(p.subtitle))
    : p.subtitle;
  const accessibleAmount = isMoneyHidden ? maskFormattedMoney(formattedAmount) : formattedAmount;
  const ariaLabel = `${accessibleTitle}. ${accessibleSubtitle ? `${accessibleSubtitle}. ` : ''}${prefix}${accessibleAmount}.`;

  return (
    <button
      type="button"
      onClick={() => onSelect(tx)}
      data-testid="transaction-row"
      aria-label={ariaLabel}
      className="w-full p-3 flex items-center justify-between text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:bg-gray-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${p.iconBg}`}>
          <Icon size={20} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-gray-900 text-sm break-words">
            <WalletMoneyText>{p.title}</WalletMoneyText>
          </p>
          <p className="text-xs text-gray-400 mt-0.5 break-words">
            <WalletMoneyText>{p.subtitle}</WalletMoneyText>
            {p.subtitle && date ? ' · ' : ''}
            {date}
          </p>
        </div>
      </div>
      <div className="flex flex-col items-end shrink-0 text-right">
        <span className={`font-bold tabular-nums ${amountColor}`}>
          {prefix}
          <MoneyValue>{formattedAmount}</MoneyValue>
        </span>
        {p.statusLabel && <span className="text-xs text-gray-400 mt-0.5">{p.statusLabel}</span>}
      </div>
    </button>
  );
}
