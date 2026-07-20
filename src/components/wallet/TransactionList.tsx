import { Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { groupTransactionsByDate } from '../../lib/walletPresentation';
import { TransactionRow } from './TransactionRow';
import { EmptyState, ErrorState, TransactionSkeletonRows } from './WalletStates';

interface TransactionListProps {
  transactions: any[];
  hasMore: boolean;
  onLoadMore: () => void;
  onSelect: (tx: any) => void;
  nameResolver?: (id: string) => string | undefined;
  currency?: string;
  currentUserId?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

// Banking-statement transaction list. Grouped by date (newest first),
// bounded to the entries passed in (the page caps initial load to 20).
export function TransactionList({
  transactions,
  hasMore,
  onLoadMore,
  onSelect,
  nameResolver,
  currency = '£',
  currentUserId,
  loading,
  error,
  onRetry,
}: TransactionListProps) {
  const { t } = useTranslation('wallet');
  const groups = groupTransactionsByDate(transactions, new Date(), t);

  return (
    <section aria-labelledby="recent-transactions-heading">
      <h2 id="recent-transactions-heading" className="text-lg font-bold text-gray-900 mb-3">
        {t('ledger.recent')}
      </h2>

      {loading ? (
        <div className="rounded-2xl bg-white border border-gray-100 overflow-hidden">
          <TransactionSkeletonRows />
        </div>
      ) : error ? (
        <ErrorState message={t('ledger.error')} onRetry={onRetry} />
      ) : transactions.length === 0 ? (
        <EmptyState
          title={t('ledger.emptyTitle')}
          description={t('ledger.emptyDescription')}
          icon={<Inbox size={22} aria-hidden="true" />}
        />
      ) : (
        <div className="rounded-2xl bg-white border border-gray-100 overflow-hidden">
          {groups.map(group => (
            <div key={group.label}>
              <h3 className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
                {group.label}
              </h3>
              <div className="divide-y divide-gray-50">
                {group.items.map(tx => (
                  <TransactionRow
                    key={tx.id}
                    tx={tx}
                    currency={currency}
                    nameResolver={nameResolver}
                    currentUserId={currentUserId}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </div>
          ))}
          {hasMore && (
            <div className="p-3 border-t border-gray-50">
              <button
                type="button"
                onClick={onLoadMore}
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:border-primary-300 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              >
                {t('ledger.loadMore')}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
