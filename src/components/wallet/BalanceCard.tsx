import { Wallet as WalletIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatPence, currencyCodeFromSymbol } from '../../i18n/format';

interface BalanceCardProps {
  balance?: number;
  currency?: string;
  loading?: boolean;
  unavailable?: boolean;
}

// Prominent "Available balance" card. Canonical source is
// families/{familyId}/wallets/{childId}.balance (passed in as `balance`).
export function BalanceCard({ balance, currency = '£', loading, unavailable }: BalanceCardProps) {
  const { t } = useTranslation('wallet');
  if (loading) {
    return (
      <section
        aria-label={t('balanceCard.label')}
        className="rounded-3xl bg-gray-900 p-6 text-white shadow-lg relative overflow-hidden"
      >
        <div className="absolute -top-10 -right-10 opacity-10">
          <WalletIcon size={140} strokeWidth={1} aria-hidden="true" />
        </div>
        <div className="relative z-10">
          <div className="h-4 w-28 rounded bg-white/20 animate-pulse" />
          <div className="mt-3 h-10 w-44 rounded bg-white/20 animate-pulse" />
          <div className="mt-3 h-3 w-32 rounded bg-white/10 animate-pulse" />
        </div>
        <span className="sr-only" role="status">{t('balanceCard.loading')}</span>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="balance-label"
      className="rounded-3xl bg-gradient-to-br from-gray-900 to-gray-800 p-6 text-white shadow-lg relative overflow-hidden"
    >
      <div className="absolute -top-10 -right-10 opacity-10" aria-hidden="true">
        <WalletIcon size={140} strokeWidth={1} />
      </div>
      <div className="relative z-10">
        <p id="balance-label" className="text-gray-300 font-medium text-sm uppercase tracking-wider">
          {t('balanceCard.label')}
        </p>
        <p
          className="mt-1 text-4xl font-extrabold tracking-tight tabular-nums"
          aria-live="polite"
        >
          {unavailable ? t('balanceCard.unavailable') : formatPence(balance ?? 0, currencyCodeFromSymbol(currency))}
        </p>
        <p className="mt-2 text-xs text-gray-400">{t('balanceCard.walletName')}</p>
      </div>
    </section>
  );
}
