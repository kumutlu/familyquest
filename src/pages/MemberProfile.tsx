import { useParams, Link } from 'react-router-dom';
import { Avatar } from '../components/ui/Avatar';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import { Stat } from '../components/ui/Stat';
import { ChevronLeft, Flame, Star, Trophy } from 'lucide-react';
import { useStore } from '../store/useStore';

export function MemberProfile() {
  const { id } = useParams();
  const { familyMembers, loading } = useStore();

  if (loading) return <div className="p-8 text-center text-gray-500 animate-pulse">Loading Profile...</div>;

  const member = familyMembers.find(m => m.id === id);
  if (!member) return <div className="p-8 text-center text-gray-500">Member not found.</div>;

  const currentLevel = Math.floor((member.lifetimeXP || 0) / 1000) + 1;
  const xpInLevel = (member.lifetimeXP || 0) % 1000;
  const levelProgress = (xpInLevel / 1000) * 100;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300 pb-8">
      <header className="flex items-center gap-4">
        <Link to="/family" className="p-2 -ml-2 text-gray-400 hover:text-gray-900 bg-gray-100 rounded-full transition-colors">
          <ChevronLeft size={24} />
        </Link>
        <h1 className="text-xl font-bold text-gray-900">Profile</h1>
      </header>

      <div className="flex flex-col items-center text-center mt-4">
        <Avatar src={member.avatarUrl} fallback={member.displayName[0]} size="xl" className="ring-4 ring-primary-100 mb-4 shadow-sm" />
        <h2 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2">
          {member.displayName}
        </h2>
        <Badge variant="default" className="mt-2 text-[10px] capitalize">{member.role}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Stat label="Total Points" value={member.rewardPoints || 0} icon={<Star className="fill-current" />} />
        <Stat label="Current Streak" value={`${member.currentStreak || 0} Days`} icon={<Flame className="text-warning-500 fill-warning-500" />} />
      </div>

      <Card className="bg-primary-500 border-none text-white">
        <CardContent className="p-6">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <Trophy size={20} className="text-reward-400 fill-reward-400" />
              <span className="font-bold tracking-tight">Level {currentLevel}</span>
            </div>
            <span className="text-primary-100 font-medium text-sm">{member.lifetimeXP || 0} XP</span>
          </div>
          <Progress value={levelProgress} className="bg-primary-700 [&>div]:bg-white" />
          <p className="text-xs text-primary-200 mt-3 text-right font-medium">{1000 - xpInLevel} XP to Level {currentLevel + 1}</p>
        </CardContent>
      </Card>
    </div>
  );
}
