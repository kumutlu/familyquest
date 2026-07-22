import { useStore } from '../store/useStore';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '../components/ui/Card';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { isChildRole, isParentRole } from '../lib/roles';
import { Navigate } from 'react-router-dom';
import { useState } from 'react';
import { AddMoneyModal } from '../components/wallet/AddMoneyModal';
import { signedTransactionAmount } from '../lib/walletPresentation';
import { formatPence, formatDate as i18nFormatDate, resolveFamilyCurrencyCode } from '../i18n/format';

export function Wallets() {
  const { currentUser, familyData, familyMembers, loading, walletTransactions, childWallets } = useStore();
  const { t } = useTranslation('wallet');
  const currencyCode = resolveFamilyCurrencyCode(familyData);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  if (loading) return <div className="p-8 text-center text-gray-500 animate-pulse">{t('allowance.loading')}</div>;

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

  const formatTransactionLabel = (tx: any) => {
    if (tx.description) return tx.description;
    const amountPence = signedTransactionAmount(tx);
    const abs = formatAmount(amountPence);
    if (tx.type === 'deposit') return t('allowance.added', { amount: abs });
    if (tx.type === 'allowance') return t('allowance.allowance', { amount: abs });
    if (tx.type === 'transfer_out') return t('allowance.transferSent', { amount: abs });
    if (tx.type === 'transfer_in') return t('allowance.transferReceived', { amount: abs });
    if (tx.type === 'behaviour_penalty') return t('allowance.behaviourPenalty', { amount: abs });
    if (tx.type === 'fund_contribution') return t('allowance.fundDonation', { amount: abs });
    if (tx.type === 'withdrawal') return t('allowance.withdrawal', { amount: abs });

    // Fallbacks
    if (amountPence > 0) return t('allowance.added', { amount: abs });
    return t('allowance.deducted', { amount: abs });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-8">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{t('allowance.title')}</h1>
        <p className="text-gray-500 mt-1">{t('allowance.subtitle')}</p>
      </header>

      {children.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500 shadow-sm">
          {t('allowance.noChildren')}
        </div>
      ) : (
        <div className="space-y-4">
          {children.map(child => {
            const recentTxs = getRecentTransactions(child.id);
            // Canonical balance source: families/{familyId}/wallets/{childId}.balance
            // The wallet document id equals the child's user document id (auth UID),
            // which is the same identifier used by wallet_transactions.childId.
            // We must NOT fall back to the legacy child.walletBalance profile field.
            const walletDoc = childWallets.find(w => w.id === child.id);
            const balance = walletDoc?.balance ?? 0;

            return (
              <Card key={child.id} className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="p-5 border-b border-gray-100 flex items-start justify-between bg-white">
                    <div className="flex items-center gap-4">
                      <Avatar src={child.avatarUrl} fallback={child.displayName[0]} size="md" />
                      <div>
                        <h4 className="font-semibold text-gray-900 flex items-center gap-2 text-lg">
                          {child.displayName}
                          {child.isManaged && (
                            <Badge variant="outline" className="text-[10px] border-gray-300 text-gray-500 bg-gray-50">{t('allowance.managed')}</Badge>
                          )}
                        </h4>
                        <div className="mt-1">
                          <span className="text-xs text-gray-500 uppercase font-bold tracking-wider mr-2">{t('allowance.balance')}</span>
                          <span className="text-xl font-extrabold text-success-600">{formatAmount(balance)}</span>
                        </div>
                      </div>
                    </div>
                    
                    <button
                      onClick={() => setSelectedChildId(child.id)}
                      className="bg-primary-50 hover:bg-primary-100 text-primary-700 font-bold py-2 px-4 rounded-xl transition-colors text-sm"
                    >
                      {t('allowance.manageWallet')}
                    </button>
                  </div>
                  
                  <div className="bg-gray-50 p-4">
                    <h5 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">{t('allowance.recentActivity')}</h5>
                    {recentTxs.length === 0 ? (
                      <p className="text-sm text-gray-500">{t('allowance.noRecent')}</p>
                    ) : (
                      <div className="space-y-2">
                        {recentTxs.map(tx => (
                          <div key={tx.id} className="flex justify-between items-center text-sm bg-white p-2.5 rounded-lg border border-gray-100 shadow-sm">
                            <div>
                              <p className="font-medium text-gray-800">
                                {formatTransactionLabel(tx)}
                              </p>
                              {tx.note && <p className="text-xs text-gray-500 mt-0.5">{tx.note}</p>}
                            </div>
                            <span className="text-[10px] text-gray-400 font-medium">
                              {formatDate(tx.createdAt)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
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
