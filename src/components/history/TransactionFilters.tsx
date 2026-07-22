/**
 * Transaction History v2 - Transaction Filters
 * ==============================================
 * Composable filter buttons for transactions.
 */

import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { TransactionFilter } from '../../lib/transactionAdapter';

const FILTER_LABELS: Record<TransactionFilter, { label: string; icon?: string }> = {
  all: { label: 'All' },
  income: { label: 'Income' },
  expense: { label: 'Expense' },
  reward: { label: 'Rewards' },
  allowance: { label: 'Allowances' },
  goal: { label: 'Goals' },
  adjustment: { label: 'Adjustments' },
  pending: { label: 'Pending' },
  completed: { label: 'Completed' },
  reversed: { label: 'Reversed' },
};

interface TransactionFiltersProps {
  activeFilters: TransactionFilter[];
  onFilterToggle: (filter: TransactionFilter) => void;
  hasActiveFilters: boolean;
  onClearAll: () => void;
}

export function TransactionFilters({
  activeFilters,
  onFilterToggle,
  hasActiveFilters,
  onClearAll,
}: TransactionFiltersProps) {
  const { t } = useTranslation('wallet');

  // Category filters
  const categoryFilters: TransactionFilter[] = ['income', 'expense', 'reward', 'allowance', 'goal', 'adjustment'];

  // Status filters
  const statusFilters: TransactionFilter[] = ['pending', 'completed', 'reversed'];

  return (
    <div className="space-y-3">
      {/* Category Filters */}
      <div className="flex flex-wrap gap-2">
        {categoryFilters.map(filter => (
          <button
            key={filter}
            type="button"
            onClick={() => onFilterToggle(filter)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeFilters.includes(filter)
                ? 'bg-primary-100 text-primary-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            aria-pressed={activeFilters.includes(filter)}
          >
            {t(`ledger.filters.${filter}` as const, { defaultValue: FILTER_LABELS[filter].label })}
          </button>
        ))}
      </div>

      {/* Status Filters */}
      <div className="flex flex-wrap gap-2">
        {statusFilters.map(filter => (
          <button
            key={filter}
            type="button"
            onClick={() => onFilterToggle(filter)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeFilters.includes(filter)
                ? 'bg-primary-100 text-primary-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            aria-pressed={activeFilters.includes(filter)}
          >
            {t(`ledger.filters.${filter}` as const, { defaultValue: FILTER_LABELS[filter].label })}
          </button>
        ))}
      </div>

      {/* Clear All Button */}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClearAll}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
          aria-label={t('ledger.clearFilters')}
        >
          <X size={16} aria-hidden="true" />
          {t('ledger.clearFilters')}
        </button>
      )}
    </div>
  );
}
