import React from 'react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Star } from 'lucide-react';

export function Rewards() {
  const rewards = [
    { id: 1, title: '1 Hour of Video Games', cost: 150, icon: '🎮' },
    { id: 2, title: 'Movie Night Pick', cost: 300, icon: '🍿' },
    { id: 3, title: 'Get out of one chore', cost: 500, icon: '🛡️' },
  ];

  return (
    <div className="space-y-6">
      <header className="flex justify-between items-center bg-primary-50 p-4 rounded-3xl border border-primary-100">
        <div>
          <p className="text-primary-700 font-medium">Available Points</p>
          <h1 className="text-3xl font-extrabold text-primary-900 flex items-center gap-2">
            1,250 <Star className="text-reward-500 fill-reward-500" size={28} />
          </h1>
        </div>
      </header>

      <div>
        <h2 className="text-lg font-bold text-gray-900 mb-4">Reward Store</h2>
        <div className="grid grid-cols-2 gap-4">
          {rewards.map(reward => (
            <Card key={reward.id} className="text-center hover:border-primary-300 transition-colors cursor-pointer">
              <CardContent className="p-6 flex flex-col items-center">
                <div className="text-4xl mb-3">{reward.icon}</div>
                <h4 className="font-semibold text-gray-900 mb-1">{reward.title}</h4>
                <p className="font-bold text-reward-600 mb-4">{reward.cost} pts</p>
                <Button variant="outline" size="sm" fullWidth>Redeem</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
