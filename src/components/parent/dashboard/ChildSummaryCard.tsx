import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '../../ui/Card';
import { Avatar } from '../../ui/Avatar';
import { CurrencyDisplay } from '../../ui/CurrencyDisplay';
import { Progress } from '../../ui/Progress';
import { Flame, Star, Wallet, ListChecks, CheckCircle2, Circle } from 'lucide-react';
import type { GamificationSummaryView } from '../../../lib/gamificationAdapters';

export interface ChildSummaryCardProps {
  child: any;
  /**
   * Canonical wallet balance in pence, sourced from
   * families/{familyId}/wallets/{childId}.balance.
   * `null` means the canonical wallet document is missing/unavailable
   * (never fall back to a legacy profile balance).
   */
  walletBalance: number | null;
  pendingTaskCount: number;
  /**
   * Gamification summary view for this child, adapted from Firestore.
   * `null` means the summary is unavailable or still loading.
   */
  gamificationSummary: GamificationSummaryView | null;
}

export function ChildSummaryCard({ child, walletBalance, pendingTaskCount, gamificationSummary }: ChildSummaryCardProps) {
  const { t } = useTranslation('dashboard');
  const displayName = child.displayName || 'Child';

  // Authoritative progression source: families/{familyId}/gamification_summaries/{memberId}.
  // `users/{id}.lifetimeXP` is legacy and must never drive level/XP UI here — when the
  // projection is unavailable we render the fallback state instead of fabricating a level.
  const isSummaryAvailable = gamificationSummary?.isAvailable ?? false;
  const summary = isSummaryAvailable ? gamificationSummary : null;

  const level = summary ? summary.level : null;

  const points = child.rewardPoints || 0;

  const bestStreak = summary ? summary.bestStreak : 0;

  const xpToNextLevel = summary ? summary.xpToNextLevel : null;

  const levelProgress = summary ? (summary.xpProgressInLevel / 1000) * 100 : 0;

  const todayProgress = summary ? summary.todayProgress : null;
  const todayGoalReached = summary ? summary.todayGoalReached : null;
  const todayPerfectDay = summary ? summary.todayPerfectDay : null;

  return (
    <Link
      to={`/family/${child.id}`}
      aria-label={t('childCard.viewProfileAria', { name: displayName })}
      className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <Card className="h-full transition-colors hover:border-primary-300">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <Avatar src={child.avatarUrl} fallback={displayName[0] || '?'} size="md" />
            <div className="min-w-0">
              <h3 className="truncate font-bold text-gray-900">{displayName}</h3>
              <p className="text-xs font-medium text-gray-500">
                {summary ? t('childCard.level', { level }) : t('childCard.unavailable')}
              </p>
            </div>
          </div>

          {/* Level progress bar — projection only */}
          {summary && (
            <div className="mt-3">
              <div className="flex justify-between text-[10px] font-medium text-gray-500">
                <span className="flex flex-col">
                  <span>{t('childCard.xpTotal')}</span>
                  <span className="text-xs font-bold text-gray-900">{t('childCard.xpTotalValue', { xp: summary.xpTotal })}</span>
                </span>
                <span aria-label={t('childCard.xpToNext', { xp: xpToNextLevel, level: (level as number) + 1 })}>
                  {t('childCard.xpToNext', { xp: xpToNextLevel, level: (level as number) + 1 })}
                </span>
              </div>
              <Progress value={levelProgress} className="mt-1" />
            </div>
          )}

          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{t('childCard.points')}</p>
              <p className="flex items-center justify-center gap-1 font-bold text-gray-900">
                <Star size={12} className="text-reward-500" />
                {points}
              </p>
            </div>
            <div className="border-x border-gray-100">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{t('childCard.wallet')}</p>
              <p className="flex items-center justify-center gap-1 font-bold text-success-600">
                <Wallet size={12} />
                {walletBalance === null ? (
                  <span className="text-xs font-semibold text-gray-400">{t('childCard.unavailable')}</span>
                ) : (
                  <CurrencyDisplay amountPence={walletBalance} forceColor={false} privacy="wallet" />
                )}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{t('childCard.bestStreak')}</p>
              <p className="flex items-center justify-center gap-1 font-bold text-gray-900">
                <Flame size={12} className="text-warning-500" />
                {bestStreak}
              </p>
            </div>
          </div>

          {/* Today's progress and Daily Goal status */}
          {summary && (
            <div className="mt-3 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1">
                {todayProgress !== null ? (
                  <>
                    <span className="text-gray-500">{t('childCard.todayProgress')}</span>
                    <span className="font-medium text-gray-900" aria-label={`${todayProgress}% complete`}>
                      {todayProgress}%
                    </span>
                  </>
                ) : (
                  <span className="text-gray-400">{t('childCard.noEligibleTasks')}</span>
                )}
              </div>
              {todayGoalReached !== null && (
                <div className="flex items-center gap-1" aria-label={todayGoalReached ? t('childCard.dailyGoalReached') : t('childCard.dailyGoalNotReached')}>
                  {todayGoalReached ? (
                    <CheckCircle2 size={14} className="text-success-500" />
                  ) : (
                    <Circle size={14} className="text-gray-300" />
                  )}
                  <span className={todayGoalReached ? 'text-success-600 font-medium' : 'text-gray-500'}>
                    {todayGoalReached ? t('childCard.dailyGoalReached') : t('childCard.dailyGoalNotReached')}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Perfect Day status - only shown when defined */}
          {summary && todayPerfectDay && (
            <div className="mt-2 flex items-center gap-1 text-xs text-success-600">
              <CheckCircle2 size={14} className="text-success-500" />
              <span className="font-medium">{t('childCard.perfectDay')}</span>
            </div>
          )}

          {/* Quiet "updating" indicator for a dirty/rebuilding projection whose
              own values are still shown (never hidden). */}
          {summary && summary.isUpdating && (
            <p className="mt-2 text-xs text-gray-400">{t('childCard.rebuilding')}</p>
          )}

          {/* Unavailable indicator when no projection and no fallback. */}
          {!summary && (
            <p className="mt-2 text-xs text-gray-400">{t('childCard.rebuilding')}</p>
          )}

          {pendingTaskCount > 0 && (
            <p className="mt-3 flex items-center gap-1 text-xs text-gray-500">
              <ListChecks size={12} />
              {t('childCard.pendingTasks', { count: pendingTaskCount })}
            </p>
          )}

          <p className="mt-3 text-sm font-semibold text-primary-600">{t('childCard.viewProfile')}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
