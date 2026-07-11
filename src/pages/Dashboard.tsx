
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Stat } from '../components/ui/Stat';
import { Progress } from '../components/ui/Progress';
import { Flame, Star,Target, Clock, MessageCircle } from 'lucide-react';
import { Avatar } from '../components/ui/Avatar';

export function Dashboard() {
  const activityFeed = [
    { id: 1, text: 'Mia completed "Empty Dishwasher"', time: '10m ago' },
    { id: 2, text: 'Leo leveled up to Junior Ranger!', time: '1h ago' },
    { id: 3, text: 'Mom approved "Clean Room" for Leo', time: '2h ago' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Good Morning, Leo! ☀️</h1>
        <p className="text-gray-500 mt-1">You're doing great this week.</p>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <Stat label="Total Points" value="1,250" icon={<Star className="fill-current" />} />
        <Stat label="Day Streak" value="5" icon={<Flame className="text-warning-500 fill-warning-500" />} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-primary-500 border-none text-white">
          <CardHeader className="border-none pb-2">
            <CardTitle className="text-white flex justify-between items-center opacity-90 text-sm font-medium uppercase tracking-wider">
              Level 12: Junior Ranger
              <span>60%</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={60} className="bg-primary-700 [&>div]:bg-white" />
            <p className="text-xs text-primary-200 mt-3 text-right font-medium">400 XP to Level 13</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-reward-400 to-reward-500 border-none text-white overflow-hidden relative">
          <CardContent className="p-6 flex items-center justify-between z-10 relative">
            <div>
              <p className="text-reward-100 font-medium text-sm mb-1">Weekly Champion</p>
              <h2 className="text-2xl font-extrabold tracking-tight">Mia is leading!</h2>
            </div>
            <Avatar src="https://i.pravatar.cc/150?u=3" fallback="M" size="lg" className="ring-4 ring-white/30" />
          </CardContent>
        </Card>
      </div>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Target size={20} className="text-success-500" />
          Family Challenge
        </h2>
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex justify-between items-end">
              <div>
                <h4 className="font-bold text-gray-900">Read 50 Books Together</h4>
                <p className="text-sm text-gray-500 mt-1">Ends in 5 days</p>
              </div>
              <div className="text-2xl font-extrabold text-success-500">32/50</div>
            </div>
            <Progress value={64} color="success" />
            <div className="flex -space-x-2 pt-2">
              <Avatar src="https://i.pravatar.cc/150?u=1" fallback="L" size="sm" className="ring-2 ring-white" />
              <Avatar src="https://i.pravatar.cc/150?u=2" fallback="M" size="sm" className="ring-2 ring-white" />
              <Avatar src="https://i.pravatar.cc/150?u=3" fallback="M" size="sm" className="ring-2 ring-white" />
            </div>
          </CardContent>
        </Card>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Clock size={20} className="text-primary-500" />
            Today's Tasks
          </h2>
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="bg-white p-4 rounded-2xl border border-gray-100 flex items-center justify-between shadow-sm hover:border-primary-200 transition-colors cursor-pointer active:scale-[0.98]">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center text-primary-600 font-bold text-sm">
                    +50
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900">Clean your room</h4>
                    <p className="text-xs text-gray-500 mt-0.5">Daily Task</p>
                  </div>
                </div>
                <div className="w-6 h-6 border-2 border-gray-200 rounded-full"></div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
            <MessageCircle size={20} className="text-gray-400" />
            Recent Activity
          </h2>
          <div className="bg-white rounded-2xl border border-gray-100 p-1">
            {activityFeed.map((item, idx) => (
              <div key={item.id} className={`p-4 flex items-start gap-3 ${idx !== activityFeed.length - 1 ? 'border-b border-gray-50' : ''}`}>
                <div className="w-2 h-2 rounded-full bg-primary-400 mt-2"></div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{item.text}</p>
                  <span className="text-xs text-gray-400 mt-1">{item.time}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
