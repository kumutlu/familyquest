import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '../components/ui/Card';
import { PageLoader } from '../components/ui/PageLoader';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { ChevronLeft, Star, Flame, Trophy, TrendingUp, TrendingDown, Shield, Award, Zap } from 'lucide-react';
import { useStore } from '../store/useStore';
import { ACHIEVEMENTS } from '../lib/achievements';
import { cn } from '../lib/utils';
import { formatDate } from '../i18n/format';
import { HistoryActionControl } from '../components/reversals/HistoryActionControl';
import { GamificationSummaryCard } from '../components/dashboard/GamificationSummaryCard';
import { adaptGamificationSummary, resolveProgression } from '../lib/gamificationAdapters';
import type { GamificationSummaryV1, DailyProgressV1 } from '../domain/gamification/types';

/**
 * Helper to get today's progress for a child from the daily progress array.
 * The dayKey format is YYYYMMDD.
 */
function getTodaysProgress(
  dailyProgress: DailyProgressV1[],
  childId: string,
  todayKey: string,
): DailyProgressV1 | null {
  return dailyProgress.find(
    (p) => p.childId === childId && p.dayKey === todayKey,
  ) ?? null;
}

/**
 * Formats a date as YYYYMMDD for dayKey comparison.
 */
function formatDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

export function MemberProfile() {
  const { t } = useTranslation(['profile', 'dashboard']);
  const { id } = useParams();
  const {
    familyMembers,
    loading,
    behaviourEvents,
    gamificationSummaries,
    dailyProgress,
    myGamificationSummary,
    currentUser,
  } = useStore();

  if (loading) return <PageLoader label={t('profile:loading')} />;

  // Always resolve the *target* member from the route param first. Falling back
  // to `currentUser` only when the route points at the signed-in user keeps a
  // parent viewing a child from ever rendering their own values.
  const member =
    familyMembers.find(m => m.id === id) ??
    (currentUser?.id === id ? currentUser : undefined);
  if (!member) {
    return (
      <div data-testid="profile-not-found" className="p-8 text-center text-gray-500">
        {t('profile:notFound')}
      </div>
    );
  }

  // Get the gamification projection for the *viewed* member.
  //
  // - Parents read the whole `gamification_summaries` collection. Documents are
  //   keyed by child id; the `childId` field is absent on legacy documents, so
  //   the document id must be matched as well (this was the parent-viewing-child
  //   regression: the lookup silently missed and progression stayed empty).
  // - Children cannot read the collection, so the store only populates
  //   `myGamificationSummary`. That document is only ever valid for the member
  //   it belongs to — never keyed off `currentUser` alone, which would leak the
  //   signed-in parent's XP into a child's profile.
  const ownSummary = myGamificationSummary as (GamificationSummaryV1 & { id?: string }) | null;
  const summaryDoc: GamificationSummaryV1 | null =
    (gamificationSummaries.find(
      (s: GamificationSummaryV1 & { id?: string }) => s.childId === id || s.id === id,
    ) ?? null) ||
    (ownSummary && (ownSummary.childId === id || ownSummary.id === id) ? ownSummary : null);
  const todaysProgress = getTodaysProgress(dailyProgress, id!, formatDayKey(new Date()));
  const gamificationView = adaptGamificationSummary(summaryDoc, todaysProgress);
  // Always-complete progression: falls back to the member's lifetimeXP balance
  // when the server projection is missing or rebuilding.
  const progression = resolveProgression(summaryDoc, member);

  const userEvents = behaviourEvents.filter(e => e.userId === id).slice(0, 10);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      <header className="flex items-center gap-4">
        <Link to="/family" className="p-2 -ml-2 text-gray-400 hover:text-gray-900 bg-gray-100 rounded-full transition-colors">
          <ChevronLeft size={24} />
        </Link>
        <h1 className="text-xl font-bold text-gray-900">{t('profile:title')}</h1>
      </header>

      <div className="flex flex-col items-center text-center space-y-4 py-4">
        <div className="relative">
          <Avatar src={member.avatarUrl} fallback={member.displayName[0]} size="xl" className="w-24 h-24 ring-4 ring-white shadow-xl" />
          <div
            data-testid="profile-avatar-level-badge"
            className="absolute -bottom-2 -right-2 bg-primary-500 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold border-2 border-white shadow-sm"
          >
            {progression.level}
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-extrabold text-gray-900">{member.displayName}</h2>
          <p className="text-primary-600 font-bold">{t('profile:rewardPoints', { count: member.rewardPoints || 0 })}</p>
        </div>
      </div>

      {/* Progression — always rendered from the projection or the lifetimeXP fallback */}
      <Card data-testid="profile-progression" className="border-none bg-primary-500 text-white">
        <CardContent className="p-4">
          <div className="flex items-baseline justify-between">
            <p data-testid="profile-level" className="text-sm font-bold uppercase tracking-wider">
              {t('profile:level', { level: progression.level })}
            </p>
            <span className="text-sm font-medium text-primary-100">{progression.percentage}%</span>
          </div>

          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-primary-700">
            <div
              data-testid="profile-progress-bar"
              role="progressbar"
              aria-valuenow={progression.percentage}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2.5 rounded-full bg-white transition-all duration-500 ease-out"
              style={{ width: `${progression.percentage}%` }}
            />
          </div>

          <div className="mt-3 flex items-center justify-between text-xs font-medium text-primary-100">
            <span data-testid="profile-current-xp">
              {t('profile:currentXp', { count: progression.xpProgressInLevel })}
            </span>
            <span data-testid="profile-next-level-xp">
              {t('profile:toNextLevel', { count: progression.xpToNextLevel })}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-primary-200">
                {t('profile:rewardPointsLabel')}
              </p>
              <p data-testid="profile-reward-points" className="font-bold text-white">
                {member.rewardPoints || 0}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-primary-200">
                {t('profile:lifetimeXpLabel')}
              </p>
              <p data-testid="profile-lifetime-xp" className="font-bold text-white">
                {progression.lifetimeXp}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Streaks / daily goal detail — only when the server projection is available */}
      {gamificationView.isAvailable && <GamificationSummaryCard summary={gamificationView} />}

      <section>
        <h2 className="text-lg font-bold text-gray-900 mb-4">{t('profile:behaviourHistory')}</h2>
        {userEvents.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500">
            {t('profile:noEvents')}
          </div>
        ) : (
          <div className="space-y-3">
            {userEvents.map(event => (
              <Card key={event.id}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-gray-900">{event.title}</h4>
                    <p className="text-xs text-gray-500 mt-1">
                      {event.timestamp?.toDate ? formatDate(event.timestamp.toDate()) : ''}
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
                    <HistoryActionControl sourceKind="behaviour_event" source={event} />
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
          {t('profile:achievementGallery')}
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