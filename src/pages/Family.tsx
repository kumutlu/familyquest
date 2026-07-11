import { Link } from 'react-router-dom';
import { Avatar } from '../components/ui/Avatar';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Crown, ChevronRight } from 'lucide-react';
import { useStore } from '../store/useStore';

export function Family() {
  const { familyMembers, loading } = useStore();

  if (loading) return <div className="p-8 text-center text-gray-500 animate-pulse">Loading Family...</div>;

  // Dynamically calculate the champion based on highest points (simplified for MVP)
  const sortedMembers = [...familyMembers].sort((a, b) => (b.rewardPoints || 0) - (a.rewardPoints || 0));
  const champion = sortedMembers.length > 0 ? sortedMembers[0] : null;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Family Hub</h1>
        <p className="text-gray-500 mt-1">See how everyone is doing.</p>
      </header>

      {champion && (
        <div className="bg-gradient-to-br from-reward-400 to-reward-500 p-6 rounded-3xl text-white shadow-lg relative overflow-hidden">
          <div className="relative z-10 flex items-center justify-between">
            <div>
              <p className="text-reward-100 font-medium text-sm mb-1 uppercase tracking-wider">Top Earner</p>
              <h2 className="text-3xl font-extrabold tracking-tight">{champion.displayName}!</h2>
              <p className="mt-2 text-sm opacity-90 font-medium">Leading the pack</p>
            </div>
            <Crown size={64} className="text-white opacity-80" strokeWidth={1.5} />
          </div>
        </div>
      )}

      <div className="space-y-4 mt-8">
        <h3 className="text-lg font-bold text-gray-900 mb-2">Leaderboard</h3>
        {sortedMembers.map((member, idx) => {
          const isChampion = champion && champion.id === member.id;
          
          return (
            <Link key={member.id} to={`/family/${member.id}`} className="block">
              <Card className={`hover:border-primary-300 transition-all active:scale-[0.98] ${isChampion ? 'border-reward-400 shadow-md ring-1 ring-reward-400' : ''}`}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="font-bold text-gray-400 w-4 text-center">{idx + 1}</div>
                    <Avatar src={member.avatarUrl} fallback={member.displayName[0]} />
                    <div>
                      <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                        {member.displayName}
                        {member.role === 'parent' && <Badge variant="default" className="text-[10px]">Admin</Badge>}
                      </h4>
                      <p className="text-sm text-gray-500 font-medium mt-0.5">{(member.rewardPoints || 0).toLocaleString()} pts</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {isChampion && <Crown size={20} className="text-reward-500 fill-reward-500" />}
                    <ChevronRight size={20} className="text-gray-300" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
