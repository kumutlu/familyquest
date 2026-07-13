import { useState } from 'react';
import { useStore } from '../store/useStore';
import { FundCard } from '../components/funds/FundCard';
import { PetLeaderboard } from '../components/funds/PetLeaderboard';
import { createFund } from '../lib/api';
import { Button } from '../components/ui/Button';
import { CurrencyDisplay } from '../components/ui/CurrencyDisplay';

export function FundsDashboard() {
  const { currentUser, familyData, myWallet, funds, fundTransactions } = useStore();
  const [showCreate, setShowCreate] = useState(false);

  const [newFund, setNewFund] = useState({
    name: '',
    species: 'Dog',
    monthlyBudget: '',
    emergencyGoal: ''
  });

  const isParent = currentUser?.role === 'parent' || currentUser?.role === 'owner';
  const currencySymbol = familyData?.currency || '£';

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
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Pet Box</h1>
          <p className="text-sm text-gray-500 font-medium mt-1">Shared family funds</p>
        </div>
        {isParent ? (
          <Button onClick={() => setShowCreate(true)}>Add Pet</Button>
        ) : (
          <div className="text-right">
            <p className="text-xs text-gray-500 font-bold uppercase mb-1">Your Wallet</p>
            <p className="text-2xl font-extrabold"><CurrencyDisplay amountPence={myWallet?.balance || 0} className="text-success-600" /></p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-gray-900 px-1">Active Funds</h2>
          {funds.length === 0 ? (
            <div className="bg-gray-50 rounded-2xl p-8 text-center border border-gray-100">
              <span className="text-4xl mb-3 block">🐾</span>
              <p className="text-gray-500 font-medium">No pets added yet.</p>
            </div>
          ) : (
            funds.map((fund: any) => (
              <FundCard key={fund.id} fund={fund} fundTransactions={fundTransactions} isParent={isParent} currencySymbol={currencySymbol} />
            ))
          )}
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-bold text-gray-900 px-1">Top Helpers</h2>
          <PetLeaderboard fundTransactions={fundTransactions} familyMembers={useStore.getState().familyMembers} currencySymbol={currencySymbol} />
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h3 className="text-xl font-bold mb-4">Add Pet to Family</h3>
            <form onSubmit={handleCreateFund} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700">Pet Name</label>
                <input type="text" required value={newFund.name} onChange={e => setNewFund({...newFund, name: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700">Species</label>
                <select value={newFund.species} onChange={e => setNewFund({...newFund, species: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                  {['Dog', 'Cat', 'Rabbit', 'Bird', 'Hamster', 'Other'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700">Monthly Budget ({currencySymbol})</label>
                <input type="number" required step="0.01" min="0" value={newFund.monthlyBudget} onChange={e => setNewFund({...newFund, monthlyBudget: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700">Emergency Goal ({currencySymbol}) (Optional)</label>
                <input type="number" step="0.01" min="0" value={newFund.emergencyGoal} onChange={e => setNewFund({...newFund, emergencyGoal: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
              </div>
              <div className="flex gap-3 pt-4">
                <Button type="button" variant="secondary" onClick={() => setShowCreate(false)} fullWidth>Cancel</Button>
                <Button type="submit" fullWidth>Save Pet</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
