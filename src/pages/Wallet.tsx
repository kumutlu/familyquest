import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpButton } from '../help/components/HelpButton';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, History, Plus, Minus } from 'lucide-react';
import { useStore } from '../store/useStore';
import { isChildRole, isParentRole } from '../lib/roles';
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
import { SendFlowSheet } from '../components/wallet/SendFlowSheet';
import { RequestMoneyModal } from '../components/wallet/RequestMoneyModal';
import { TransferArrivalMoment } from '../components/wallet/TransferArrivalMoment';
import { ErrorState, TransactionSkeletonRows } from '../components/wallet/WalletStates';
import { currencySymbolFromCode, resolveFamilyCurrencyCode, formatPence } from '../i18n/format';
import { AddMoneyModal } from '../components/wallet/AddMoneyModal';
import { TactileButton } from '../components/queki/TactileButton';

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
    childWallets,
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
  const [searchParams] = useSearchParams();

  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  const [activeModal, setActiveModal] = useState<null | 'send' | 'request' | 'add' | 'withdraw'>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

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
  const isParent = isParentRole(currentUser?.role);
  const currencyCode = resolveFamilyCurrencyCode(familyData);
  const currency = currencySymbolFromCode(currencyCode);
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

  // Determine target wallet based on role and route params
  // For child: always their own wallet (myWallet)
  // For parent: if recipient param present, that child's wallet; else if selectedChildId, that child's wallet; else show family overview
  const recipientParam = searchParams.get('recipient');
  const actionParam = searchParams.get('action');

  // Build member map for name resolution
  const memberMap = new Map<string, any>();
  (familyMembers || []).forEach(m => memberMap.set(m.id, m));
  memberMap.set(currentUser.id, currentUser);
  const nameResolver = (id?: string) => (id ? memberMap.get(id)?.displayName : undefined);

  // Determine target child ID and wallet
  let targetChildId: string | null = null;
  let targetWallet: { id: string; balance: number } | null = null;
  let targetMember: any = null;

  if (isChild) {
    // Child always sees their own wallet
    targetChildId = currentUser.id;
    targetWallet = myWallet ? { id: currentUser.id, balance: myWallet.balance } : { id: currentUser.id, balance: 0 };
    targetMember = currentUser;
  } else if (isParent) {
    // Parent: check recipient param first (from MemberDetailSheet send money)
    // Then check selectedChildId state (from Wallets page manage wallet)
    // Then check if there's only one child
    const children = familyMembers.filter(m => isChildRole(m.role));

    if (recipientParam) {
      targetChildId = recipientParam;
    } else if (selectedChildId) {
      targetChildId = selectedChildId;
    } else if (children.length === 1) {
      targetChildId = children[0].id;
    }

    if (targetChildId) {
      targetWallet = childWallets.find(w => w.id === targetChildId) || { id: targetChildId, balance: 0 };
      targetMember = memberMap.get(targetChildId) || null;
    }
  }

  const currentBalance = targetWallet?.balance ?? 0;
  const hasTargetWallet = targetWallet != null && targetChildId != null;

  // Filter transactions for target child (for parent viewing child's wallet).
  // For child, show all their transactions.
  // NOTE: computed inline (not useMemo) because this component returns early
  // for loading/error states above — a hook here would run conditionally.
  const filteredTransactions = isChild
    ? walletTransactions
    : targetChildId
      ? walletTransactions.filter(tx => tx.childId === targetChildId)
      : [];

  const insights = computeMoneyInsights(filteredTransactions, new Date());
  const pendingUnavailable = isChild && !!featureErrors?.transferRequests;
  const pending = isChild ? pendingOutgoingPence(transferRequests, currentUser.id) : 0;

  const sorted = sortTransactionsNewestFirst(filteredTransactions);
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

  // Auto-open send modal if action=send in URL
  if (actionParam === 'send' && recipientParam && !activeModal) {
    setActiveModal('send');
  }

  // If parent with no target child selected, show family wallet overview
  if (isParent && !hasTargetWallet) {
    const children = familyMembers.filter(m => isChildRole(m.role));
    return (
      <div className="mx-auto max-w-2xl w-full px-4 space-y-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))] animate-in fade-in duration-300">
        <header>
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{t('page.title')}</h1>
            <HelpButton />
          </div>
          <p className="text-gray-500 mt-1">{t('page.subtitle')}</p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2" data-testid="parent-wallet-list">
          {children.map(child => {
            const walletDoc = childWallets.find(w => w.id === child.id);
            const balance = walletDoc?.balance ?? 0;
            return (
              <section
                key={child.id}
                data-testid="parent-wallet-card"
                className="overflow-hidden rounded-card qk-bg-card qk-border-subtle qk-shadow-card border"
              >
                <div className="flex items-start justify-between gap-3 bg-gradient-to-br from-mint-500 to-mint-700 p-5 text-white">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                      <span className="text-xl font-bold">{child.displayName?.[0] || 'C'}</span>
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold flex items-center gap-2 text-lg truncate">
                        {child.displayName}
                      </h4>
                      <p className="mt-1 text-2xl font-extrabold tabular-nums" data-testid={`wallet-balance-${child.id}`}>
                        {formatPence(balance, currencyCode)}
                      </p>
                      <p className="text-xs text-white/70 uppercase font-bold tracking-wider">{t('allowance.balance')}</p>
                    </div>
                  </div>
                  <TactileButton
                    variant="secondary"
                    size="sm"
                    onClick={() => setSelectedChildId(child.id)}
                    data-testid={`manage-wallet-${child.id}`}
                  >
                    {t('allowance.manageWallet')}
                  </TactileButton>
                </div>
              </section>
            );
          })}
        </div>

        {selectedChildId && (
          <AddMoneyModal
            child={children.find(c => c.id === selectedChildId)}
            onClose={() => setSelectedChildId(null)}
            currencyCode={currencyCode}
          />
        )}
      </div>
    );
  }

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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                {targetMember ? `${targetMember.displayName}'s Wallet` : t('page.title')}
              </h1>
              <HelpButton />
            </div>
            {targetMember && (
              <div className="flex items-center gap-2">
                <TactileButton
                  variant="secondary"
                  size="sm"
                  onClick={() => setActiveModal('add')}
                  data-testid="add-money-btn"
                >
                  <Plus size={16} aria-hidden="true" />
                  <span>{t('manage.addTab')}</span>
                </TactileButton>
                <TactileButton
                  variant="secondary"
                  size="sm"
                  onClick={() => setActiveModal('withdraw')}
                  data-testid="withdraw-money-btn"
                >
                  <Minus size={16} aria-hidden="true" />
                  <span>{t('manage.withdrawTab')}</span>
                </TactileButton>
              </div>
            )}
          </div>
          <p className="text-gray-500 mt-1">
            {targetMember ? t('page.subtitle') : t('page.subtitle')}
          </p>
        </header>
      )}

      <BalanceCard
        balance={currentBalance}
        currency={currency}
        loading={!!bs.wallets && bs.wallets === 'loading'}
        unavailable={!hasTargetWallet}
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

      <Link
        to={isChild ? "/history" : (targetChildId ? `/history?child=${targetChildId}` : "/history")}
        className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white px-4 py-3 font-semibold text-gray-700 transition-colors hover:border-primary-200 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
      >
        <span className="flex items-center gap-2">
          <History size={18} aria-hidden="true" />
          {t('transactions')}
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </Link>

      <TransactionList
        transactions={visible}
        hasMore={hasMore}
        onLoadMore={() => setVisibleCount(c => c + INITIAL_VISIBLE)}
        onSelect={setSelectedTransaction}
        nameResolver={nameResolver}
        currency={currency}
        currentUserId={targetChildId || currentUser.id}
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
        <SendFlowSheet onClose={() => setActiveModal(null)} currencyCode={currencyCode} />
      )}
      {isChild && activeModal === 'request' && (
        <RequestMoneyModal onClose={() => setActiveModal(null)} currencyCode={currencyCode} />
      )}
      {isParent && activeModal === 'add' && targetMember && (
        <AddMoneyModal
          child={targetMember}
          onClose={() => setActiveModal(null)}
          currencyCode={currencyCode}
        />
      )}
      {isParent && activeModal === 'withdraw' && targetMember && (
        <AddMoneyModal
          child={targetMember}
          onClose={() => setActiveModal(null)}
          currencyCode={currencyCode}
        />
      )}

      {/* Recipient-side living moment — derived purely from the authoritative
          wallet_transactions stream; never replays on reload. */}
      {isChild && (
        <TransferArrivalMoment
          transactions={walletTransactions}
          currentUserId={currentUser.id}
          familyMembers={familyMembers}
          familyData={familyData}
          currencyCode={currencyCode}
        />
      )}
    </div>
  );
}
