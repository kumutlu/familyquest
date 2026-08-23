import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FamilyQuestSummary } from '../../lib/familyWorld/types';
import { Sparkles, CheckCircle2, Clock, Gift, Users } from 'lucide-react';
import { TactileButton } from '../queki/TactileButton';
import { playCue } from '../../lib/interaction/sound';
import { triggerHaptic } from '../../lib/interaction/haptics';

interface FamilyQuestCardProps {
  quest: FamilyQuestSummary | null;
  onClaim?: (questId: string) => Promise<void> | void;
  isClaiming?: boolean;
}

export const FamilyQuestCard: React.FC<FamilyQuestCardProps> = ({
  quest,
  onClaim,
  isClaiming = false,
}) => {
  const { t } = useTranslation('familyWorld');
  const [localClaiming, setLocalClaiming] = useState(false);

  if (!quest) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center bg-slate-50/50 dark:bg-slate-800/30">
        <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-500 mx-auto flex items-center justify-center mb-3">
          <Sparkles className="w-6 h-6" />
        </div>
        <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-1">
          {t('quest.noActive', { defaultValue: 'No active Family Quest right now.' })}
        </h4>
        <p className="text-xs text-slate-600 dark:text-slate-300 max-w-xs mx-auto">
          {t('quest.noActiveHint', { defaultValue: 'Start one to grow together.' })}
        </p>
      </div>
    );
  }

  const handleClaim = async () => {
    if (!onClaim || localClaiming || isClaiming) return;
    setLocalClaiming(true);
    triggerHaptic('success');
    playCue('questClaim');
    try {
      await onClaim(quest.id);
    } finally {
      setLocalClaiming(false);
    }
  };

  const isComplete = quest.isCompleted;
  const isClaimed = quest.isClaimed;
  const canClaim = quest.canClaim && !isClaimed;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-5 transition-all shadow-sm ${
        isComplete
          ? 'bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent border-amber-400/40 dark:border-amber-500/30 ring-1 ring-amber-400/20'
          : 'bg-white dark:bg-slate-800/90 border-slate-200 dark:border-slate-700'
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center ${
              isComplete
                ? 'bg-amber-500 text-white shadow-md'
                : 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
            }`}
          >
            {isComplete ? <CheckCircle2 className="w-5 h-5" /> : <Users className="w-5 h-5" />}
          </div>
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
              {t('quest.title', { defaultValue: 'Family Quest' })}
            </span>
            <h3 className="text-base font-black text-slate-900 dark:text-white leading-snug">
              {quest.title}
            </h3>
          </div>
        </div>

        {/* State Badge */}
        <div>
          {isClaimed ? (
            <span className="px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {t('quest.completed', { defaultValue: 'Completed' })}
            </span>
          ) : isComplete ? (
            <span className="px-2.5 py-0.5 rounded-full bg-amber-500 text-white text-xs font-bold shadow-sm animate-bounce">
              {t('quest.readyToClaim', { defaultValue: 'Ready to claim' })}
            </span>
          ) : quest.daysRemaining !== null ? (
            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 text-xs font-medium flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {t('quest.daysLeft', { count: quest.daysRemaining, defaultValue: `${quest.daysRemaining}d left` })}
            </span>
          ) : null}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="my-3">
        <div className="flex justify-between text-xs font-bold mb-1.5">
          <span className="text-slate-600 dark:text-slate-300">
            {quest.current} / {quest.target}
          </span>
          <span className="text-blue-600 dark:text-blue-400">{quest.percentage}%</span>
        </div>
        <div 
          className="h-3 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden p-0.5"
          role="progressbar"
          aria-valuenow={quest.percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={quest.title}
        >
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${
              isComplete
                ? 'bg-gradient-to-r from-amber-400 to-amber-500'
                : 'bg-gradient-to-r from-blue-500 to-indigo-500'
            }`}
            style={{ width: `${Math.min(100, Math.max(0, quest.percentage))}%` }}
          />
        </div>
      </div>

      {/* Contributions Breakdown (Gentle & Team-focused) */}
      {quest.contributions && quest.contributions.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center flex-wrap gap-2 text-xs">
          <span className="text-slate-600 dark:text-slate-300 font-medium">
            {t('quest.teamwork', { defaultValue: 'Teamwork' })}:
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {quest.contributions.map((c) => (
              <span
                key={c.memberId}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 text-[11px] font-medium"
              >
                <span>{c.displayName}</span>
                <span className="font-bold text-blue-600 dark:text-blue-400">+{c.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Reward / Claim Footer */}
      <div className="mt-4 flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-700/60">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
          <Gift className="w-4 h-4 text-amber-500" />
          <span>
            {quest.rewardXp > 0 && `${quest.rewardXp} XP `}
            {quest.points > 0 && `• ${quest.points} ${t('common:points', { defaultValue: 'pts' })}`}
          </span>
        </div>

        {canClaim && (
          <TactileButton
            onClick={handleClaim}
            disabled={localClaiming || isClaiming}
            variant="primary"
            size="sm"
            className="shadow-md bg-amber-500 hover:bg-amber-600 text-white font-bold"
          >
            {localClaiming || isClaiming ? t('quest.claiming', { defaultValue: 'Claiming…' }) : t('quest.claim', { defaultValue: 'Claim reward' })}
          </TactileButton>
        )}
      </div>
    </div>
  );
};
