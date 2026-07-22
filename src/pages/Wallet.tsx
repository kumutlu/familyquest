import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/useStore';
import { isChildRole } from '../lib/roles';
import {
  computeMoneyInsights,
  pendingOutgoingPence,
  sortTransactionsNewestFirst,
  requestTime,
} from '../lib/walletPresentation';
import { isPendingTransferStatus } from '../lib/requestStatus';
import { AccountHeader } from '../components/wallet/AccountHeader';
import { BalanceCard } from '../components/wallet/BalanceCard';
import { QuickActions } from '../components/wallet/QuickActions';
import { MoneyInsights } from '../components/wallet/MoneyInsights';
import { PendingTransfers } from '../components/wallet/PendingTransfers';
import { TransactionList } from '../components/wallet/TransactionList';
import { TransactionDetailsModal } from '../components/wallet/TransactionDetailsModal';
import { SendMoneyModal } from '../components/wallet/SendMoneyModal';
import { RequestMoneyModal } from '../components/wallet/RequestMoneyModal';
import { ErrorState, TransactionSkeletonRows } from '../components/wallet/WalletStates';
import { currencySymbolFromCode, resolveFamilyCurrencyCode } from '../i18n/format';

// Re-exported for backward compatibility with helpers previously defined here.
export {
  signedTransactionAmount,
  isSameMonth,
  requestTime,
} from '../lib/walletPresentation';

const INITIAL_VISIBLE = 20;

export function Wallet() {
  const {
    currentUser,
    myWallet,
    walletTransactions,
    transferRequests,
    loading,
    familyMembers,
    familyData,
    bootstrapError,
    featureErrors,
    bootstrapStatus,
    retryBootstrap,
  } = useStore();

  const { t } = useTranslation('wallet');

  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  const [activeModal, setActiveModal] = useState<null | 'send' | 'request'>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  // Full-page loading skeleton (global bootstrap still in flight).
  if (loading || !currentUser) {
    return (
      <div className="mx-auto max-w-2xl w-full px-4 space-y-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
        <BalanceCard loading />
        <div className="grid grid-cols-2 gap-3" aria-hidden="true">
          <div className="h-[72px] rounded-2xl bg-gray-100 animate-pulse" />
          <div className="h-[72px] rounded-2xl bg-gray-100 animate-pulse" />
        </div>
        <div className="grid grid-cols-3 gap-3" aria-hidden="true">
          <div className="h-16 rounded-2xl bg-gray-100 animate-pulse" />
          <div className="h-16 rounded-2xl bg-gray-100 animate-pulse" />
          <div className="h-16 rounded-2xl bg-gray-100 animate-pulse" />
        </div>
        <div className="rounded-2xl bg-white border border-gray-100 overflow-hidden">
          <TransactionSkeletonRows />
        </div>
        <span className="sr-only" role="status">{t('page.loading')}</span>
      </div>
    );
  }

  const isChild = isChildRole(currentUser?.role);
  const currencyCode = resolveFamilyCurrencyCode(familyData);
  const currency = currencySymbolFromCode(currencyCode);
  const currentBalance = myWallet?.balance || 0;
  const bs = bootstrapStatus || {};

  // Critical bootstrap failure: show a friendly error with retry. Raw Firebase
  // error text is never surfaced to the user.
  if (bootstrapError) {
    return (
      <div className="mx-auto max-w-2xl w-full px-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
        <ErrorState message={t('error.loadWallet')} onRetry={retryBootstrap} />
      </div>
    );
  }

  // Name resolver for counterparties / actors, built from real family data.
  const memberMap = new Map<string, any>();
  (familyMembers || []).forEach(m => memberMap.set(m.id, m));
  memberMap.set(currentUser.id, currentUser);
  const nameResolver = (id?: string) => (id ? memberMap.get(id)?.displayName : undefined);

  const insights = computeMoneyInsights(walletTransactions, new Date());
  // Pending insight is unavailable (not £0.00) when its data source failed to load.
  const pendingUnavailable = isChild && !!featureErrors?.transferRequests;
  const pending = isChild ? pendingOutgoingPence(transferRequests, currentUser.id) : 0;

  const sorted = sortTransactionsNewestFirst(walletTransactions);
  const visible = sorted.slice(0, visibleCount);
  const hasMore = sorted.length > visibleCount;

  // Only outgoing requests still awaiting parent approval belong in the
  // Pending transfers section. Rejected/approved requests are excluded.
  const myTransferRequests = isChild
    ? (transferRequests || [])
        .filter(r => r.fromChildId === currentUser.id && isPendingTransferStatus(r.status))
        .sort((a, b) => requestTime(b.createdAt) - requestTime(a.createdAt))
        .slice(0, 5)
    : [];

  return (
    <div className="mx-auto max-w-2xl w-full px-4 space-y-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))] animate-in fade-in duration-300">
      {isChild ? (
        <AccountHeader
          name={currentUser.displayName || t('accountHeader.member')}
          avatarUrl={currentUser.avatarUrl}
          subtitle={t('accountHeader.subtitle')}
          accountStatus={t('accountHeader.accountStatus')}
        />
      ) : (
        <header>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{t('page.title')}</h1>
          <p className="text-gray-500 mt-1">{t('page.subtitle')}</p>
        </header>
      )}

      <BalanceCard
        balance={currentBalance}
        currency={currency}
        loading={!!bs.wallets && bs.wallets === 'loading'}
        unavailable={myWallet == null}
      />

      {isChild && (
        <QuickActions
          onSend={() => setActiveModal('send')}
          onRequest={() => setActiveModal('request')}
        />
      )}

      <MoneyInsights
        moneyIn={insights.moneyIn}
        moneyOut={insights.moneyOut}
        pending={pending}
        currency={currency}
        pendingUnavailable={pendingUnavailable}
      />

      {isChild && (
        <PendingTransfers
          requests={myTransferRequests}
          currency={currency}
          loading={!!bs.transferRequests && bs.transferRequests === 'loading'}
          error={featureErrors?.transferRequests || null}
          unavailable={pendingUnavailable}
          onRetry={retryBootstrap}
        />
      )}

      <TransactionList
        transactions={visible}
        hasMore={hasMore}
        onLoadMore={() => setVisibleCount(c => c + INITIAL_VISIBLE)}
        onSelect={setSelectedTransaction}
        nameResolver={nameResolver}
        currency={currency}
        currentUserId={currentUser.id}
        loading={!!bs.walletTransactions && bs.walletTransactions === 'loading'}
        error={featureErrors?.walletTransactions || null}
        onRetry={retryBootstrap}
      />

      <TransactionDetailsModal
        isOpen={!!selectedTransaction}
        onClose={() => setSelectedTransaction(null)}
        transaction={selectedTransaction}
        nameResolver={nameResolver}
      />
      {isChild && activeModal === 'send' && (
        <SendMoneyModal onClose={() => setActiveModal(null)} currencyCode={currencyCode} />
      )}
      {isChild && activeModal === 'request' && (
        <RequestMoneyModal onClose={() => setActiveModal(null)} currencyCode={currencyCode} />
      )}
    </div>
  );
}
