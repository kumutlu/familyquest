import { ArrowDownRight, ArrowUpRight, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatPence, currencyCodeFromSymbol } from '../../i18n/format';
import { MoneyValue } from '../privacy/MoneyValue';

interface MoneyInsightsProps {
  moneyIn: number;
  moneyOut: number;
  pending: number;
  currency?: string;
  // When the pending source failed to load we show an unavailable placeholder
  // instead of a misleading £0.00.
  pendingUnavailable?: boolean;
}

interface InsightCardProps {
  label: string;
  amount: number | null;
  currency: string;
  icon: React.ReactNode;
  iconBg: string;
  valueClass: string;
  spanTwo?: boolean;
}

function InsightCard({ label, amount, currency, icon, iconBg, valueClass, spanTwo }: InsightCardProps) {
  const { t } = useTranslation('wallet');
  const isUnavailable = amount === null;
  return (
    <div
      className={`rounded-2xl bg-white p-3 shadow-sm border border-gray-100 flex items-center gap-3 min-w-0 ${
        spanTwo ? 'col-span-2 sm:col-span-1' : ''
      }`}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
        {icon}
      </div>
      {/* min-w-0 lets the text column shrink and wrap instead of overflowing. */}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-gray-500 truncate">{label}</p>
        {isUnavailable ? (
          <p
            className="text-base font-bold tabular-nums text-gray-400"
            aria-label={t('insights.amountUnavailable', { label })}
          >
            —
          </p>
        ) : (
          <p className={`text-base font-bold tabular-nums ${valueClass} break-words`}>
            <MoneyValue>{formatPence(amount as number, currencyCodeFromSymbol(currency))}</MoneyValue>
          </p>
        )}
      </div>
    </div>
  );
}

// Compact banking-style insight cards derived from real ledger data.
// Money In / Money Out come from wallet_transactions for the current month.
// Pending is outgoing transfer requests awaiting parent approval (not ledger).
//
// Responsive layout:
//   - Mobile (default): 2-column grid. Money In + Money Out share the top row,
//     and the Pending card spans both columns underneath so its full label and
//     amount stay readable on narrow screens.
//   - >= sm (640px): three equal columns.
export function MoneyInsights({
  moneyIn,
  moneyOut,
  pending,
  currency = '£',
  pendingUnavailable = false,
}: MoneyInsightsProps) {
  const { t } = useTranslation('wallet');
  return (
    <section aria-label={t('insights.title')} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <InsightCard
        label={t('insights.moneyIn')}
        amount={moneyIn}
        currency={currency}
        icon={<ArrowDownRight size={18} aria-hidden="true" />}
        iconBg="bg-success-50 text-success-600"
        valueClass="text-success-600"
      />
      <InsightCard
        label={t('insights.moneyOut')}
        amount={moneyOut}
        currency={currency}
        icon={<ArrowUpRight size={18} aria-hidden="true" />}
        iconBg="bg-gray-100 text-gray-600"
        valueClass="text-gray-900"
      />
      <InsightCard
        label={t('insights.pending')}
        amount={pendingUnavailable ? null : pending}
        currency={currency}
        icon={<Clock size={18} aria-hidden="true" />}
        iconBg="bg-warning-50 text-warning-600"
        valueClass="text-warning-600"
        spanTwo
      />
    </section>
  );
}
