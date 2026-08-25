import { useStore } from '../store/useStore';
import { useTranslation } from 'react-i18next';
import { HelpButton } from '../help/components/HelpButton';
import { PageLoader } from '../components/ui/PageLoader';
import { Badge } from '../components/ui/Badge';
import { isChildRole, isParentRole } from '../lib/roles';
import { Navigate } from 'react-router-dom';
import { useState } from 'react';
import { AddMoneyModal } from '../components/wallet/AddMoneyModal';
import { formatPence, resolveFamilyCurrencyCode } from '../i18n/format';
import { CharacterFrame } from '../components/queki/CharacterFrame';
import { TactileButton } from '../components/queki/TactileButton';
import { MoneyValue } from '../components/privacy/MoneyValue';
import { adaptHumanReadableFamilyEvents } from '../lib/humanReadableFamilyEvent';
import { WalletActivityRow, type WalletActivityEvent } from '../components/wallet/WalletActivityRow';

export function Wallets() {
  const { currentUser, familyData, familyMembers, loading, walletTransactions, childWallets, transferRequests, moneyRequests } = useStore();
  const { t } = useTranslation('wallet');
  const currencyCode = resolveFamilyCurrencyCode(familyData);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  if (loading) return <PageLoader label={t('allowance.loading')} />;

  if (!isParentRole(currentUser?.role)) {
    return <Navigate to="/" replace />;
  }

  const children = familyMembers.filter(m => isChildRole(m.role));

  const formatAmount = (amountPence: number) => {
    return formatPence(amountPence, currencyCode);
  };

  const nameResolver = (id: string) => familyMembers.find(m => m.id === id)?.displayName;
  const walletEvents = adaptHumanReadableFamilyEvents({
    walletTransactions,
    transferRequests,
    moneyRequests,
    opts: { currency: currencyCode, nameResolver, currentUserId: currentUser?.id, t },
  });
  const adaptedIds = new Set(walletEvents.map(event => event.transaction.id));
  const legacyEvents: WalletActivityEvent[] = walletTransactions.flatMap(tx => {
    if (adaptedIds.has(tx.id) || !tx.id || !tx.childId || !nameResolver(tx.childId)) return [];
    const headline = typeof tx.description === 'string' && tx.description ? tx.description : t('allowance.activity.legacyTransaction');
    const timestamp = tx.createdAt?.toMillis?.();
    return [{
      transaction: { id: tx.id, title: headline, subtitle: '', amountPence: 0, unit: 'money' } as WalletActivityEvent['transaction'],
      eventKind: 'unknown',
      subject: { id: tx.childId, name: nameResolver(tx.childId) },
      amountPence: 0,
      unit: 'money',
      currency: currencyCode,
      timestamp: typeof timestamp === 'number' ? timestamp : undefined,
      status: 'completed',
      sourceType: 'wallet_transaction',
      sourceId: tx.id,
      headline,
      metadata: [],
    }];
  });

  const getRecentEvents = (childId: string) => [...walletEvents, ...legacyEvents]
    .filter(event => event.sourceType === 'wallet_transaction' && event.subject?.id === childId)
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(0, 3);

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
            const recentEvents = getRecentEvents(child.id);
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
                        <MoneyValue>{formatAmount(balance)}</MoneyValue>
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
                  {recentEvents.length === 0 ? (
                    <p className="text-sm qk-text-secondary">{t('allowance.noRecent')}</p>
                  ) : (
                    <div className="space-y-2">
                      {recentEvents.map(event => (
                        <WalletActivityRow key={event.transaction.id} event={event} />
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
