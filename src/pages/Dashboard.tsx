import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Stat } from '../components/ui/Stat';
import { Progress } from '../components/ui/Progress';
import { Flame, Star, MessageCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { ParentDashboard } from '../components/parent/ParentDashboard';

export function Dashboard() {
  const { currentUser, feed, loading } = useStore();

  if (loading || !currentUser) return <div className="p-8 text-center text-gray-500 animate-pulse">Loading Dashboard...</div>;

  if (currentUser.role === 'parent') {
    return <ParentDashboard />;
  }

  const currentLevel = Math.floor((currentUser.lifetimeXP || 0) / 1000) + 1; // Simplified formula
  const xpInLevel = (currentUser.lifetimeXP || 0) % 1000;
  const levelProgress = (xpInLevel / 1000) * 100;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Good Morning, {currentUser.displayName}! ☀️</h1>
        <p className="text-gray-500 mt-1">You're doing great this week.</p>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <Stat label="Total Points" value={currentUser.rewardPoints || 0} icon={<Star className="fill-current" />} />
        <Stat label="Day Streak" value={currentUser.currentStreak || 0} icon={<Flame className="text-warning-500 fill-warning-500" />} />
      </div>

      <div className="grid grid-cols-1 gap-4">
        <Card className="bg-primary-500 border-none text-white">
          <CardHeader className="border-none pb-2">
            <CardTitle className="text-white flex justify-between items-center opacity-90 text-sm font-medium uppercase tracking-wider">
              Level {currentLevel}
              <span>{Math.round(levelProgress)}%</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={levelProgress} className="bg-primary-700 [&>div]:bg-white" />
            <p className="text-xs text-primary-200 mt-3 text-right font-medium">{1000 - xpInLevel} XP to Level {currentLevel + 1}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <MessageCircle size={20} className="text-gray-400" />
            Recent Activity
          </h2>
          {feed.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500">
              No recent activity.
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 p-1">
              {feed.slice(0, 5).map((item, idx) => {
                const date = item.timestamp?.toDate ? item.timestamp.toDate() : new Date();
                return (
                  <div key={item.id} className={`p-4 flex items-start gap-3 ${idx !== Math.min(feed.length, 5) - 1 ? 'border-b border-gray-50' : ''}`}>
                    <div className="w-2 h-2 rounded-full bg-primary-400 mt-2 shrink-0"></div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{item.text}</p>
                      <span className="text-xs text-gray-400 mt-1">{date.toLocaleString()}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
