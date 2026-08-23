import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SharedProgressionSummary } from '../../lib/familyWorld/types';
import { Award, CheckCircle2, Flame, TrendingUp } from 'lucide-react';

interface SharedProgressionCardProps {
  progression: SharedProgressionSummary;
}

export const SharedProgressionCard: React.FC<SharedProgressionCardProps> = ({ progression }) => {
  const { t } = useTranslation('familyWorld');

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-black text-sm text-slate-900 dark:text-white">
              {progression.title || t('progress.title', { defaultValue: 'Family Progress' })}
            </h4>
            <span className="text-[11px] text-slate-600 dark:text-slate-300">
              {progression.subtitle || t('progress.calm', { defaultValue: 'Our collective achievements and momentum' })}
            </span>
          </div>
        </div>
      </div>

      {/* Grid Metrics */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60">
          <div className="flex items-center justify-center text-blue-600 dark:text-blue-400 mb-1">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <span className="block text-base font-black text-slate-900 dark:text-white">
            {progression.totalCompletedTasks}
          </span>
          <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300">
            {t('progression.questsDone', { defaultValue: 'Quests Done' })}
          </span>
        </div>

        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60">
          <div className="flex items-center justify-center text-amber-500 mb-1">
            <Award className="w-4 h-4" />
          </div>
          <span className="block text-base font-black text-slate-900 dark:text-white">
            {progression.completedChallengesCount}
          </span>
          <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300">
            {t('progression.challengesDone', { defaultValue: 'Completed Quests' })}
          </span>
        </div>

        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-700/60">
          <div className="flex items-center justify-center text-orange-500 mb-1">
            <Flame className="w-4 h-4" />
          </div>
          <span className="block text-base font-black text-slate-900 dark:text-white">
            {progression.activeStreaksCount}
          </span>
          <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300">
            {t('progression.activeStreaks', { defaultValue: 'Active Streaks' })}
          </span>
        </div>
      </div>
    </div>
  );
};
