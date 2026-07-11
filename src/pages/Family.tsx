
import { Link } from 'react-router-dom';
import { Avatar } from '../components/ui/Avatar';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Crown, ChevronRight } from 'lucide-react';

export function Family() {
  const members = [
    { id: '1', name: 'Mom', role: 'Parent', points: 3400, avatar: 'https://i.pravatar.cc/150?u=2', isChampion: false },
    { id: '2', name: 'Leo', role: 'Child', points: 1250, avatar: 'https://i.pravatar.cc/150?u=1', isChampion: true },
    { id: '3', name: 'Mia', role: 'Child', points: 980, avatar: 'https://i.pravatar.cc/150?u=3', isChampion: false },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Family Hub</h1>
        <p className="text-gray-500 mt-1">See how everyone is doing.</p>
      </header>

      <div className="bg-gradient-to-br from-reward-400 to-reward-500 p-6 rounded-3xl text-white shadow-lg relative overflow-hidden">
        <div className="relative z-10 flex items-center justify-between">
          <div>
            <p className="text-reward-100 font-medium text-sm mb-1 uppercase tracking-wider">Weekly Champion</p>
            <h2 className="text-3xl font-extrabold tracking-tight">Leo!</h2>
            <p className="mt-2 text-sm opacity-90 font-medium">Highest points this week</p>
          </div>
          <Crown size={64} className="text-white opacity-80" strokeWidth={1.5} />
        </div>
      </div>

      <div className="space-y-4 mt-8">
        <h3 className="text-lg font-bold text-gray-900 mb-2">Leaderboard</h3>
        {members.map((member, idx) => (
          <Link key={member.id} to={`/family/${member.id}`} className="block">
            <Card className={`hover:border-primary-300 transition-all active:scale-[0.98] ${member.isChampion ? 'border-reward-400 shadow-md ring-1 ring-reward-400' : ''}`}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="font-bold text-gray-400 w-4 text-center">{idx + 1}</div>
                  <Avatar src={member.avatar} fallback={member.name[0]} />
                  <div>
                    <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                      {member.name}
                      {member.role === 'Parent' && <Badge variant="default" className="text-[10px]">Admin</Badge>}
                    </h4>
                    <p className="text-sm text-gray-500 font-medium mt-0.5">{member.points.toLocaleString()} pts</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {member.isChampion && <Crown size={20} className="text-reward-500 fill-reward-500" />}
                  <ChevronRight size={20} className="text-gray-300" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
