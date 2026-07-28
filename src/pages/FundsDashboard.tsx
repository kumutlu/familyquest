import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/useStore';
import { FundCard } from '../components/funds/FundCard';
import { PetLeaderboard } from '../components/funds/PetLeaderboard';
import { createFund } from '../lib/api';
import { Button } from '../components/ui/Button';
import { CurrencyDisplay } from '../components/ui/CurrencyDisplay';
import { currencySymbolFromCode, resolveFamilyCurrencyCode } from '../i18n/format';
import { isPetBoxEnabled } from '../lib/familyFeatures';
import { Navigate } from 'react-router-dom';

export function FundsDashboard() {
  const { t } = useTranslation(['funds', 'common']);
  const { currentUser, familyData, myWallet, funds, fundTransactions, petboxRequests, reversals } = useStore();

  const [showCreate, setShowCreate] = useState(false);

  const [newFund, setNewFund] = useState({
    name: '',
    species: 'Dog',
    monthlyBudget: '',
    emergencyGoal: ''
  });

  const isParent = currentUser?.role === 'parent' || currentUser?.role === 'owner';
  const currencySymbol = currencySymbolFromCode(resolveFamilyCurrencyCode(familyData));
  if (familyData && !isPetBoxEnabled(familyData)) return <Navigate to="/" replace />;

  const handleCreateFund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!familyData) return;

    await createFund(familyData.id, {
      type: 'pet',
      name: newFund.name,
      species: newFund.species.toLowerCase(),
      monthlyBudget: Math.round(parseFloat(newFund.monthlyBudget || "0") * 100),
      emergencyGoal: newFund.emergencyGoal ? Math.round(parseFloat(newFund.emergencyGoal) * 100) : 0
    });

    setShowCreate(false);
    setNewFund({ name: '', species: 'Dog', monthlyBudget: '', emergencyGoal: '' });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">{t('title')}</h1>
          <p className="text-sm text-gray-500 font-medium mt-1">{t('subtitle')}</p>
        </div>
        {isParent ? (
          <Button onClick={() => setShowCreate(true)}>{t('addPet')}</Button>
        ) : (
          <div className="text-right">
            <p className="text-xs text-gray-500 font-bold uppercase mb-1">{t('yourWallet')}</p>
            <p className="text-2xl font-extrabold"><CurrencyDisplay amountPence={myWallet?.balance || 0} className="text-success-600" /></p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-gray-900 px-1">{t('activeFunds')}</h2>
          {funds.length === 0 ? (
            <div className="bg-gray-50 rounded-2xl p-8 text-center border border-gray-100">
              <span className="text-4xl mb-3 block">🐾</span>
              <p className="text-gray-500 font-medium">{t('noPets')}</p>
            </div>
          ) : (
            funds.map((fund: any) => (
              <FundCard key={fund.id} fund={fund} fundTransactions={fundTransactions} petboxRequests={petboxRequests} isParent={isParent} currencySymbol={currencySymbol} />
            ))
          )}
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-bold text-gray-900 px-1">{t('topHelpers')}</h2>
          <PetLeaderboard fundTransactions={fundTransactions} familyMembers={useStore.getState().familyMembers} reversals={reversals} currencySymbol={currencySymbol} />
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h3 className="text-xl font-bold mb-4">{t('addPetTitle')}</h3>
            <form onSubmit={handleCreateFund} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700">{t('petName')}</label>
                <input type="text" required value={newFund.name} onChange={e => setNewFund({...newFund, name: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700">{t('species')}</label>
                <select value={newFund.species} onChange={e => setNewFund({...newFund, species: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                  {['Dog', 'Cat', 'Rabbit', 'Bird', 'Hamster', 'Other'].map(s => (
                    <option key={s} value={s.toLowerCase()}>{t(`speciesOptions.${s.toLowerCase()}` as any)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700">{t('monthlyBudget', { symbol: currencySymbol })}</label>
                <input type="number" required step="0.01" min="0" value={newFund.monthlyBudget} onChange={e => setNewFund({...newFund, monthlyBudget: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700">{t('emergencyGoal', { symbol: currencySymbol })}</label>
                <input type="number" step="0.01" min="0" value={newFund.emergencyGoal} onChange={e => setNewFund({...newFund, emergencyGoal: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
              </div>
              <div className="flex gap-3 pt-4">
                <Button type="button" variant="secondary" onClick={() => setShowCreate(false)} fullWidth>{t('common:cancel')}</Button>
                <Button type="submit" fullWidth>{t('savePet')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
