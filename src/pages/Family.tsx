import React from 'react';
import { Avatar } from '../components/ui/Avatar';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Crown } from 'lucide-react';

export function Family() {
  const members = [
    { name: 'Mom', role: 'Parent', points: 3400, avatar: 'https://i.pravatar.cc/150?u=2', isChampion: false },
    { name: 'Leo', role: 'Child', points: 1250, avatar: 'https://i.pravatar.cc/150?u=1', isChampion: true },
    { name: 'Mia', role: 'Child', points: 980, avatar: 'https://i.pravatar.cc/150?u=3', isChampion: false },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Family Hub</h1>
        <p className="text-gray-500">See how everyone is doing.</p>
      </header>

      <div className="bg-gradient-to-br from-reward-400 to-reward-500 p-6 rounded-3xl text-white shadow-lg relative overflow-hidden">
        <div className="relative z-10 flex items-center justify-between">
          <div>
            <p className="text-reward-100 font-medium mb-1">Weekly Champion</p>
            <h2 className="text-3xl font-extrabold">Leo!</h2>
            <p className="mt-2 text-sm opacity-90">Highest points this week</p>
          </div>
          <Crown size={64} className="text-white opacity-80" strokeWidth={1.5} />
        </div>
      </div>

      <div className="space-y-4 mt-6">
        <h3 className="font-bold text-gray-900">Leaderboard</h3>
        {members.map((member, idx) => (
          <Card key={idx} className={member.isChampion ? 'border-reward-400 shadow-md ring-1 ring-reward-400' : ''}>
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="font-bold text-gray-400 w-4">{idx + 1}</div>
                <Avatar src={member.avatar} fallback={member.name[0]} />
                <div>
                  <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                    {member.name}
                    {member.role === 'Parent' && <Badge variant="default">Admin</Badge>}
                  </h4>
                  <p className="text-sm text-gray-500">{member.points} pts</p>
                </div>
              </div>
              {member.isChampion && <Crown size={20} className="text-reward-500" />}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
