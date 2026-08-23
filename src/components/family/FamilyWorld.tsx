import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { FamilyWorldViewModel, MemberSummary, FamilyMoment } from '../../lib/familyWorld/types';
import { FamilyWorldScene } from './FamilyWorldScene';
import { FamilyQuestCard } from './FamilyQuestCard';
import { SharedProgressionCard } from './SharedProgressionCard';
import { FamilyMomentCard } from './FamilyMomentCard';
import { MemberDetailSheet } from './MemberDetailSheet';
import { FamilyWorldCelebration } from './FamilyWorldCelebration';
import { AchievementBadge } from './AchievementBadge';
import { Settings, Award, History, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface FamilyWorldProps {
  viewModel: FamilyWorldViewModel;
  onClaimQuest?: (questId: string) => Promise<void> | void;
  isClaimingQuest?: boolean;
  onManageFamily?: () => void;
  onSendMoney?: (member: MemberSummary) => void;
}

export const FamilyWorld: React.FC<FamilyWorldProps> = ({
  viewModel,
  onClaimQuest,
  isClaimingQuest,
  onManageFamily,
  onSendMoney,
}) => {
  const { t } = useTranslation('familyWorld');
  const navigate = useNavigate();

  const [selectedMember, setSelectedMember] = useState<MemberSummary | null>(null);
  const [celebrationState, setCelebrationState] = useState<{
    isOpen: boolean;
    type: 'quest_complete' | 'achievement_unlocked';
    title: string;
    subtitle?: string;
  }>({
    isOpen: false,
    type: 'quest_complete',
    title: '',
  });

  // Track if quest complete celebration has been shown in this session
  useEffect(() => {
    if (viewModel.activeFamilyQuest?.isCompleted && !viewModel.activeFamilyQuest.isClaimed) {
      const key = `queki_celebrated_quest_${viewModel.activeFamilyQuest.id}`;
      if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, 'true');
        setCelebrationState({
          isOpen: true,
          type: 'quest_complete',
          title: t('celebration.questComplete', { defaultValue: 'Family Quest complete!' }),
          subtitle: viewModel.activeFamilyQuest.title,
        });
      }
    }
  }, [viewModel.activeFamilyQuest?.id, viewModel.activeFamilyQuest?.isCompleted, viewModel.activeFamilyQuest?.isClaimed, t]);

  const handleMomentClick = (moment: FamilyMoment) => {
    if (moment.targetRoute) {
      navigate(moment.targetRoute);
    }
  };

  const isParentViewer =
    viewModel.viewerRole === 'owner' ||
    viewModel.viewerRole === 'parent' ||
    viewModel.viewerRole === 'adult';

  return (
    <div className="space-y-6 pb-12">
      {/* 1. Family World Living Scene */}
      <FamilyWorldScene
        familyName={viewModel.familyIdentity.name}
        members={viewModel.members}
        activeChildren={viewModel.activeChildren}
        isSingleChild={viewModel.isSingleChild}
        selectedMemberId={selectedMember?.id}
        onSelectMember={(m) => setSelectedMember(m)}
        hasActiveQuest={!!viewModel.activeFamilyQuest}
      />

      {/* 2. Active / Completed Family Quest */}
      <section aria-label={t('quest.title', { defaultValue: 'Family Quest' })}>
        <FamilyQuestCard
          quest={viewModel.activeFamilyQuest}
          onClaim={onClaimQuest}
          isClaiming={isClaimingQuest}
        />
      </section>

      {/* 3. Shared Progression Card */}
      <section aria-label={t('progress.title', { defaultValue: 'Family Progress' })}>
        <SharedProgressionCard progression={viewModel.sharedProgression} />
      </section>

      {/* 4. Family Moments (1-3 sparse, curated, meaningful) */}
      {viewModel.recentMoments.length > 0 && (
        <section aria-label={t('moments.title', { defaultValue: 'Family Moments' })} className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-blue-500" />
              {t('moments.title', { defaultValue: 'Family Moments' })}
            </h4>
          </div>

          <div className="space-y-2">
            {viewModel.recentMoments.map((moment) => (
              <FamilyMomentCard
                key={moment.id}
                moment={moment}
                onClick={handleMomentClick}
              />
            ))}
          </div>
        </section>
      )}

      {/* 5. Shared Family Achievements */}
      {viewModel.sharedAchievements.length > 0 && (
        <section aria-label={t('achievements.title', { defaultValue: 'Family Achievements' })} className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5 text-amber-500" />
              {t('achievements.title', { defaultValue: 'Family Achievements' })}
            </h4>
          </div>

          <div className="flex flex-wrap gap-2">
            {viewModel.sharedAchievements.map((ach) => (
              <AchievementBadge key={ach.id} achievement={ach} />
            ))}
          </div>
        </section>
      )}

      {/* 6. Parent Management Gateway (Preserved lifecycle behind deliberate action) */}
      {isParentViewer && (
        <div className="pt-2">
          <button
            onClick={() => {
              if (onManageFamily) {
                onManageFamily();
              } else {
                navigate('/settings/family');
              }
            }}
            className="w-full flex items-center justify-between p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80 text-left hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center">
                <Settings className="w-4 h-4" />
              </div>
              <div>
                <h5 className="text-sm font-bold text-slate-900 dark:text-white">
                  {t('manage', { defaultValue: 'Manage family' })}
                </h5>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {t('subtitle', { defaultValue: 'A shared space for your family.' })}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-600 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      )}

      {/* 7. Member Detail Bottom Sheet */}
      <MemberDetailSheet
        member={selectedMember}
        isOpen={!!selectedMember}
        onClose={() => setSelectedMember(null)}
        onSendMoney={onSendMoney}
      />

      {/* 8. Shared Celebration Modal */}
      <FamilyWorldCelebration
        type={celebrationState.type}
        title={celebrationState.title}
        subtitle={celebrationState.subtitle}
        isOpen={celebrationState.isOpen}
        onDismiss={() => setCelebrationState((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};
