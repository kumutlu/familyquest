import { useStore } from '../store/useStore';
import { useTranslation } from 'react-i18next';
import { HelpButton } from '../help/components/HelpButton';
import { PageLoader } from '../components/ui/PageLoader';
import { Badge } from '../components/ui/Badge';
import { isChildRole, isParentRole } from '../lib/roles';
import { Navigate } from 'react-router-dom';
import { useState } from 'react';
import { AddMoneyModal } from '../components/wallet/AddMoneyModal';
import { transactionPresentation } from '../lib/walletPresentation';
import { formatPence, formatDate as i18nFormatDate, resolveFamilyCurrencyCode } from '../i18n/format';
import { CharacterFrame } from '../components/queki/CharacterFrame';
import { TactileButton } from '../components/queki/TactileButton';

export function Wallets() {
  const { currentUser, familyData, familyMembers, loading, walletTransactions, childWallets } = useStore();
  const { t } = useTranslation('wallet');
  const currencyCode = resolveFamilyCurrencyCode(familyData);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  if (loading) return <PageLoader label={t('allowance.loading')} />;

  if (!isParentRole(currentUser?.role)) {
    return <Navigate to="/" replace />;
  }

  const children = familyMembers.filter(m => isChildRole(m.role));

  const formatDate = (ts: any) => {
    if (!ts) return '';
    return i18nFormatDate(ts.toDate(), undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const getRecentTransactions = (childId: string) => {
    const txs = walletTransactions
      .filter(tx => tx.childId === childId)
      .sort((a, b) => {
        const aTime = a.createdAt?.toMillis() || 0;
        const bTime = b.createdAt?.toMillis() || 0;
        return bTime - aTime;
      });
    return txs.slice(0, 3);
  };

  const formatAmount = (amountPence: number) => {
    return formatPence(amountPence, currencyCode);
  };

  // Single source of truth for activity labels: walletPresentation.transactionPresentation
  // (which delegates transfer rows to transferTitle). No local ad-hoc formatting here.
  const nameResolver = (id: string) => familyMembers.find(m => m.id === id)?.displayName;

  const formatTransactionLabel = (tx: any) =>
    transactionPresentation(tx, { nameResolver, t }).title;

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-8">
      <header>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{t('allowance.title')}</h1>
          <HelpButton />
        </div>
        <p className="text-gray-500 mt-1">{t('allowance.subtitle')}</p>
      </header>

      {children.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500 shadow-sm">
          {t('allowance.noChildren')}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2" data-testid="parent-wallet-list">
          {children.map(child => {
            const recentTxs = getRecentTransactions(child.id);
            // Canonical balance source: families/{familyId}/wallets/{childId}.balance
            // The wallet document id equals the child's user document id (auth UID),
            // which is the same identifier used by wallet_transactions.childId.
            // We must NOT fall back to the legacy child.walletBalance profile field.
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
                    <CharacterFrame src={child.avatarUrl} fallback={child.displayName?.[0] || '?'} size={52} />
                    <div className="min-w-0">
                      <h4 className="font-bold flex items-center gap-2 text-lg truncate">
                        {child.displayName}
                        {child.isManaged && (
                          <Badge variant="outline" className="text-[10px] border-white/40 text-white/90 bg-white/10">{t('allowance.managed')}</Badge>
                        )}
                      </h4>
                      <p className="mt-1 text-2xl font-extrabold tabular-nums" data-testid={`wallet-balance-${child.id}`}>
                        {formatAmount(balance)}
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

                <div className="qk-bg-inset p-4">
                  <h5 className="text-xs font-bold qk-text-secondary uppercase tracking-wider mb-3">{t('allowance.recentActivity')}</h5>
                  {recentTxs.length === 0 ? (
                    <p className="text-sm qk-text-secondary">{t('allowance.noRecent')}</p>
                  ) : (
                    <div className="space-y-2">
                      {recentTxs.map(tx => (
                        <div key={tx.id} className="flex justify-between items-center text-sm rounded-xl qk-bg-card border qk-border-subtle p-2.5">
                          <div className="min-w-0">
                            <p className="font-medium qk-text-primary truncate">
                              {formatTransactionLabel(tx)}
                            </p>
                            {tx.note && <p className="text-xs qk-text-secondary mt-0.5 truncate">{tx.note}</p>}
                          </div>
                          <span className="text-[10px] qk-text-secondary font-medium shrink-0 ml-2">
                            {formatDate(tx.createdAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

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
