import { Clock, Inbox, RefreshCw } from 'lucide-react';
import { formatMoney, requestTime } from '../../lib/walletPresentation';
import { EmptyState, ErrorState, TransactionSkeletonRows } from './WalletStates';

interface PendingTransfersProps {
  requests: any[];
  currency?: string;
  loading?: boolean;
  error?: string | null;
  // True when the pending source failed to load. We then show an unavailable
  // placeholder rather than a misleading £0.00, and keep the rest of the page
  // (balance + transactions) fully usable.
  unavailable?: boolean;
  onRetry?: () => void;
}

function requestDateLabel(value: any): string {
  const ms = requestTime(value);
  if (!ms) return '';
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// Pending transfer requests are kept SEPARATE from settled transactions.
// They never reduce balance and never appear in Money Out or wallet_transactions.
export function PendingTransfers({
  requests,
  currency = '£',
  loading,
  error,
  unavailable = false,
  onRetry,
}: PendingTransfersProps) {
  return (
    <section aria-labelledby="pending-transfers-heading" data-testid="transfer-requests-section">
      <h2 id="pending-transfers-heading" className="text-lg font-bold text-gray-900 mb-3">
        Pending transfers
      </h2>

      {loading ? (
        <div className="rounded-2xl bg-white border border-gray-100 overflow-hidden">
          <TransactionSkeletonRows count={2} />
        </div>
      ) : error ? (
        <ErrorState message="We couldn’t load your pending transfers." onRetry={onRetry} />
      ) : unavailable ? (
        // Partial failure: the pending source failed but the rest of the wallet
        // is fine. Show a non-blocking notice with a retry; do NOT blank the page.
        <div
          role="alert"
          className="rounded-2xl bg-white border border-gray-100 p-4 flex items-center justify-between gap-3"
        >
          <p className="text-sm text-gray-500">
            We couldn’t load your pending transfers right now.
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700 transition-colors hover:border-primary-300 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >
              <RefreshCw size={15} aria-hidden="true" />
              Try again
            </button>
          )}
        </div>
      ) : requests.length === 0 ? (
        <EmptyState
          title="No pending transfers"
          description="Everything is up to date."
          icon={<Inbox size={22} aria-hidden="true" />}
        />
      ) : (
        <div className="space-y-2">
          {requests.map(r => {
            const amount = Number.isInteger(r.amountPence) ? r.amountPence : 0;
            return (
              <div
                key={r.id}
                data-testid="transfer-request-item"
                className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-warning-50 text-warning-600">
                    <Clock size={18} aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">
                      {formatMoney(amount, currency)} to {r.toChildName || 'another child'}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      {requestDateLabel(r.createdAt)}
                      {r.message ? ` · ${r.message}` : ''}
                    </p>
                  </div>
                </div>
                <span
                  className="shrink-0 inline-flex items-center rounded-full bg-warning-50 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-warning-600"
                  aria-label="Waiting for parent approval"
                >
                  Waiting for parent approval
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
