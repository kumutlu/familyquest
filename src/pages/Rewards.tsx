import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Star, CheckCircle2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { redeemReward } from '../lib/api';

export function Rewards() {
  const { rewards, currentUser, loading } = useStore();
  const [filter, setFilter] = useState<'all' | 'screen-time' | 'privilege' | 'activity'>('all');
  const [selectedReward, setSelectedReward] = useState<any>(null);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading || !currentUser) return <div className="p-8 text-center text-gray-500 animate-pulse">Loading Rewards...</div>;

  const currentPoints = currentUser.rewardPoints || 0;
  const filteredRewards = filter === 'all' ? rewards : rewards.filter(r => r.category === filter);

  const handleRewardClick = (reward: any) => {
    setSelectedReward(reward);
    setIsRedeeming(false);
    setError(null);
  };

  const handleRedeem = async () => {
    if (currentPoints < selectedReward.cost) {
      setError("You don't have enough points for this reward.");
      return;
    }

    setIsRedeeming(true);
    try {
      await redeemReward(currentUser.familyId, currentUser.id, selectedReward.id);
      setTimeout(() => {
        setSelectedReward(null);
        setIsRedeeming(false);
      }, 2000);
    } catch (e: any) {
      setError(e.message);
      setIsRedeeming(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Rewards</h1>
          <p className="text-gray-500 mt-1">Treat yourself!</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Your Balance</p>
          <div className="inline-flex items-center gap-1.5 bg-reward-50 text-reward-700 px-3 py-1.5 rounded-full font-bold">
            <Star size={16} className="fill-current" />
            {currentPoints.toLocaleString()}
          </div>
        </div>
      </header>

      <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 hide-scrollbar">
        {['all', 'screen-time', 'privilege', 'activity'].map((f) => (
          <Button 
            key={f} 
            variant={filter === f ? 'primary' : 'secondary'} 
            size="sm"
            onClick={() => setFilter(f as any)}
            className="capitalize rounded-full whitespace-nowrap px-5"
          >
            {f.replace('-', ' ')}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {filteredRewards.length === 0 ? (
          <div className="col-span-full bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500">
            No rewards found.
          </div>
        ) : filteredRewards.map((reward) => {
          const canAfford = currentPoints >= reward.cost;
          return (
            <Card 
              key={reward.id} 
              className={`cursor-pointer transition-all active:scale-95 ${canAfford ? 'hover:border-reward-300 hover:shadow-md' : 'opacity-60 grayscale'}`}
              onClick={() => handleRewardClick(reward)}
            >
              <CardContent className="p-4 flex flex-col items-center text-center h-full">
                <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center text-2xl mb-3 shadow-sm border border-gray-100">
                  {reward.icon}
                </div>
                <h4 className="font-semibold text-gray-900 text-sm leading-tight flex-1 mb-3">{reward.title}</h4>
                <Badge variant={canAfford ? 'primary' : 'default'} className={`w-full justify-center ${canAfford ? 'bg-reward-100 text-reward-700' : ''}`}>
                  {reward.cost} pts
                </Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Modal isOpen={!!selectedReward} onClose={() => setSelectedReward(null)} title="Redeem Reward">
        {selectedReward && (
          <div className="space-y-6">
            {!isRedeeming ? (
              <>
                <div className="flex flex-col items-center text-center py-4">
                  <div className="text-6xl mb-4">{selectedReward.icon}</div>
                  <h3 className="text-xl font-bold text-gray-900">{selectedReward.title}</h3>
                  <Badge variant="default" className="mt-2 capitalize">{selectedReward.category.replace('-', ' ')}</Badge>
                </div>
                
                <div className="bg-gray-50 rounded-2xl p-4 flex justify-between items-center border border-gray-100">
                  <span className="text-gray-500 font-medium">Cost</span>
                  <span className="text-xl font-bold text-reward-600">{selectedReward.cost} pts</span>
                </div>

                {error && <p className="text-danger-500 text-sm text-center font-medium">{error}</p>}

                <Button 
                  fullWidth 
                  onClick={handleRedeem} 
                  size="lg" 
                  disabled={currentPoints < selectedReward.cost}
                  className={currentPoints >= selectedReward.cost ? "bg-reward-500 hover:bg-reward-600 shadow-reward-500/25" : ""}
                >
                  {currentPoints >= selectedReward.cost ? 'Confirm Redemption' : 'Not enough points'}
                </Button>
              </>
            ) : (
              <div className="py-10 flex flex-col items-center text-center animate-in zoom-in duration-300">
                <div className="w-20 h-20 bg-reward-100 rounded-full flex items-center justify-center mb-4 text-reward-500">
                  <CheckCircle2 size={48} />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2 tracking-tight">Reward Redeemed!</h3>
                <p className="text-gray-500 text-sm font-medium">
                  {selectedReward.cost} points have been deducted. Enjoy your reward!
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
