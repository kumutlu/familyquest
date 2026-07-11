import { Link } from 'react-router-dom';
import { Avatar } from '../components/ui/Avatar';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Crown, ChevronRight, Trophy, History } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useState } from 'react';

export function Family() {
  const { familyMembers, loading, tasks, taskCompletions, behaviourEvents } = useStore();
  const [activeTab, setActiveTab] = useState<'current' | 'history'>('current');

  if (loading) return <div className="p-8 text-center text-gray-500 animate-pulse">Loading Family...</div>;

  // Calculate "Weekly XP" for each member (last 7 days)
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const membersWithWeeklyXP = familyMembers.map(member => {
    let weeklyXP = 0;
    
    // Add approved task points
    const memberTasks = taskCompletions.filter(c => 
      c.assigneeId === member.id && 
      c.status === 'approved' &&
      c.approvedAt &&
      c.approvedAt.toDate() > sevenDaysAgo
    );
    memberTasks.forEach(c => {
      const task = tasks.find(t => t.id === c.taskId);
      if (task) weeklyXP += (task.pointsReward || 0);
    });

    // Add behaviour event points
    const memberEvents = behaviourEvents.filter(e => 
      e.userId === member.id &&
      e.timestamp &&
      e.timestamp.toDate() > sevenDaysAgo
    );
    memberEvents.forEach(e => {
      weeklyXP += (e.pointsDelta || 0);
    });

    return { ...member, weeklyXP };
  });

  const sortedMembers = [...membersWithWeeklyXP].sort((a, b) => b.weeklyXP - a.weeklyXP);
  // Only declare someone a champion if they actually earned points
  const champion = sortedMembers.length > 0 && sortedMembers[0].weeklyXP > 0 ? sortedMembers[0] : null;

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

      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          {activeTab === 'current' ? <Trophy size={20} className="text-reward-500" /> : <History size={20} className="text-gray-400" />}
          Weekly Rankings
        </h3>
        <div className="flex bg-gray-100 p-1 rounded-lg">
          <button 
            onClick={() => setActiveTab('current')}
            className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${activeTab === 'current' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
          >
            This Week
          </button>
          <button 
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${activeTab === 'history' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
          >
            History
          </button>
        </div>
      </div>

      {activeTab === 'current' ? (
        <div className="space-y-4">
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
                        <p className="text-sm text-gray-500 font-medium mt-0.5">{member.weeklyXP.toLocaleString()} pts this week</p>
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
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500 shadow-sm mt-4">
          <Trophy size={48} className="mx-auto text-gray-300 mb-4" />
          <h4 className="text-lg font-bold text-gray-900 mb-1">No Past Champions</h4>
          <p className="text-sm">Check back next week to see who won this week's leaderboard!</p>
        </div>
      )}
    </div>
  );
}
