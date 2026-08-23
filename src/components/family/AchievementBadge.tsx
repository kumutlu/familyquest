import React from 'react';
import type { AchievementSummary } from '../../lib/familyWorld/types';
import { Award, Flame, CheckCircle2, Sparkles, Gift } from 'lucide-react';

interface AchievementBadgeProps {
  achievement: AchievementSummary;
  size?: 'sm' | 'md' | 'lg';
}

export const AchievementBadge: React.FC<AchievementBadgeProps> = ({
  achievement,
  size = 'md',
}) => {
  const getBadgeIcon = () => {
    switch (achievement.category) {
      case 'streak':
        return <Flame className="w-4 h-4 text-orange-500" />;
      case 'quest':
        return <CheckCircle2 className="w-4 h-4 text-blue-500" />;
      case 'family':
        return <Sparkles className="w-4 h-4 text-amber-500" />;
      case 'reward':
        return <Gift className="w-4 h-4 text-rose-500" />;
      case 'level':
      default:
        return <Award className="w-4 h-4 text-amber-500" />;
    }
  };

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-xl border transition-all ${
        achievement.isUnlocked
          ? 'bg-amber-500/10 dark:bg-amber-500/15 border-amber-500/30 text-slate-800 dark:text-slate-100'
          : 'bg-slate-100 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 opacity-60 text-slate-600 dark:text-slate-300'
      } ${size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-xs'}`}
    >
      <div className="shrink-0">{getBadgeIcon()}</div>
      <div className="min-w-0">
        <span className="font-bold block truncate">{achievement.title}</span>
        {size !== 'sm' && achievement.description && (
          <span className="text-[10px] text-slate-600 dark:text-slate-300 block truncate">
            {achievement.description}
          </span>
        )}
      </div>
    </div>
  );
};
