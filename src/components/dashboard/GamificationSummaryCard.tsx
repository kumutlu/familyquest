import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Progress } from '../ui/Progress';
import { Flame, Star, CheckCircle2, Circle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GamificationSummaryView } from '../../lib/gamificationAdapters';

export interface GamificationSummaryCardProps {
  /**
   * Gamification summary view for display.
   * `null` means the summary is unavailable or still loading.
   */
  summary: GamificationSummaryView | null;
  /**
   * Whether a gamification request is genuinely in flight.
   *
   * Skeletons are only permitted while this is `true`. When the summary is
   * unavailable and nothing is loading we render the fallback UI instead —
   * the gamification projection is optional data and its absence must never
   * leave a permanent skeleton on the dashboard.
   */
  loading?: boolean;
}

/**
 * Gamification summary card for the child dashboard.
 *
 * Displays:
 * - Current level
 * - Total XP
 * - XP progress toward next level
 * - Current streak
 * - Best streak
 * - Today's weighted progress
 * - Daily Goal status
 * - Perfect Day status when achieved
 *
 * Handles:
 * - In-flight loading state (skeleton, only while `loading` is true)
 * - Unavailable/rebuilding projection (static fallback card, never a skeleton)
 * - Zero eligible tasks (shows "No tasks today")
 */
export function GamificationSummaryCard({ summary, loading = false }: GamificationSummaryCardProps) {
  const { t } = useTranslation('dashboard');

  const unavailable = !summary || !summary.isAvailable;

  // Skeletons are only allowed while an active request is in flight.
  if (unavailable && loading) {
    return (
      <Card
        data-testid="gamification-summary-skeleton"
        role="status"
        aria-busy="true"
        aria-label={t('gamification.loading')}
        className="animate-pulse border-none bg-gray-100"
      >
        <CardHeader className="border-none pb-2">
          <div className="flex justify-between">
            <div className="h-4 w-24 rounded bg-gray-200" />
            <div className="h-4 w-10 rounded bg-gray-200" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-2 w-full rounded-full bg-gray-200" />
          <div className="mt-3 ml-auto h-3 w-28 rounded bg-gray-200" />
          <div className="mt-2 ml-auto h-3 w-32 rounded bg-gray-200" />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="mx-auto h-8 w-20 rounded bg-gray-200" />
            <div className="mx-auto h-8 w-20 rounded bg-gray-200" />
          </div>
          <span className="sr-only">{t('gamification.loading')}</span>
        </CardContent>
      </Card>
    );
  }

  // Optional data is unavailable (missing / dirty / rebuilding projection) and
  // no request is in flight: render the static fallback, never a skeleton.
  if (unavailable) {
    return (
      <Card data-testid="gamification-summary-unavailable" className="border-gray-100 bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-gray-500">
            {t('gamification.unavailableTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">{t('gamification.unavailable')}</p>
        </CardContent>
      </Card>
    );
  }

  const {
    level,
    xpTotal,
    xpProgressInLevel,
    xpToNextLevel,
    currentStreak,
    bestStreak,
    todayProgress,
    todayGoalReached,
    todayPerfectDay,
  } = summary;

  const levelProgress = (xpProgressInLevel / 1000) * 100;

  return (
    <Card data-testid="gamification-summary" className="border-none bg-primary-500 text-white">
      <CardHeader className="border-none pb-2">
        <CardTitle className="flex justify-between text-sm font-medium uppercase tracking-wider text-white opacity-90">
          {t('gamification.level', { level })}
          <span aria-label={t('gamification.xpProgress', { xp: xpProgressInLevel, level })}>
            {Math.round(levelProgress)}%
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Progress value={levelProgress} className="bg-primary-700 [&>div]:bg-white" />
        <p className="mt-2 text-right text-xs font-medium text-primary-200" aria-label={t('gamification.xpTotal', { xp: xpTotal })}>
          {t('gamification.xpTotal', { xp: xpTotal })}
        </p>
        <p className="mt-1 text-right text-xs font-medium text-primary-200" aria-label={t('gamification.xpToNextLevel', { xp: xpToNextLevel, level: level + 1 })}>
          {t('gamification.xpToNext', { xp: xpToNextLevel, level: level + 1 })}
        </p>

        {/* Streak stats */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-wider text-primary-200">{t('gamification.currentStreak')}</p>
            <p className="flex items-center justify-center gap-1 font-bold text-white">
              <Flame size={14} className="text-warning-300" />
              {currentStreak}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-wider text-primary-200">{t('gamification.bestStreak')}</p>
            <p className="flex items-center justify-center gap-1 font-bold text-white">
              <Star size={14} className="text-reward-300" />
              {bestStreak}
            </p>
          </div>
        </div>

        {/* Today's progress and Daily Goal status */}
        <div className="mt-3 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1">
            {todayProgress !== null ? (
              <>
                <span className="text-primary-200">{t('gamification.todayProgress')}</span>
                <span className="font-medium text-white" aria-label={t('gamification.todayProgressAria', { progress: todayProgress })}>
                  {todayProgress}%
                </span>
              </>
            ) : (
              <span className="text-primary-300">{t('gamification.noEligibleTasks')}</span>
            )}
          </div>
          {todayGoalReached !== null && (
            <div className="flex items-center gap-1" aria-label={todayGoalReached ? t('gamification.dailyGoalReached') : t('gamification.dailyGoalNotReached')}>
              {todayGoalReached ? (
                <CheckCircle2 size={14} className="text-success-300" />
              ) : (
                <Circle size={14} className="text-primary-300" />
              )}
              <span className={todayGoalReached ? 'text-success-300 font-medium' : 'text-primary-300'}>
                {todayGoalReached ? t('gamification.dailyGoalReached') : t('gamification.dailyGoalNotReached')}
              </span>
            </div>
          )}
        </div>

        {/* Perfect Day status - only shown when achieved */}
        {todayPerfectDay && (
          <div className="mt-2 flex items-center gap-1 text-xs text-success-300">
            <CheckCircle2 size={14} className="text-success-300" />
            <span className="font-medium">{t('gamification.perfectDay')}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}