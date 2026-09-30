import React from 'react';
import { useTranslation } from 'react-i18next';
import type { MemberSummary } from '../../lib/familyWorld/types';
import { BottomSheet } from '../queki/BottomSheet';
import { Avatar } from '../ui/Avatar';
import { TactileButton } from '../queki/TactileButton';
import { Trophy, Flame, Wallet, ArrowRightLeft, CheckSquare, Settings, Award, Star } from 'lucide-react';
import { AchievementBadge } from './AchievementBadge';
import { useNavigate } from 'react-router-dom';
import { MoneyValue } from '../privacy/MoneyValue';

interface MemberDetailSheetProps {
  member: MemberSummary | null;
  isOpen: boolean;
  onClose: () => void;
  onSendMoney?: (member: MemberSummary) => void;
  onManageMember?: (member: MemberSummary) => void;
}

export const MemberDetailSheet: React.FC<MemberDetailSheetProps> = ({
  member,
  isOpen,
  onClose,
  onSendMoney,
  onManageMember,
}) => {
  const { t } = useTranslation(['familyWorld', 'common']);
  const navigate = useNavigate();

  if (!member) return null;

  return (
    <BottomSheet open={isOpen} onClose={onClose} aria-label={member.displayName} title={member.displayName}>
      <div className="space-y-6 pt-2 pb-6">
        {/* Profile Card Header */}
        <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80">
          <div className="relative">
            <Avatar
              src={member.avatarUrl}
              fallback={member.displayName[0] || 'M'}
              size="lg"
              className="ring-2 ring-white dark:ring-slate-700 shadow"
            />
            <div className="absolute -bottom-1 -right-1 bg-amber-500 text-white text-[11px] font-black px-1.5 py-0.2 rounded-full shadow">
              Lv.{member.level}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-black text-lg text-slate-900 dark:text-white truncate">
                {member.displayName}
              </h3>
              <span className="px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[10px] font-bold uppercase tracking-wide">
                {t(`common:roles.${member.role}`, { defaultValue: member.role })}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
              {member.isSelf ? t('member.you', { defaultValue: 'You' }) : ''}
            </p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {/* XP & Level */}
          <div className="p-3 rounded-xl bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/20 text-center">
            <div className="flex items-center justify-center text-amber-600 dark:text-amber-400 mb-1">
              <Trophy className="w-4 h-4 mr-1" />
              <span className="text-xs font-bold">{t('member.level', { level: member.level, defaultValue: `Level ${member.level}` })}</span>
            </div>
            <span className="block text-lg font-black text-slate-900 dark:text-white">
              {member.xp}
            </span>
            <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300">
              {t('common:xp', { defaultValue: 'Total XP' })}
            </span>
          </div>

          {/* Streak */}
          <div className="p-3 rounded-xl bg-orange-500/10 dark:bg-orange-500/15 border border-orange-500/20 text-center">
            <div className="flex items-center justify-center text-orange-600 dark:text-orange-400 mb-1">
              <Flame className="w-4 h-4 mr-1" />
              <span className="text-xs font-bold">{t('common:streak', { defaultValue: 'Streak' })}</span>
            </div>
            <span className="block text-lg font-black text-slate-900 dark:text-white">
              {member.streakDays}
            </span>
            <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300">
              {member.streakDays}d
            </span>
          </div>

          {/* Wallet Balance (Role-safe) */}
          {member.canViewWallet && member.walletBalanceFormatted && (
            <div className="p-3 rounded-xl bg-teal-500/10 dark:bg-teal-500/15 border border-teal-500/20 text-center col-span-2 sm:col-span-1">
              <div className="flex items-center justify-center text-teal-600 dark:text-teal-400 mb-1">
                <Wallet className="w-4 h-4 mr-1" />
                <span className="text-xs font-bold">{t('common:wallet', { defaultValue: 'Wallet' })}</span>
              </div>
              <span className="block text-lg font-black text-slate-900 dark:text-white">
                <MoneyValue>{member.walletBalanceFormatted}</MoneyValue>
              </span>
              <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300">
                {t('common:balance', { defaultValue: 'Balance' })}
              </span>
            </div>
          )}

          {/* Points Balance (separate from Wallet) */}
          {member.canViewWallet && member.points > 0 && (
            <div className="p-3 rounded-xl bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/20 text-center col-span-2 sm:col-span-1">
              <div className="flex items-center justify-center text-amber-600 dark:text-amber-400 mb-1">
                <Star className="w-4 h-4 mr-1" />
                <span className="text-xs font-bold">{t('common:points', { defaultValue: 'Points' })}</span>
              </div>
              <span className="block text-lg font-black text-slate-900 dark:text-white">
                {member.points.toLocaleString()}
              </span>
              <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300">
                {t('common:pts', { defaultValue: 'pts' })}
              </span>
            </div>
          )}
        </div>

        {/* Recent Achievements */}
        {member.recentAchievements && member.recentAchievements.length > 0 && (
          <div>
            <h4 className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5 text-amber-500" />
              {t('achievements.title', { defaultValue: 'Achievements' })}
            </h4>
            <div className="flex flex-wrap gap-2">
              {member.recentAchievements.map((ach) => (
                <AchievementBadge key={ach.id} achievement={ach} size="sm" />
              ))}
            </div>
          </div>
        )}

        {/* Quick Action Buttons */}
        <div className="space-y-2 pt-2">
          {member.canSendMoney && (
            <TactileButton
              onClick={() => {
                onClose();
                if (onSendMoney) {
                  onSendMoney(member);
                } else {
                  navigate(`/wallet?action=send&recipient=${member.id}`);
                }
              }}
              variant="primary"
              size="md"
              fullWidth
              className="flex items-center justify-center gap-2 font-bold"
            >
              <ArrowRightLeft className="w-4 h-4" />
              {t('detail.sendMoney', { defaultValue: 'Send Money' })}
            </TactileButton>
          )}

          {/* Parent managing child's wallet - Add/Withdraw money */}
          {member.canManage && member.role === 'child' && (
            <TactileButton
              onClick={() => {
                onClose();
                navigate(`/wallet?recipient=${member.id}`);
              }}
              variant="secondary"
              size="md"
              fullWidth
              className="flex items-center justify-center gap-2 font-semibold"
            >
              <Wallet className="w-4 h-4" />
              {t('detail.manageWallet', { defaultValue: 'Manage Wallet' })}
            </TactileButton>
          )}

          {member.canViewQuests && (
            <TactileButton
              onClick={() => {
                onClose();
                navigate(`/tasks?member=${member.id}`);
              }}
              variant="secondary"
              size="md"
              fullWidth
              className="flex items-center justify-center gap-2 font-semibold"
            >
              <CheckSquare className="w-4 h-4" />
              {t('detail.viewQuests', { defaultValue: 'View Quests' })}
            </TactileButton>
          )}

          {member.canManage && (
            <TactileButton
              onClick={() => {
                onClose();
                if (onManageMember) {
                  onManageMember(member);
                } else {
                  navigate('/family');
                }
              }}
              variant="secondary"
              size="md"
              fullWidth
              className="flex items-center justify-center gap-2 text-slate-600 dark:text-slate-300"
            >
              <Settings className="w-4 h-4" />
              {t('detail.manageChild', { defaultValue: 'Manage Member' })}
            </TactileButton>
          )}
        </div>
      </div>
    </BottomSheet>
  );
};
