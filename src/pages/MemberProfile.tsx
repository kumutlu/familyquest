import { useParams, Link } from 'react-router-dom';
import { Card, CardContent } from '../components/ui/Card';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Progress } from '../components/ui/Progress';
import { ChevronLeft, Star, Flame, Trophy, TrendingUp, TrendingDown, Shield, Award, Zap } from 'lucide-react';
import { useStore } from '../store/useStore';
import { ACHIEVEMENTS } from '../lib/achievements';
import { cn } from '../lib/utils';

export function MemberProfile() {
  const { id } = useParams();
  const { familyMembers, loading, behaviourEvents } = useStore();

  if (loading) return <div className="p-8 text-center text-gray-500 animate-pulse">Loading Profile...</div>;

  const member = familyMembers.find(m => m.id === id);
  if (!member) return <div className="p-8 text-center text-gray-500">Member not found.</div>;

  const currentLevel = Math.floor((member.lifetimeXP || 0) / 1000) + 1;
  const xpInLevel = (member.lifetimeXP || 0) % 1000;
  const levelProgress = (xpInLevel / 1000) * 100;
  
  const userEvents = behaviourEvents.filter(e => e.userId === id).slice(0, 10);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300 pb-8">
      <header className="flex items-center gap-4">
        <Link to="/family" className="p-2 -ml-2 text-gray-400 hover:text-gray-900 bg-gray-100 rounded-full transition-colors">
          <ChevronLeft size={24} />
        </Link>
        <h1 className="text-xl font-bold text-gray-900">Profile</h1>
      </header>

      <div className="flex flex-col items-center text-center space-y-4 py-4">
        <div className="relative">
          <Avatar src={member.avatarUrl} fallback={member.displayName[0]} size="xl" className="w-24 h-24 ring-4 ring-white shadow-xl" />
          <div className="absolute -bottom-2 -right-2 bg-primary-500 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold border-2 border-white shadow-sm">
            {currentLevel}
          </div>
        </div>
        
        <div>
          <h2 className="text-2xl font-extrabold text-gray-900">{member.displayName}</h2>
          <p className="text-primary-600 font-bold">{member.rewardPoints || 0} Reward Points</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="flex justify-between items-end mb-2">
            <div>
              <p className="text-sm font-bold text-gray-500 uppercase tracking-wider">Level {currentLevel}</p>
              <p className="font-bold text-gray-900 mt-1">{member.lifetimeXP || 0} Total XP</p>
            </div>
            <p className="text-sm font-medium text-gray-400">{1000 - xpInLevel} to next level</p>
          </div>
          <Progress value={levelProgress} className="h-2" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <div className="w-10 h-10 bg-warning-50 rounded-full flex items-center justify-center mb-2">
              <Flame size={20} className="text-warning-500" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{member.currentStreak || 0}</p>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mt-1">Day Streak</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <div className="w-10 h-10 bg-primary-50 rounded-full flex items-center justify-center mb-2">
              <Trophy size={20} className="text-primary-500" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{member.longestStreak || 0}</p>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mt-1">Best Streak</p>
          </CardContent>
        </Card>
      </div>

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-4">Behaviour History</h2>
        {userEvents.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500">
            No logged events.
          </div>
        ) : (
          <div className="space-y-3">
            {userEvents.map(event => (
              <Card key={event.id}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-gray-900">{event.title}</h4>
                    <p className="text-xs text-gray-500 mt-1">
                      {event.timestamp?.toDate ? event.timestamp.toDate().toLocaleString() : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {event.pointsDelta >= 0 ? (
                      <Badge variant="default" className="flex items-center gap-1 bg-green-100 text-green-700 hover:bg-green-100">
                        <TrendingUp size={12} /> +{event.pointsDelta}
                      </Badge>
                    ) : (
                      <Badge variant="default" className="flex items-center gap-1 bg-red-100 text-red-700 hover:bg-red-100">
                        <TrendingDown size={12} /> {event.pointsDelta}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Trophy size={20} className="text-reward-500" />
          Achievement Gallery
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {ACHIEVEMENTS.map(badge => {
            const isUnlocked = badge.checkUnlocked(member);
            
            // Map icon string to component
            const IconComp = 
              badge.iconName === 'Star' ? Star :
              badge.iconName === 'Flame' ? Flame :
              badge.iconName === 'Shield' ? Shield :
              badge.iconName === 'Award' ? Award :
              badge.iconName === 'Zap' ? Zap : Trophy;

            return (
              <Card key={badge.id} className={cn("transition-all", isUnlocked ? "border-primary-200 bg-white" : "opacity-60 grayscale bg-gray-50 border-dashed")}>
                <CardContent className="p-4 flex flex-col items-center text-center">
                  <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center mb-3 border-2", isUnlocked ? badge.color : "bg-gray-100 text-gray-400 border-gray-200")}>
                    <IconComp size={24} />
                  </div>
                  <h4 className="font-bold text-gray-900 text-sm">{badge.name}</h4>
                  <p className="text-xs text-gray-500 mt-1">{badge.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
