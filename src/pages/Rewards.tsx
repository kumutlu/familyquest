import { useState } from 'react';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Gift, Gamepad2, Pizza, Ticket, Plus, Edit, Trash2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { redeemReward, createReward, updateReward } from '../lib/api';
import { cn } from '../lib/utils';
import { isParentRole } from '../lib/roles';
import { HistoryActionControl } from '../components/reversals/HistoryActionControl';

export function Rewards() {
  const { currentUser, rewards, redemptions, loading } = useStore();
  const [selectedReward, setSelectedReward] = useState<any>(null);
  const isParent = currentUser?.role === 'parent' || currentUser?.role === 'owner';
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState<any>({ title: '', cost: 50, icon: 'Gift', inventory: '' });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (loading || !currentUser) return <div className="p-8 text-center text-gray-500 animate-pulse">Loading Rewards...</div>;

  const activeRewards = rewards.filter(r => r.isActive !== false);

  const handleRedeem = async () => {
    if (currentUser.rewardPoints < selectedReward.cost) {
      setError("You don't have enough points for this reward.");
      return;
    }

    if (selectedReward.inventory !== undefined && selectedReward.inventory !== null && selectedReward.inventory <= 0) {
      setError("This reward is out of stock.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await redeemReward(currentUser.familyId, currentUser.id, selectedReward.id);
      
      // Also decrement inventory if applicable
      if (selectedReward.inventory !== undefined && selectedReward.inventory !== null && selectedReward.inventory !== '') {
        await updateReward(currentUser.familyId, selectedReward.id, {
          inventory: selectedReward.inventory - 1
        });
      }

      setTimeout(() => {
        setSelectedReward(null);
        setIsSubmitting(false);
      }, 1500);
    } catch (e: any) {
      console.error(e);
      setError(e.message || 'Failed to redeem reward.');
      setIsSubmitting(false);
    }
  };

  const openCreateForm = () => {
    setFormData({ title: '', cost: 50, icon: 'Gift', inventory: '' });
    setIsFormOpen(true);
  };

  const openEditForm = (reward: any) => {
    setFormData({ ...reward });
    setSelectedReward(null);
    setIsFormOpen(true);
  };

  const handleArchive = async (rewardId: string) => {
    if (confirm('Are you sure you want to archive this reward?')) {
      try {
        await updateReward(currentUser.familyId, rewardId, { isActive: false });
        setSelectedReward(null);
      } catch (e: any) {
        alert(e.message);
      }
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const dataToSave = {
        title: formData.title,
        cost: Number(formData.cost),
        icon: formData.icon,
        isActive: true,
        inventory: formData.inventory === '' ? null : Number(formData.inventory)
      };

      if (formData.id) {
        await updateReward(currentUser.familyId, formData.id, dataToSave);
        setSuccessMsg('Reward updated successfully!');
      } else {
        await createReward(currentUser.familyId, dataToSave);
        setSuccessMsg('Reward created successfully!');
      }
      setIsFormOpen(false);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e: any) {
      setError(e.message);
    }
    setIsSubmitting(false);
  };

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'Gamepad2': return <Gamepad2 className="text-reward-500" size={24} />;
      case 'Pizza': return <Pizza className="text-reward-500" size={24} />;
      case 'Ticket': return <Ticket className="text-reward-500" size={24} />;
      default: return <Gift className="text-reward-500" size={24} />;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Rewards</h1>
          <p className="text-gray-500 mt-1">Spend your hard-earned points.</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="reward" className="text-sm px-3 py-1 bg-reward-100 text-reward-700">
            {currentUser.rewardPoints} pts
          </Badge>
          {isParentRole(currentUser.role) && (
            <Button onClick={openCreateForm} aria-label="Add Reward" size="sm" className="bg-reward-500 hover:bg-reward-600 rounded-full h-10 w-10 p-0 shadow-lg flex items-center justify-center">
              <Plus size={20} />
            </Button>
          )}
        </div>
      </header>

      {successMsg && (
        <div className="bg-success-50 text-success-700 p-3 rounded-xl mb-4 text-sm font-medium animate-in fade-in slide-in-from-top-2">
          {successMsg}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 pb-24">
        {activeRewards.length === 0 ? (
          <div className="col-span-2 bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500">
            No rewards available yet.
          </div>
        ) : (
          activeRewards.map((reward) => {
            const outOfStock = reward.inventory !== undefined && reward.inventory !== null && reward.inventory <= 0;
            return (
              <Card 
                key={reward.id} 
                className={cn("cursor-pointer transition-transform hover:scale-[1.02] active:scale-[0.98]", outOfStock && "opacity-50 grayscale")} 
                onClick={() => setSelectedReward(reward)}
              >
                <CardContent className="p-4 flex flex-col items-center text-center">
                  <div className="w-12 h-12 bg-reward-50 rounded-2xl flex items-center justify-center mb-3">
                    {getIcon(reward.icon)}
                  </div>
                  <h3 className="font-bold text-gray-900 text-sm mb-1 leading-tight">{reward.title}</h3>
                  <p className="text-reward-600 font-bold text-xs">{reward.cost} pts</p>
                  {reward.inventory !== undefined && reward.inventory !== null && (
                    <p className="text-xs text-gray-400 mt-1">{reward.inventory} left</p>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {isParent && redemptions.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold text-gray-900">Redemption history</h2>
          <div className="space-y-2">
            {redemptions.map(redemption => {
              const reward = rewards.find(item => item.id === redemption.rewardId);
              return (
                <Card key={redemption.id}>
                  <CardContent className="flex items-center justify-between gap-4 p-4">
                    <div>
                      <p className="font-semibold text-gray-900">{reward?.title || 'Reward'}</p>
                      <p className="text-sm text-gray-500">{redemption.costPaid} points redeemed</p>
                    </div>
                    <HistoryActionControl sourceKind="reward_redemption" source={redemption} />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* Detail & Redemption Modal */}
      {selectedReward && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-xl animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-10 duration-300 overflow-hidden flex flex-col">
            <div className="px-6 py-4 flex justify-between items-center border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-900">Reward Details</h3>
              <button onClick={() => { setSelectedReward(null); setError(null); }} className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500 transition-colors">✕</button>
            </div>
            
            <div className="p-6">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-24 h-24 bg-reward-50 rounded-3xl flex items-center justify-center">
                  {getIcon(selectedReward.icon)}
                </div>
                
                <div>
                  <h4 className="text-2xl font-bold text-gray-900">{selectedReward.title}</h4>
                  <p className="text-reward-600 font-bold text-lg mt-1">{selectedReward.cost} points</p>
                  {selectedReward.inventory !== undefined && selectedReward.inventory !== null && (
                    <p className="text-sm text-gray-500 mt-1">{selectedReward.inventory} in stock</p>
                  )}
                </div>

                {error && <div className="p-3 bg-danger-50 text-danger-600 rounded-xl text-sm w-full font-medium">{error}</div>}

                {/* Parent Actions */}
                {isParentRole(currentUser?.role) && (
                   <div className="flex gap-4 w-full mt-6 pt-6 border-t border-gray-100">
                      <Button variant="secondary" fullWidth onClick={() => openEditForm(selectedReward)}><Edit size={16} className="mr-2"/> Edit</Button>
                      <Button variant="danger" fullWidth onClick={() => handleArchive(selectedReward.id)}><Trash2 size={16} className="mr-2"/> Archive</Button>
                   </div>
                )}

                {/* Child Actions */}
                {currentUser?.role === 'child' && (
                  <Button fullWidth onClick={handleRedeem} size="lg" className="bg-reward-500 hover:bg-reward-600 shadow-reward-500/25 mt-6" disabled={isSubmitting || (selectedReward.inventory !== undefined && selectedReward.inventory !== null && selectedReward.inventory <= 0)}>
                    {isSubmitting ? 'Redeeming...' : 'Redeem Reward'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Form Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-xl overflow-hidden flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-10 duration-300">
            <div className="px-6 py-4 flex justify-between items-center border-b border-gray-100">
              <h3 className="text-xl font-bold text-gray-900">{formData.id ? 'Edit Reward' : 'New Reward'}</h3>
              <button onClick={() => setIsFormOpen(false)} className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500">✕</button>
            </div>
            <div className="p-6 overflow-y-auto">
              <form onSubmit={handleFormSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Reward Title</label>
                  <input type="text" required value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Cost (Points)</label>
                  <input type="number" required min="1" value={formData.cost} onChange={e => setFormData({...formData, cost: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Icon / Category</label>
                  <select value={formData.icon} onChange={e => setFormData({...formData, icon: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md bg-white">
                    <option value="Gift">Gift (General)</option>
                    <option value="Gamepad2">Gaming</option>
                    <option value="Pizza">Food & Treats</option>
                    <option value="Ticket">Experience / Outing</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Inventory (Optional)</label>
                  <input type="number" placeholder="Leave blank for unlimited" min="0" value={formData.inventory} onChange={e => setFormData({...formData, inventory: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
                  <p className="text-xs text-gray-500 mt-1">If set, limits how many times this can be redeemed.</p>
                </div>
                
                {error && <p className="text-red-500 text-sm">{error}</p>}
                <div className="pt-4">
                  <Button type="submit" fullWidth disabled={isSubmitting} className="bg-reward-500 hover:bg-reward-600">
                    {isSubmitting ? 'Saving...' : 'Save Reward'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
