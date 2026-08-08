import { useTranslation } from 'react-i18next';
import { useStore } from '../../../store/useStore';
import { isChildRole } from '../../../lib/roles';
import { isTaskDoneThisPeriod } from '../../../lib/taskRecurrence';
import { useRecurrenceClock } from '../../../lib/useRecurrenceClock';
import { ChildSummaryCard } from './ChildSummaryCard';
import { findMemberSummary, resolveGamificationView } from '../../../lib/gamificationAdapters';
import type { GamificationSummaryV1, DailyProgressV1 } from '../../../domain/gamification/types';

function ChildCardSkeleton() {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 animate-pulse rounded-full bg-gray-200" />
        <div className="space-y-2">
          <div className="h-4 w-28 animate-pulse rounded bg-gray-200" />
          <div className="h-3 w-12 animate-pulse rounded bg-gray-100" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="h-8 animate-pulse rounded bg-gray-100" />
        <div className="h-8 animate-pulse rounded bg-gray-100" />
        <div className="h-8 animate-pulse rounded bg-gray-100" />
      </div>
    </div>
  );
}

/**
 * Gets today's progress for a child from the daily progress array.
 * The dayKey format is YYYYMMDD. We need to find the most recent
 * progress for the current day.
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

export function ChildrenOverview() {
  const { t } = useTranslation('dashboard');
  const {
    familyMembers = [],
    childWallets = [],
    tasks = [],
    taskCompletions = [],
    gamificationSummaries = [],
    dailyProgress = [],
    bootstrapStatus,
  } = useStore();
  const walletsLoading = (bootstrapStatus as any)?.wallets === 'loading';
  const summariesLoading = (bootstrapStatus as any)?.gamificationSummaries === 'loading';

  // Open-session clock: re-derives "done this period" when the day/week
  // boundary crosses while the dashboard stays open.
  const now = useRecurrenceClock();
  const todayKey = formatDayKey(now);

  const children = familyMembers.filter(member => isChildRole(member.role));

  if (children.length === 0) return null;

  return (
    <section aria-labelledby="children-overview-heading">
      <h2
        id="children-overview-heading"
        className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-900"
      >
        {t('childrenOverview.heading')}
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {walletsLoading || summariesLoading
          ? children.map(child => <ChildCardSkeleton key={child.id} />)
          : children.map(child => {
              const walletDoc = childWallets.find(w => w.id === child.id);
              // Canonical source only: families/{familyId}/wallets/{childId}.balance
              // `null` => missing canonical document => show "Unavailable", never a
              // legacy profile balance (e.g. child.walletBalance).
              const balance = walletDoc ? walletDoc.balance : null;

              const pendingTaskCount = tasks.filter(
                task =>
                  task.isActive !== false &&
                  task.assigneeId === child.id &&
                  !isTaskDoneThisPeriod(task, taskCompletions, now, child.id),
              ).length;

              // Get gamification summary and today's progress for this child.
              // Shared lookup (mirrors MemberProfile) — legacy/backfilled
              // documents may omit `childId`; the document id is the child id.
              const summaryDoc = findMemberSummary(gamificationSummaries, null, child.id);
              const todaysProgress = getTodaysProgress(dailyProgress, child.id, todayKey);
              // Shared resolver: a present projection (even dirty/rebuilding)
              // is authoritative; `child.lifetimeXP` is only a compatibility
              // fallback when the projection document is genuinely absent.
              const gamificationView = resolveGamificationView(summaryDoc, child, todaysProgress);

              return (
                <ChildSummaryCard
                  key={child.id}
                  child={child}
                  walletBalance={balance}
                  pendingTaskCount={pendingTaskCount}
                  gamificationSummary={gamificationView}
                />
              );
            })}
      </div>
    </section>
  );
}