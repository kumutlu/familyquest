/**
 * Transaction History v2 - History Screen
 * ========================================
 * Main screen with date grouping, search, and filters.
 */

import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import {
  filterTransactions,
  searchTransactions,
  groupTransactionsByDate,
  type NormalizedTransaction,
  type TransactionFilter,
} from '../../lib/transactionAdapter';
import { adaptHumanReadableFamilyEvents, type HumanReadableFamilyEvent } from '../../lib/humanReadableFamilyEvent';
import { HumanReadableEventCard } from './HumanReadableEventCard';
import { TransactionDetailsSheet } from './TransactionDetailsSheet';
import { TransactionFilters } from './TransactionFilters';
import { TransactionSearch } from './TransactionSearch';
import { EmptyState, ErrorState } from '../wallet/WalletStates';
import { Inbox } from 'lucide-react';
import { currencySymbolFromCode, resolveFamilyCurrencyCode } from '../../i18n/format';
import type { BootstrapResource } from '../../lib/bootstrapQueries';
import { buildHistoryActionSourceResolver } from './historySourceResolver';

const HISTORY_BOOTSTRAP_RESOURCES = [
  'members',
  'walletTransactions',
  'savingsGoals',
  'goalLedger',
  'rewards',
  'redemptions',
  'behaviourEvents',
  'funds',
  'petboxRequests',
  'transferRequests',
  'moneyRequests',
  'reversals',
] as const satisfies readonly BootstrapResource[];

function hasResourceError(
  resource: BootstrapResource,
  errors: Readonly<Record<string, string | null>>,
): boolean {
  return Object.entries(errors).some(([key, value]) => (
    Boolean(value) && (key === resource || key.startsWith(`${resource}:`))
  ));
}

interface HistoryMember {
  id: string;
  displayName: string;
}

interface HistoryGoal {
  id: string;
  title: string;
  targetAmountPence?: number;
  currentAmountPence?: number;
}

interface HistoryReward {
  id: string;
  title: string;
}

