import { Card, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Progress } from '../ui/Progress';
import { ExpenseModal } from './ExpenseModal';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { contributeToFund } from '../../lib/api';
import { PetBoxConfirmationModal } from './PetBoxConfirmationModal';
import { useStore } from '../../store/useStore';
import { HistoryActionControl } from '../reversals/HistoryActionControl';
import { findLegacyPetboxRequest, logLegacyMatchDiagnostics } from '../../lib/legacyPetboxMatcher';
import { formatDate as i18nFormatDate } from '../../i18n/format';

export function FundCard({ fund, fundTransactions, petboxRequests = [], isParent, currencySymbol }: {
  fund: any;
  fundTransactions: any[];
  petboxRequests?: any[];
  isParent: boolean;
  currencySymbol: string;
}) {
  const { t } = useTranslation('funds');
  const [showExpense, setShowExpense] = useState(false);
  const [isContributing, setIsContributing] = useState(false);
  const [showAllExpenses, setShowAllExpenses] = useState(false);
  const [showAllDonations, setShowAllDonations] = useState(false);
  const [confirmAmount, setConfirmAmount] = useState<number | null>(null);
  const { currentUser, familyData, familyMembers } = useStore();

  const getSpeciesEmoji = (species: string) => {
    const s = species?.toLowerCase();
    if (s === 'dog') return '🐶';
    if (s === 'cat') return '🐱';
    if (s === 'rabbit') return '🐰';
    if (s === 'bird') return '🦜';
    if (s === 'hamster') return '🐹';
    return '🐾';
  };

  const fundTxs = fundTransactions.filter(tx => tx.fundId === fund.id);

  const spentThisMonth = fundTxs
    .filter(tx => tx.type === 'expense')
    .filter(tx => {
      if (!tx.createdAt) return false;
      const date = tx.createdAt.toDate();
      const now = new Date();
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    })
    .reduce((acc, tx) => acc + tx.amount, 0);

  const budgetProgress = fund.monthlyBudget ? Math.min((spentThisMonth / fund.monthlyBudget) * 100, 100) : 0;
  const emergencyProgress = fund.emergencyGoal ? Math.min((fund.balance / fund.emergencyGoal) * 100, 100) : 0;

  const expenseTxs = fundTxs
    .filter(tx => tx.type === 'expense')
    .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

  // Donation history: contribution-type fund_transactions for this fund
  const donationTxs = fundTxs
    .filter(tx => tx.type === 'contribution')
    .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));

  // Lookup map: petbox_request id → petbox_request document
  // fund_transactions link back to petbox_requests via tx.sourceId
  const petboxRequestMap = new Map<string, any>(
    petboxRequests
      .filter(r => r.fundId === fund.id)
      .map(r => [r.id, r])
  );

  const visibleExpenses = showAllExpenses ? expenseTxs : expenseTxs.slice(0, 5);
  const visibleDonations = showAllDonations ? donationTxs : donationTxs.slice(0, 5);

  const formatDate = (ts: any) => {
    if (!ts) return '';
    return i18nFormatDate(ts.toDate(), undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const handleContribute = async (amountPounds: number) => {
    setConfirmAmount(amountPounds * 100);
  };

  const executeContribution = async () => {
    if (!currentUser || !confirmAmount) return;
    setIsContributing(true);
    try {
      await contributeToFund(familyData.id, fund.id, currentUser.id, confirmAmount, fund.name, currentUser.displayName);
      alert(t('contributeSuccess', { amount: `${currencySymbol}${(confirmAmount / 100).toFixed(2)}`, name: fund.name }));
      setConfirmAmount(null);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setIsContributing(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 bg-primary-100 rounded-2xl flex items-center justify-center text-4xl shadow-sm border border-primary-200">
              {fund.type === 'pet' ? getSpeciesEmoji(fund.species) : '🎯'}
            </div>
            <div>
              <h3 className="font-bold text-xl text-gray-900">{fund.name}</h3>
              <p className="text-sm text-gray-500 capitalize">{fund.species || fund.type}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 font-bold uppercase mb-1">{t('balance')}</p>
            {fund.balance < 0 ? (
              <p className="text-xl font-extrabold text-warning-700" data-testid="fund-balance">
                -{currencySymbol}{(Math.abs(fund.balance) / 100).toFixed(2)}
              </p>
            ) : (
              <p className="text-xl font-extrabold text-success-600" data-testid="fund-balance">
                {currencySymbol}{(fund.balance / 100).toFixed(2)}
              </p>
            )}
          </div>
        </div>

        {fund.balance < 0 && (
          <div className="mb-4 rounded-xl bg-warning-50 border border-warning-200 p-3 text-warning-700 text-sm" data-testid="fund-deficit">
            <span className="font-bold">{t('deficit', { amount: `${currencySymbol}${(Math.abs(fund.balance) / 100).toFixed(2)}` })}</span>
          </div>
        )}

        {/* Monthly Budget */}
        {fund.monthlyBudget > 0 && (
          <div className="bg-gray-50 p-4 rounded-xl mb-3">
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium text-gray-700">{t('monthlyBudgetSpent')}</span>
              <span className="font-bold">{currencySymbol}{(spentThisMonth / 100).toFixed(2)} / {currencySymbol}{(fund.monthlyBudget / 100).toFixed(2)}</span>
            </div>
            <Progress value={budgetProgress} />
          </div>
        )}

        {/* Emergency Goal */}
        {fund.emergencyGoal > 0 && (
          <div className="bg-gray-50 p-4 rounded-xl mb-4 border border-success-100">
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium text-success-700">{t('emergencyFundGoal')}</span>
              <span className="font-bold text-success-700">{currencySymbol}{(fund.balance / 100).toFixed(2)} / {currencySymbol}{(fund.emergencyGoal / 100).toFixed(2)}</span>
            </div>
            <Progress value={emergencyProgress} color="success" />
          </div>
        )}

        {/* Donations history */}
        <div className="mb-4 space-y-2 border-t border-gray-100 pt-4">
          <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">{t('donations')}</h4>
          {donationTxs.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-2">{t('noDonations')}</p>
          ) : (
            <>
              {visibleDonations.map((tx: any) => {
                const donor = tx.fromUserId ? familyMembers.find((m: any) => m.id === tx.fromUserId) : null;
                const donorName = donor?.displayName || tx.childName || t('someone');

                // Retrieve the petbox_request that generated this fund_transaction
                let petboxRequest = tx.sourceId ? petboxRequestMap.get(tx.sourceId) : undefined;

                // If not directly linked, try legacy matching
                if (!petboxRequest && !tx.sourceId && tx.fromUserId) {
                  const matchResult = findLegacyPetboxRequest(
                    {
                      fundTxId: tx.id,
                      familyId: familyData.id,
                      fundId: fund.id,
                      fromUserId: tx.fromUserId,
                      amount: tx.amount,
                      createdAt: tx.createdAt,
                    },
                    petboxRequests.filter(r => r.fundId === fund.id)
                  );

                  logLegacyMatchDiagnostics(matchResult, false);

                  if (matchResult.matched && matchResult.petboxRequestId) {
                    petboxRequest = petboxRequestMap.get(matchResult.petboxRequestId);
                  }
                }

                return (
                  <div key={tx.id} className="flex justify-between items-center text-sm p-2 bg-reward-50 rounded-lg border border-reward-100">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">💝</span>
                      <div>
                        <p className="font-bold text-gray-700">{donorName}</p>
                        <p className="text-[10px] text-gray-500">{formatDate(tx.createdAt)}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="font-bold text-reward-700">
                        +{currencySymbol}{(tx.amount / 100).toFixed(2)}
                      </span>
                      {/* Refund button: only shown to parents/owners when petbox_request is available */}
                      {isParent && petboxRequest && (
                        <HistoryActionControl sourceKind="petbox_request" source={petboxRequest} />
                      )}
                    </div>
                  </div>
                );
              })}
              {!showAllDonations && donationTxs.length > 5 && (
                <button
                  onClick={() => setShowAllDonations(true)}
                  className="w-full text-xs font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 py-2 rounded-lg transition-colors mt-2"
                >
                  {t('viewAllDonations')}
                </button>
              )}
              {showAllDonations && donationTxs.length > 5 && (
                <button
                  onClick={() => setShowAllDonations(false)}
                  className="w-full text-xs font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 py-2 rounded-lg transition-colors mt-2"
                >
                  {t('showLess')}
                </button>
              )}
            </>
          )}
        </div>

        {/* Recent Expenses */}
        <div className="mb-4 space-y-2 border-t border-gray-100 pt-4">
          <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">{t('recentExpenses')}</h4>
          {expenseTxs.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-2">{t('noExpenses')}</p>
          ) : (
            <>
              {visibleExpenses.map((tx: any) => {
                const creator = tx.actorId ? familyMembers.find((m: any) => m.id === tx.actorId) : null;
                const creatorName = creator?.displayName || tx.createdByName || t('someone');
                return (
                  <div key={tx.id} className="flex justify-between items-center text-sm p-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">📉</span>
                      <div>
                        <p className="font-bold text-gray-700">
                          {tx.category || t('expense')}{tx.description && tx.description !== tx.category ? ` — ${tx.description}` : ''}
                        </p>
                        <p className="text-[10px] text-gray-500">
                          {t('addedBy', { name: creatorName })} &middot; {formatDate(tx.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="font-bold text-gray-900">
                        -{currencySymbol}{(tx.amount / 100).toFixed(2)}
                      </span>
                      <HistoryActionControl sourceKind="fund_transaction" source={tx} />
                    </div>
                  </div>
                );
              })}
              {!showAllExpenses && expenseTxs.length > 5 && (
                <button
                  onClick={() => setShowAllExpenses(true)}
                  className="w-full text-xs font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 py-2 rounded-lg transition-colors mt-2"
                >
                  {t('viewAllExpenses')}
                </button>
              )}
              {showAllExpenses && expenseTxs.length > 5 && (
                <button
                  onClick={() => setShowAllExpenses(false)}
                  className="w-full text-xs font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 py-2 rounded-lg transition-colors mt-2"
                >
                  {t('showLess')}
                </button>
              )}
            </>
          )}
        </div>

        {/* Action: parent adds expense, child donates */}
        {isParent ? (
          <Button fullWidth onClick={() => setShowExpense(true)}>{t('addExpense')}</Button>
        ) : (
          <div className="space-y-3 bg-reward-50 p-4 rounded-xl border border-reward-100">
            <p className="text-sm font-bold text-reward-700 text-center mb-1">{t('quickDonate', { name: fund.name })}</p>
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 5].map(amt => (
                <button
                  key={amt}
                  onClick={() => handleContribute(amt)}
                  disabled={isContributing}
                  className="bg-white text-reward-600 font-extrabold py-3 rounded-xl shadow-sm hover:shadow transition-all disabled:opacity-50 border border-reward-200 hover:bg-reward-100 flex flex-col items-center justify-center leading-none"
                >
                  <span className="text-lg">{currencySymbol}{amt}</span>
                </button>
              ))}
              <button
                onClick={() => {
                  const amt = parseFloat(prompt(t('contributePrompt', { symbol: currencySymbol }), '10') || '0');
                  if (amt > 0) handleContribute(amt);
                }}
                disabled={isContributing}
                className="bg-white text-reward-600 font-bold py-3 rounded-xl shadow-sm hover:shadow transition-all disabled:opacity-50 border border-reward-200 hover:bg-reward-100 flex items-center justify-center text-xs"
              >
                {t('other')}
              </button>
            </div>
          </div>
        )}
      </CardContent>

      <PetBoxConfirmationModal
        isOpen={confirmAmount !== null}
        onClose={() => setConfirmAmount(null)}
        onConfirm={executeContribution}
        amountPence={confirmAmount || 0}
        fundName={fund.name}
      />
      {showExpense && (
        <ExpenseModal fund={fund} familyId={familyData.id} onClose={() => setShowExpense(false)} currencySymbol={currencySymbol} />
      )}
    </Card>
  );
}
