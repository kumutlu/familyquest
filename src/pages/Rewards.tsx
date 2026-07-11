import React, { useState } from 'react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Star, Gift } from 'lucide-react';

export function Rewards() {
  const [activeCategory, setActiveCategory] = useState<'all' | 'screen-time' | 'privileges'>('all');
  const [selectedReward, setSelectedReward] = useState<any>(null);
  const [isRedeeming, setIsRedeeming] = useState(false);

  const categories = [
    { id: 'all', name: 'All' },
    { id: 'screen-time', name: 'Screen Time' },
    { id: 'privileges', name: 'Privileges' },
  ];

  const rewards = [
    { id: 1, title: '1 Hour of Video Games', category: 'screen-time', cost: 150, icon: '🎮' },
    { id: 2, title: 'Movie Night Pick', category: 'privileges', cost: 300, icon: '🍿' },
    { id: 3, title: 'Get out of one chore', category: 'privileges', cost: 500, icon: '🛡️' },
    { id: 4, title: 'Stay up 30m late', category: 'privileges', cost: 200, icon: '🌙' },
  ];

  const filteredRewards = activeCategory === 'all' ? rewards : rewards.filter(r => r.category === activeCategory);

  const handleRedeem = () => {
    setIsRedeeming(true);
    setTimeout(() => {
      setSelectedReward(null);
      setIsRedeeming(false);
    }, 1500);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-8">
      <header className="flex justify-between items-center bg-gradient-to-r from-primary-50 to-primary-100 p-6 rounded-3xl border border-primary-200/50 shadow-sm relative overflow-hidden">
        <div className="relative z-10">
          <p className="text-primary-700 font-medium text-sm mb-1 uppercase tracking-wider">Available Points</p>
          <h1 className="text-4xl font-extrabold text-primary-900 flex items-center gap-2">
            1,250 <Star className="text-reward-500 fill-reward-500" size={32} />
          </h1>
        </div>
        <Gift className="absolute -right-4 -bottom-4 text-primary-200/40 w-32 h-32" />
      </header>

      <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 hide-scrollbar">
        {categories.map((c) => (
          <Button 
            key={c.id} 
            variant={activeCategory === c.id ? 'primary' : 'secondary'} 
            size="sm"
            onClick={() => setActiveCategory(c.id as any)}
            className="rounded-full whitespace-nowrap px-5"
          >
            {c.name}
          </Button>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-bold text-gray-900 mb-4 px-1">Reward Store</h2>
        <div className="grid grid-cols-2 gap-4">
          {filteredRewards.map(reward => (
            <Card 
              key={reward.id} 
              className="text-center hover:border-primary-300 transition-all cursor-pointer active:scale-95 hover:shadow-md"
              onClick={() => setSelectedReward(reward)}
            >
              <CardContent className="p-6 flex flex-col items-center">
                <div className="text-5xl mb-4">{reward.icon}</div>
                <h4 className="font-semibold text-gray-900 text-sm mb-2 leading-tight h-10">{reward.title}</h4>
                <p className="font-extrabold text-reward-600 bg-reward-50 px-3 py-1 rounded-lg text-sm">{reward.cost} pts</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Modal isOpen={!!selectedReward} onClose={() => setSelectedReward(null)} title="Redeem Reward">
        {selectedReward && (
          <div className="space-y-6">
            {!isRedeeming ? (
              <>
                <div className="text-center pb-4">
                  <div className="text-6xl mb-4">{selectedReward.icon}</div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">{selectedReward.title}</h3>
                  <p className="text-gray-500 text-sm px-4">
                    Are you sure you want to spend <span className="font-bold text-reward-600">{selectedReward.cost} points</span> on this reward?
                  </p>
                </div>
                
                <Button fullWidth onClick={handleRedeem} size="lg" className="bg-reward-500 hover:bg-reward-600 text-white shadow-reward-500/25">
                  Confirm & Redeem
                </Button>
              </>
            ) : (
              <div className="py-8 flex flex-col items-center text-center animate-in zoom-in duration-300">
                <div className="w-20 h-20 bg-success-100 rounded-full flex items-center justify-center mb-4 text-success-500">
                  <Gift size={40} />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Reward Redeemed!</h3>
                <p className="text-gray-500 text-sm">
                  Enjoy your reward. Points have been deducted from your balance.
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