interface HistoryFund {
  id: string;
  name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, field: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const candidate = value[field];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

function numberField(value: unknown, ...fields: string[]): number | undefined {
  if (!isRecord(value)) return undefined;
  for (const field of fields) {
    const candidate = value[field];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  return undefined;
}

function memberFrom(value: unknown): HistoryMember | undefined {
  const id = stringField(value, 'id');
  const displayName = stringField(value, 'displayName');
  return id && displayName ? { id, displayName } : undefined;
}

function goalFrom(value: unknown): HistoryGoal | undefined {
  const id = stringField(value, 'id');
  const title = stringField(value, 'title');
  if (!id || !title) return undefined;
  return {
    id,
    title,
    targetAmountPence: numberField(value, 'targetAmountPence', 'targetAmount'),
    currentAmountPence: numberField(value, 'currentAmountPence', 'currentAmount'),
  };
}

function rewardFrom(value: unknown): HistoryReward | undefined {
  const id = stringField(value, 'id');
  const title = stringField(value, 'title');
  return id && title ? { id, title } : undefined;
}

function fundFrom(value: unknown): HistoryFund | undefined {
  const id = stringField(value, 'id');
  const name = stringField(value, 'name');
  return id && name ? { id, name } : undefined;
}

export function TransactionHistoryScreen() {
  const { t } = useTranslation('wallet');
  const { t: transactionT } = useTranslation(['wallet', 'goals', 'rewards', 'reversals']);
  const {
    currentUser,
    walletTransactions,
    transferRequests,
    moneyRequests,
    petboxRequests,
    reversals,
    familyMembers,
    familyData,
    savingsGoals,
    rewards,
    funds,
    goalLedger,
    redemptions,
    behaviourEvents,
    loading,
    bootstrapError,
    bootstrapStatus,
    featureErrors,
    retryBootstrap,
  } = useStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState<TransactionFilter[]>(['all']);
  const [selectedTransaction, setSelectedTransaction] = useState<NormalizedTransaction | null>(null);

  const currency = currencySymbolFromCode(resolveFamilyCurrencyCode(familyData));
  const currentUserId = stringField(currentUser, 'id');
  const familyId = stringField(familyData, 'id');

  // Build name resolver
  const memberMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const value of familyMembers as readonly unknown[]) {
      const member = memberFrom(value);
      if (member) map.set(member.id, member.displayName);
    }
    const activeMember = memberFrom(currentUser);
    if (activeMember) map.set(activeMember.id, activeMember.displayName);
    return map;
  }, [familyMembers, currentUser]);

  const nameResolver = useCallback((id: string) => memberMap.get(id), [memberMap]);

  // Build goal resolver
  const goalMap = useMemo(() => {
    const map = new Map<string, Omit<HistoryGoal, 'id'>>();
    for (const value of savingsGoals as readonly unknown[]) {
      const goal = goalFrom(value);
      if (goal) map.set(goal.id, {
        title: goal.title,
        targetAmountPence: goal.targetAmountPence,
        currentAmountPence: goal.currentAmountPence,
      });
    }
    return map;
  }, [savingsGoals]);

  const goalResolver = useCallback((id: string) => goalMap.get(id), [goalMap]);

  // Build reward resolver
  const rewardMap = useMemo(() => {
    const map = new Map<string, Omit<HistoryReward, 'id'>>();
    for (const value of rewards as readonly unknown[]) {
      const reward = rewardFrom(value);
      if (reward) map.set(reward.id, { title: reward.title });
    }
    return map;
  }, [rewards]);

  const rewardResolver = useCallback((id: string) => rewardMap.get(id), [rewardMap]);

  const fundMap = useMemo(() => {
    const map = new Map<string, Omit<HistoryFund, 'id'>>();
    for (const value of funds as readonly unknown[]) {
      const fund = fundFrom(value);
      if (fund) map.set(fund.id, { name: fund.name });
    }
    return map;
  }, [funds]);

  const fundResolver = useCallback((id: string) => fundMap.get(id), [fundMap]);

  const allEvents = useMemo(() => {
    const events = adaptHumanReadableFamilyEvents({
      walletTransactions,
      reversals,
      goalLedger,
      redemptions,
      behaviourEvents,
      petboxRequests,
      transferRequests,
      moneyRequests,
      opts: {
        currency,
        nameResolver,
        goalResolver,
        rewardResolver,
        fundResolver,
        currentUserId,
        familyId,
        t: transactionT,
      },
    });
    return events.map(event => ({
      ...event,
      transaction: {
        ...event.transaction,
        searchText: [
          event.transaction.searchText,
          event.subject?.name,
          event.actor?.name,
          event.approver?.name,
          event.reverser?.name,
          event.from?.name,
          event.to?.name,
          event.rewardTitle,
          event.goalTitle,
          event.fundName,
          event.note,
        ].filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join(' ').toLocaleLowerCase(),
      },
    }));
  }, [
    walletTransactions,
    reversals,
    goalLedger,
    redemptions,
    behaviourEvents,
    petboxRequests,
    transferRequests,
    moneyRequests,
    currency,
    nameResolver,
    goalResolver,
    rewardResolver,
    fundResolver,
    currentUserId,
    familyId,
    transactionT,
  ]);

  const allTransactions = useMemo(
    () => allEvents.map(event => event.transaction),
    [allEvents],
  );

  const eventByTransactionId = useMemo(
    () => new Map<string, HumanReadableFamilyEvent>(allEvents.map(event => [event.transaction.id, event])),
    [allEvents],
  );

  const resolveActionSource = useMemo(() => buildHistoryActionSourceResolver({
    walletTransactions,
    redemptions,
    behaviourEvents,
    petboxRequests,
    transferRequests,
    moneyRequests,
  }), [
    walletTransactions,
    redemptions,
    behaviourEvents,
    petboxRequests,
    transferRequests,
    moneyRequests,
  ]);

  const selectedActionSource = useMemo(
    () => resolveActionSource(selectedTransaction),
    [resolveActionSource, selectedTransaction],
  );

  const selectedEvent = useMemo(
    () => selectedTransaction ? eventByTransactionId.get(selectedTransaction.id) ?? null : null,
    [eventByTransactionId, selectedTransaction],
  );

  // Apply search
  const searchedTransactions = useMemo(() => {
    return searchTransactions(allTransactions, searchQuery);
  }, [allTransactions, searchQuery]);

  // Apply filters
  const filteredTransactions = useMemo(() => {
    return filterTransactions(searchedTransactions, activeFilters);
  }, [searchedTransactions, activeFilters]);

  // Group by date
  const groupedTransactions = useMemo(() => {
    return groupTransactionsByDate(filteredTransactions, new Date(), t);
  }, [filteredTransactions, t]);

  // Handle filter toggle
  const handleFilterToggle = useCallback((filter: TransactionFilter) => {
    setActiveFilters(prev => {
      if (filter === 'all') {
        return ['all'];
      }
      const newFilters = prev.filter(f => f !== 'all');
      if (newFilters.includes(filter)) {
        return newFilters.filter(f => f !== filter);
      }
      return [...newFilters, filter];
    });
  }, []);

  // Clear all filters
  const clearFilters = useCallback(() => {
    setActiveFilters(['all']);
    setSearchQuery('');
  }, []);

  // Track whether a non-default filter is active.
  const hasActiveFilters = activeFilters.length > 0 && activeFilters[0] !== 'all';
  const hasActiveSearch = searchQuery.trim().length > 0;
  const hasHistoryError = HISTORY_BOOTSTRAP_RESOURCES.some(resource => (
    bootstrapStatus[resource] === 'error' || hasResourceError(resource, featureErrors)
  ));
  const isHistoryLoading = HISTORY_BOOTSTRAP_RESOURCES.some(
    resource => bootstrapStatus[resource] === 'loading',
  );

  if (bootstrapError) {
    return (
      <div className="mx-auto max-w-2xl w-full px-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
        <ErrorState message={t('ledger.error')} onRetry={retryBootstrap} />
      </div>
    );
  }

  if (loading || !currentUser) {
    return (
      <div className="mx-auto max-w-2xl w-full px-4 space-y-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
        <div className="h-12 rounded-xl bg-gray-100 animate-pulse" aria-hidden="true" />
        <div className="h-8 rounded-xl bg-gray-100 animate-pulse w-3/4" aria-hidden="true" />
        <div className="h-4 rounded-xl bg-gray-100 animate-pulse w-1/2" aria-hidden="true" />
        <span className="sr-only" role="status">{t('page.loading')}</span>
      </div>
    );
  }

  if (hasHistoryError) {
    return (
      <div className="mx-auto max-w-2xl w-full px-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
        <ErrorState message={t('ledger.historyError')} onRetry={retryBootstrap} />
      </div>
    );
  }

  if (isHistoryLoading) {
    return (
      <div className="mx-auto max-w-2xl w-full px-4 space-y-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
        <div className="h-12 rounded-xl bg-gray-100 animate-pulse" aria-hidden="true" />
        <div className="h-8 rounded-xl bg-gray-100 animate-pulse w-3/4" aria-hidden="true" />
        <div className="h-4 rounded-xl bg-gray-100 animate-pulse w-1/2" aria-hidden="true" />
        <span className="sr-only" role="status">{t('ledger.historyLoading')}</span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl w-full px-4 space-y-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))] animate-in fade-in duration-300">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
          {t('ledger.recent')}
        </h1>
        <p className="text-gray-500 mt-1">
          {t('ledger.emptyDescription')}
        </p>
      </header>

      {/* Search */}
      <TransactionSearch
        query={searchQuery}
        onQueryChange={setSearchQuery}
        placeholder={t('ledger.searchPlaceholder')}
      />

      {/* Filters */}
      <TransactionFilters
        activeFilters={activeFilters}
        onFilterToggle={handleFilterToggle}
        hasActiveFilters={hasActiveFilters}
        onClearAll={clearFilters}
      />

      <p className="sr-only" role="status" aria-live="polite">
        {t('ledger.resultsAnnouncement', { count: filteredTransactions.length })}
      </p>

      {/* Transaction List */}
      {groupedTransactions.length === 0 ? (
        <div className="space-y-3">
          <EmptyState
            title={allTransactions.length === 0
              ? t('ledger.emptyTitle')
              : t('ledger.noResultsTitle')}
            description={allTransactions.length === 0
              ? t('ledger.emptyDescription')
              : t('ledger.noResultsDescription')}
            icon={<Inbox size={22} aria-hidden="true" />}
          />
          {allTransactions.length > 0 && (hasActiveFilters || hasActiveSearch) && (
            <button
              type="button"
              onClick={clearFilters}
              className="mx-auto block rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-primary-300 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >
              {t('ledger.clearSearchAndFilters')}
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl bg-white border border-gray-100 overflow-hidden">
          {groupedTransactions.map(group => (
            <div key={group.key}>
              <h3 className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
                {group.label}
              </h3>
              <div className="divide-y divide-gray-50">
                {group.items.map(tx => {
                  const event = eventByTransactionId.get(tx.id);
                  return event ? (
                    <HumanReadableEventCard
                      key={tx.id}
                      event={event}
                      onClick={() => setSelectedTransaction(tx)}
                    />
                  ) : null;
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Details Sheet */}
      <TransactionDetailsSheet
        isOpen={!!selectedTransaction}
        onClose={() => setSelectedTransaction(null)}
        event={selectedEvent}
        actionSource={selectedActionSource}
        currency={currency}
      />
    </div>
  );
}
