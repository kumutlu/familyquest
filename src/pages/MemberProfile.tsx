
import { useParams, Link } from 'react-router-dom';
import { Avatar } from '../components/ui/Avatar';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import { Stat } from '../components/ui/Stat';
import { ChevronLeft, Flame, Star, Trophy, Target } from 'lucide-react';

export function MemberProfile() {
  const { id } = useParams();

  // Mock data based on ID
  const isLeo = id === '2';
  const name = isLeo ? 'Leo' : 'Mia';
  const role = 'Child';
  const points = isLeo ? 1250 : 980;
  const avatar = isLeo ? 'https://i.pravatar.cc/150?u=1' : 'https://i.pravatar.cc/150?u=3';
  const level = isLeo ? 12 : 10;
  const streak = isLeo ? 5 : 2;

  const achievements = [
    { id: 1, name: 'First Task', icon: '🌟', date: 'Oct 1' },
    { id: 2, name: '7-Day Streak', icon: '🔥', date: 'Oct 8' },
    { id: 3, name: 'Big Saver', icon: '🐷', date: 'Oct 12' },
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300 pb-8">
      <header className="flex items-center gap-4">
        <Link to="/family" className="p-2 -ml-2 text-gray-400 hover:text-gray-900 bg-gray-100 rounded-full transition-colors">
          <ChevronLeft size={24} />
        </Link>
        <h1 className="text-xl font-bold text-gray-900">Profile</h1>
      </header>

      <div className="flex flex-col items-center text-center mt-4">
        <Avatar src={avatar} fallback={name[0]} size="xl" className="ring-4 ring-primary-100 mb-4 shadow-sm" />
        <h2 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2">
          {name}
        </h2>
        <Badge variant="default" className="mt-2 text-[10px]">{role}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Stat label="Total Points" value={points} icon={<Star className="fill-current" />} />
        <Stat label="Current Streak" value={`${streak} Days`} icon={<Flame className="text-warning-500 fill-warning-500" />} />
      </div>

      <Card className="bg-primary-500 border-none text-white">
        <CardContent className="p-6">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <Trophy size={20} className="text-reward-400 fill-reward-400" />
              <span className="font-bold tracking-tight">Level {level}</span>
            </div>
            <span className="text-primary-100 font-medium text-sm">3,400 XP</span>
          </div>
          <Progress value={60} className="bg-primary-700 [&>div]:bg-white" />
          <p className="text-xs text-primary-200 mt-3 text-right font-medium">400 XP to Level {level + 1}</p>
        </CardContent>
      </Card>

      <section>
        <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Target size={20} className="text-success-500" />
          Achievements
        </h3>
        <div className="grid grid-cols-3 gap-3">
          {achievements.map(ach => (
            <Card key={ach.id} className="text-center hover:border-primary-200 transition-colors">
              <CardContent className="p-4 flex flex-col items-center justify-center h-full">
                <div className="text-3xl mb-2">{ach.icon}</div>
                <h4 className="font-semibold text-gray-900 text-xs leading-tight mb-1">{ach.name}</h4>
                <p className="text-[10px] text-gray-400 font-medium">{ach.date}</p>
              </CardContent>
            </Card>
          ))}
          
          {/* Locked Achievement Mock */}
          <Card className="text-center bg-gray-50 border-dashed border-2 border-gray-200">
            <CardContent className="p-4 flex flex-col items-center justify-center h-full opacity-50 text-gray-400">
              <div className="text-3xl mb-2">🔒</div>
              <h4 className="font-semibold text-xs leading-tight">Locked</h4>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
