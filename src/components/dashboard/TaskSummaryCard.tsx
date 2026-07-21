import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Progress } from '../ui/Progress';
import { useStore } from '../../store/useStore';
import { isTaskDoneThisPeriod } from '../../lib/taskRecurrence';
import { useRecurrenceClock } from '../../lib/useRecurrenceClock';
import { ListTodo } from 'lucide-react';

/**
 * Compact task summary for the child Home dashboard.
 *
 * Reuses the existing bootstrap `tasks` + `taskCompletions` data (no new
 * queries). Shows the count of active tasks assigned to the current child, a
 * due-today count when tasks carry a `dueDate`, and a simple completion
 * summary. The whole card is tappable and links to /tasks.
 */
export function TaskSummaryCard() {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const { currentUser, tasks, taskCompletions } = useStore();
  // Open-session clock: re-derives completion counts when the day/week
  // boundary crosses while the dashboard stays open.
  const now = useRecurrenceClock();

  const { activeCount, dueTodayCount, completedCount, totalCount, pct } = useMemo(() => {
    const uid = currentUser?.id;
    const active = (tasks || []).filter(
      t => t.isActive !== false && (!t.assigneeId || t.assigneeId === uid),
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const dueToday = active.filter(t => {
      const d = t.dueDate;
      if (!d) return false;
      const date = d.toDate ? d.toDate() : new Date(d);
      if (isNaN(date.getTime())) return false;
      const time = date.getTime();
      return time >= today.getTime() && time < tomorrow.getTime();
    });

    // Count active tasks the child has completed/submitted in the current
    // recurrence period (resets for recurring schedules, permanent for one-time).
    const completed = active.filter(t =>
      isTaskDoneThisPeriod(t, taskCompletions || [], now, uid),
    ).length;

    const total = active.length;
    const progress = total > 0 ? Math.min(100, (completed / total) * 100) : 0;

    return {
      activeCount: total,
      dueTodayCount: dueToday.length,
      completedCount: completed,
      totalCount: total,
      pct: progress,
    };
  }, [currentUser, tasks, taskCompletions, now]);

  return (
    <Card
      data-testid="task-summary"
      role="button"
      tabIndex={0}
      aria-label={t('taskSummary.viewAria')}
      onClick={() => navigate('/tasks')}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate('/tasks');
        }
      }}
      className="cursor-pointer transition-all active:scale-[0.98] hover:border-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
    >
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListTodo size={18} className="text-primary-500" />
          {t('taskSummary.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {activeCount === 0 ? (
          <div className="py-2">
            <p className="text-sm text-gray-500">{t('taskSummary.empty')}</p>
            <p className="mt-1 text-xs text-gray-400">{t('taskSummary.emptyHint')}</p>
          </div>
        ) : (
          <>
            <div className="flex items-end justify-between mb-2">
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">{t('taskSummary.active')}</p>
                <p className="text-2xl font-extrabold text-gray-900">{activeCount}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium uppercase text-gray-500">{t('taskSummary.done')}</p>
                <p className="font-bold text-gray-700">
                  {completedCount}/{totalCount}
                </p>
              </div>
            </div>

            <Progress value={pct} max={100} color="primary" />

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {dueTodayCount > 0 && (
                <span className="font-medium text-warning-600">{t('taskSummary.dueToday', { count: dueTodayCount })}</span>
              )}
              <span className="text-gray-500">{t('taskSummary.complete', { pct: Math.round(pct) })}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
