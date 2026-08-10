import { useTranslation } from 'react-i18next';
import { useStore } from '../../../store/useStore';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { Zap, ArrowRightLeft, Gift, Coins, PawPrint, CheckCircle2, Activity, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useRequestDetail } from '../../requests/RequestDetailContext';
import { resolveFeedRequest } from '../../../lib/feedRequestResolver';
import { formatDate } from '../../../i18n/format';
import { attributeFeedItem, toDateValue } from '../../../lib/activityAttribution';

const TYPE_ICONS: Record<string, ReactNode> = {
  behaviour: <Zap size={16} className="text-warning-500" />,
  transfer: <ArrowRightLeft size={16} className="text-primary-500" />,
  reward: <Gift size={16} className="text-reward-500" />,
  money: <Coins size={16} className="text-success-500" />,
  petbox: <PawPrint size={16} className="text-primary-500" />,
  task: <CheckCircle2 size={16} className="text-success-500" />,
};

function iconForType(type?: string): ReactNode {
  if (type && TYPE_ICONS[type]) return TYPE_ICONS[type];
  return <Activity size={16} className="text-gray-400" />;
}

function formatTimestamp(timestamp: any): string {
  const date = toDateValue(timestamp);
  if (!date) return '';
  const isToday = date.toDateString() === new Date().toDateString();
  const time = formatDate(date, undefined, { hour: '2-digit', minute: '2-digit' });
  return isToday ? time : `${formatDate(date)} • ${time}`;
}

export function RecentActivity() {
  const { t } = useTranslation('dashboard');
  const { openRequest } = useRequestDetail();
  const {
    feed = [],
    moneyRequests = [],
    transferRequests = [],
    profileUpdateRequests = [],
    redemptions = [],
    taskCompletions = [],
    petboxRequests = [],
    tasks = [],
    familyMembers = [],
  } = useStore();

  const events = [...feed]
    .sort((a, b) => {
      const aTime = a?.timestamp?.toMillis ? a.timestamp.toMillis() : 0;
      const bTime = b?.timestamp?.toMillis ? b.timestamp.toMillis() : 0;
      return bTime - aTime;
    })
    .slice(0, 8);

  return (
    <section aria-labelledby="recent-activity-heading">
      <h2
        id="recent-activity-heading"
        className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-900"
      >
        {t('recentActivity.heading')}
      </h2>

      {events.length === 0 ? (
        <EmptyState
          title={t('recentActivity.empty')}
          icon={<Activity size={22} aria-hidden="true" />}
          className="shadow-sm"
        />
      ) : (
        <Card className="p-1">
          {events.map(item => {
            const linked = resolveFeedRequest(item, {
              moneyRequests,
              transferRequests,
              profileUpdateRequests,
              redemptions,
              taskCompletions,
              petboxRequests,
            });

            const attribution = attributeFeedItem(item, { taskCompletions, tasks, familyMembers });
            // A fully attributed row (child + task) leads with the child who
            // completed it; anything else keeps its original, raw activity text.
            const attributed = Boolean(attribution.subjectName && attribution.taskTitle);

            const baseRow = (
              <>
                <span className="mt-0.5 shrink-0">{iconForType(item.type)}</span>
                <div className="min-w-0 flex-1">
                  {attributed ? (
                    <>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {t('recentActivity.completedBy', { child: attribution.subjectName })}
                      </p>
                      <p className="text-sm font-semibold text-gray-900 break-words">{attribution.taskTitle}</p>
                    </>
                  ) : (
                    <p className="text-sm font-semibold text-gray-900 break-words">{item.text}</p>
                  )}
                  {attribution.points !== undefined && attribution.points !== 0 && (
                    <p
                      className={`mt-0.5 text-sm font-bold ${attribution.points > 0 ? 'text-success-600' : 'text-danger-600'}`}
                    >
                      {t('recentActivity.points', {
                        sign: attribution.points > 0 ? '+' : '−',
                        points: Math.abs(attribution.points),
                      })}
                    </p>
                  )}
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {attribution.approverName ? (
                      <span className="text-xs font-medium text-gray-600">
                        {t('recentActivity.approvedBy', { name: attribution.approverName })}
                      </span>
                    ) : (
                      item.actorName && (
                        <span className="text-xs font-medium text-gray-600">{item.actorName}</span>
                      )
                    )}
                    <span className="text-xs text-gray-400">{formatTimestamp(item.timestamp)}</span>
                  </div>
                </div>
                {linked && (
                  <span className="ml-2 flex shrink-0 items-center gap-1 text-xs font-medium text-primary-600 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                    {t('recentActivity.viewRequest')}
                    <ChevronRight size={14} />
                  </span>
                )}
              </>
            );

            if (!linked) {
              return (
                <div
                  key={item.id}
                  className="flex items-start gap-3 border-b border-gray-50 p-4 last:border-0"
                >
                  {baseRow}
                </div>
              );
            }

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => openRequest(linked)}
                aria-label={t('recentActivity.viewRequestAria', { text: item.text })}
                className="group flex w-full items-start gap-3 border-b border-gray-50 p-4 text-left last:border-0 transition-colors hover:bg-primary-50/60 focus:bg-primary-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
              >
                {baseRow}
              </button>
            );
          })}
        </Card>
      )}
    </section>
  );
}
