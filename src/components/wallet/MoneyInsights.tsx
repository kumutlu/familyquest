import { ArrowDownRight, ArrowUpRight, Clock } from 'lucide-react';
import { formatMoney } from '../../lib/walletPresentation';

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
            aria-label={`${label} amount unavailable`}
          >
            —
          </p>
        ) : (
          <p className={`text-base font-bold tabular-nums ${valueClass} break-words`}>
            {formatMoney(amount as number, currency)}
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
  return (
    <section aria-label="Money insights" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <InsightCard
        label="Money In"
        amount={moneyIn}
        currency={currency}
        icon={<ArrowDownRight size={18} aria-hidden="true" />}
        iconBg="bg-success-50 text-success-600"
        valueClass="text-success-600"
      />
      <InsightCard
        label="Money Out"
        amount={moneyOut}
        currency={currency}
        icon={<ArrowUpRight size={18} aria-hidden="true" />}
        iconBg="bg-gray-100 text-gray-600"
        valueClass="text-gray-900"
      />
      <InsightCard
        label="Pending"
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
