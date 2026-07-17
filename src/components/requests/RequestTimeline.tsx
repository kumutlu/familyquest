import { cn } from '../../lib/utils';
import type { RequestTimelineEvent, RequestTimelineKind } from '../../lib/requestModel';

interface RequestTimelineProps {
  events: RequestTimelineEvent[];
}

const dotColor: Record<RequestTimelineKind, string> = {
  created: 'bg-gray-400',
  pending: 'bg-warning-500',
  approved: 'bg-success-500',
  rejected: 'bg-danger-500',
  cancelled: 'bg-gray-400',
  comment: 'bg-primary-400',
};

function formatTimestamp(value: number | null): string {
  if (value == null) return 'Pending';
  return new Date(value).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function RequestTimeline({ events }: RequestTimelineProps) {
  if (!events || events.length === 0) return null;

  return (
    <ol className="relative space-y-4" aria-label="Request timeline">
      {events.map((event, index) => {
        const isLast = index === events.length - 1;
        return (
          <li key={event.id} className="relative flex gap-3 pl-1">
            {!isLast && (
              <span
                className="absolute left-[5px] top-4 h-full w-px bg-gray-200"
                aria-hidden="true"
              />
            )}
            <span
              className={cn('relative mt-1 h-2.5 w-2.5 shrink-0 rounded-full', dotColor[event.kind])}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 break-words">{event.label}</p>
              <p className="text-xs text-gray-400">{formatTimestamp(event.timestamp)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
