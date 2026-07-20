import { useStore } from '../../../store/useStore';
import { Card } from '../../ui/Card';
import { Zap, ArrowRightLeft, Gift, Coins, PawPrint, CheckCircle2, Activity, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useRequestDetail } from '../../requests/RequestDetailContext';
import { resolveFeedRequest } from '../../../lib/feedRequestResolver';

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
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date();
  if (isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

export function RecentActivity() {
  const { openRequest } = useRequestDetail();
  const {
    feed = [],
    moneyRequests = [],
    transferRequests = [],
    profileUpdateRequests = [],
    redemptions = [],
    taskCompletions = [],
    petboxRequests = [],
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
        Recent Family Activity
      </h2>

      {events.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center text-gray-500 shadow-sm">
          No family activity yet.
        </div>
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

            const baseRow = (
              <>
                <span className="mt-0.5 shrink-0">{iconForType(item.type)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 break-words">{item.text}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {item.actorName && (
                      <span className="text-xs font-medium text-gray-600">{item.actorName}</span>
                    )}
                    <span className="text-xs text-gray-400">{formatTimestamp(item.timestamp)}</span>
                  </div>
                </div>
                {linked && (
                  <span className="ml-2 flex shrink-0 items-center gap-1 text-xs font-medium text-primary-600 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                    View request
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
                aria-label={`View request: ${item.text}`}
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
