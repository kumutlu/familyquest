import React from 'react';
import type { FamilyMoment } from '../../lib/familyWorld/types';
import { CheckCircle2, ArrowRightLeft, Award, Flame, Gift, Sparkles } from 'lucide-react';
import { Avatar } from '../ui/Avatar';

interface FamilyMomentCardProps {
  moment: FamilyMoment;
  onClick?: (moment: FamilyMoment) => void;
}

export const FamilyMomentCard: React.FC<FamilyMomentCardProps> = ({ moment, onClick }) => {
  const getIcon = () => {
    switch (moment.type) {
      case 'quest_approved':
        return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'money_transferred':
        return <ArrowRightLeft className="w-4 h-4 text-teal-500" />;
      case 'family_quest_completed':
        return <Sparkles className="w-4 h-4 text-amber-500" />;
      case 'streak_milestone':
        return <Flame className="w-4 h-4 text-orange-500" />;
      case 'reward_redeemed':
        return <Gift className="w-4 h-4 text-rose-500" />;
      case 'level_up':
      case 'achievement_unlocked':
      default:
        return <Award className="w-4 h-4 text-blue-500" />;
    }
  };

  const formattedTime = () => {
    if (!moment.timestamp) return '';
    try {
      const date = new Date(moment.timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const isClickable = !!onClick && !!moment.targetRoute;

  return (
    <div
      onClick={() => isClickable && onClick(moment)}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={(e) => {
        if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick(moment);
        }
      }}
      className={`flex items-start gap-3 p-3.5 rounded-2xl bg-white dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/80 shadow-sm transition-all ${
        isClickable
          ? 'cursor-pointer hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md active:scale-[0.99]'
          : ''
      }`}
    >
      {/* Primary Actor Avatar or Icon */}
      <div className="relative shrink-0">
        <Avatar
          src={moment.primaryActorAvatarUrl}
          fallback={moment.primaryActorName?.[0] || 'F'}
          size="md"
        />
        <div className="absolute -bottom-1 -right-1 p-0.5 rounded-full bg-white dark:bg-slate-800 shadow">
          {getIcon()}
        </div>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <h5 className="font-bold text-xs text-slate-900 dark:text-white truncate">
            {moment.title}
          </h5>
          {formattedTime() && (
            <span className="text-[10px] text-slate-600 dark:text-slate-300 shrink-0">
              {formattedTime()}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 line-clamp-2">
          {moment.description}
        </p>
      </div>
    </div>
  );
};
