import React from 'react';
import { useTranslation } from 'react-i18next';
import type { MemberSummary } from '../../lib/familyWorld/types';
import { Avatar } from '../ui/Avatar';
import { Sparkles, Trophy, Flame } from 'lucide-react';
import { QuekiMascot } from '../queki/QuekiMascot';

interface FamilyWorldSceneProps {
  familyName: string;
  members: MemberSummary[];
  activeChildren: MemberSummary[];
  isSingleChild: boolean;
  selectedMemberId?: string | null;
  onSelectMember: (member: MemberSummary) => void;
  hasActiveQuest?: boolean;
}

export const FamilyWorldScene: React.FC<FamilyWorldSceneProps> = ({
  familyName,
  members,
  activeChildren,
  isSingleChild,
  selectedMemberId,
  onSelectMember,
  hasActiveQuest = false,
}) => {
  const { t } = useTranslation('familyWorld');
  const parents = members.filter((m) => m.role === 'owner' || m.role === 'parent' || m.role === 'adult');

  return (
    <section 
      aria-label={t('title', { defaultValue: 'Our Family' })}
      className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-blue-500/15 via-blue-500/5 to-transparent p-6 border border-blue-500/20 shadow-sm"
    >
      {/* Atmosphere background elements */}
      <div className="absolute top-0 right-0 -mt-6 -mr-6 w-36 h-36 bg-blue-400/10 rounded-full blur-2xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 -mb-6 -ml-6 w-32 h-32 bg-amber-400/10 rounded-full blur-2xl pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
            {t('scene.ourFamily', { defaultValue: 'Our Family' })}
          </span>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            {familyName}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {hasActiveQuest && (
            <div 
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-300 text-xs font-bold animate-pulse"
              role="status"
              aria-label={t('quest.inProgress', { defaultValue: 'Active Quest' })}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t('quest.inProgress', { defaultValue: 'Active Quest' })}</span>
            </div>
          )}
        </div>
      </div>

      {/* Scene Layout */}
      {isSingleChild && activeChildren.length === 1 ? (
        /* Single Child Layout: warm, focused, celebratory */
        <div className="flex flex-col items-center justify-center py-4 text-center">
          <div className="relative mb-4">
            <button
              onClick={() => onSelectMember(activeChildren[0])}
              className={`group relative p-2 rounded-3xl transition-transform active:scale-95 focus:outline-none focus:ring-4 focus:ring-blue-500/30 ${
                selectedMemberId === activeChildren[0].id ? 'ring-4 ring-blue-500' : ''
              }`}
              aria-label={`View ${activeChildren[0].displayName}`}
            >
              <div className="relative">
                <Avatar
                  src={activeChildren[0].avatarUrl}
                  fallback={activeChildren[0].displayName[0] || 'C'}
                  size="xl"
                  className="ring-4 ring-white dark:ring-slate-800 shadow-xl"
                />
                <div className="absolute -bottom-2 -right-1 bg-amber-500 text-white text-xs font-black px-2 py-0.5 rounded-full shadow-md flex items-center gap-1">
                  <span>Lv.{activeChildren[0].level}</span>
                </div>
              </div>
            </button>
          </div>

          <h3 className="text-xl font-bold text-slate-900 dark:text-white">
            {activeChildren[0].displayName}
          </h3>

          <div className="flex items-center gap-3 mt-2 text-xs font-medium text-slate-600 dark:text-slate-300">
            <div className="flex items-center gap-1 bg-amber-500/10 dark:bg-amber-500/20 px-2.5 py-1 rounded-lg text-amber-700 dark:text-amber-300">
              <Trophy className="w-3.5 h-3.5" />
              <span>{activeChildren[0].xp} XP</span>
            </div>
            {activeChildren[0].streakDays > 0 && (
              <div className="flex items-center gap-1 bg-orange-500/10 dark:bg-orange-500/20 px-2.5 py-1 rounded-lg text-orange-700 dark:text-orange-300">
                <Flame className="w-3.5 h-3.5" />
                <span>{activeChildren[0].streakDays}d Streak</span>
              </div>
            )}
          </div>

          {/* Parents presence bar */}
          {parents.length > 0 && (
            <div className="flex items-center justify-center gap-2 mt-6 pt-4 border-t border-slate-200/50 dark:border-slate-800/50 w-full">
              <span className="text-xs text-slate-600 dark:text-slate-300 font-medium mr-1">
                {t('manage', { defaultValue: 'Parents' })}:
              </span>
              <div className="flex -space-x-2">
                {parents.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onSelectMember(p)}
                    className="relative focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full transition-transform hover:scale-110 active:scale-95"
                    aria-label={`View ${p.displayName}`}
                  >
                    <Avatar
                      src={p.avatarUrl}
                      fallback={p.displayName[0] || 'P'}
                      size="sm"
                      className="ring-2 ring-white dark:ring-slate-900 shadow"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Multi-Child Layout: natural spacing, adaptive row */
        <div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 py-2">
            {activeChildren.map((child) => {
              const isSelected = selectedMemberId === child.id;
              return (
                <button
                  key={child.id}
                  onClick={() => onSelectMember(child)}
                  className={`flex flex-col items-center p-3.5 rounded-2xl bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm border transition-all text-center focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-blue-400 hover:shadow-md active:scale-95 ${
                    isSelected
                      ? 'border-blue-500 ring-2 ring-blue-500/30 bg-blue-50/50 dark:bg-blue-900/20'
                      : 'border-slate-200/80 dark:border-slate-700/80'
                  }`}
                  aria-label={`View ${child.displayName}`}
                >
                  <div className="relative mb-2">
                    <Avatar
                      src={child.avatarUrl}
                      fallback={child.displayName[0] || 'C'}
                      size="lg"
                      className="ring-2 ring-white dark:ring-slate-700 shadow-md"
                    />
                    <div className="absolute -bottom-1 -right-1 bg-amber-500 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full shadow">
                      Lv.{child.level}
                    </div>
                  </div>
                  <span className="font-bold text-sm text-slate-900 dark:text-white truncate max-w-[100px]">
                    {child.displayName}
                  </span>
                  <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                    <span>{child.xp} XP</span>
                    {child.streakDays > 0 && (
                      <span className="flex items-center text-orange-600 dark:text-orange-400">
                        <Flame className="w-3 h-3 inline" />
                        {child.streakDays}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Parents presence bar */}
          {parents.length > 0 && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-200/50 dark:border-slate-800/50">
              <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                {t('manage', { defaultValue: 'Parents' })}
              </span>
              <div className="flex items-center gap-2">
                {parents.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onSelectMember(p)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/40 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/60 hover:bg-white/80 dark:hover:bg-slate-800/80 transition-all text-xs font-medium text-slate-700 dark:text-slate-300"
                    aria-label={`View ${p.displayName}`}
                  >
                    <Avatar
                      src={p.avatarUrl}
                      fallback={p.displayName[0] || 'P'}
                      size="sm"
                      className="w-5 h-5"
                    />
                    <span>{p.displayName}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mascot decoration */}
      <div className="absolute right-3 bottom-3 opacity-20 pointer-events-none hidden sm:block">
        <QuekiMascot state="happy" size={48} />
      </div>
    </section>
  );
};
