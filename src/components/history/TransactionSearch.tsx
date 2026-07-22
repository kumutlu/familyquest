/**
 * Transaction History v2 - Transaction Search
 * ==============================================
 * Realtime search input for transactions.
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

interface TransactionSearchProps {
  query: string;
  onQueryChange: (query: string) => void;
  placeholder?: string;
}

export function TransactionSearch({ query, onQueryChange, placeholder }: TransactionSearchProps) {
  const { t } = useTranslation('wallet');
  const [localQuery, setLocalQuery] = useState(query);

  useEffect(() => {
    setLocalQuery(query);
  }, [query]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      onQueryChange(localQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [localQuery, onQueryChange]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalQuery(e.target.value);
  }, []);

  const handleClear = useCallback(() => {
    setLocalQuery('');
    onQueryChange('');
  }, [onQueryChange]);

  return (
    <div className="relative">
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
        <Search size={20} aria-hidden="true" />
      </div>
      <input
        type="search"
        value={localQuery}
        onChange={handleChange}
        placeholder={placeholder || t('ledger.searchPlaceholder')}
        className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-gray-200 focus:border-primary-500 focus:outline-none font-medium"
        aria-label={t('ledger.searchPlaceholder')}
      />
      {localQuery && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none"
          aria-label={t('ledger.clearSearch')}
        >
          ✕
        </button>
      )}
    </div>
  );
}
