import { cn } from '../../lib/utils';
import type { RequestStatusKind } from '../../lib/requestModel';

interface RequestStatusBadgeProps {
  statusKind: RequestStatusKind;
  statusLabel: string;
  className?: string;
}

const config: Record<RequestStatusKind, { emoji: string; classes: string }> = {
  pending: { emoji: '🟡', classes: 'bg-orange-100 text-warning-600' },
  approved: { emoji: '🟢', classes: 'bg-green-100 text-success-600' },
  rejected: { emoji: '🔴', classes: 'bg-red-100 text-danger-600' },
  cancelled: { emoji: '⚪', classes: 'bg-gray-100 text-gray-500' },
  other: { emoji: '⚪', classes: 'bg-gray-100 text-gray-500' },
};

export function RequestStatusBadge({ statusKind, statusLabel, className }: RequestStatusBadgeProps) {
  const { emoji, classes } = config[statusKind] ?? config.other;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider',
        classes,
        className,
      )}
    >
      <span aria-hidden="true">{emoji}</span>
      {statusLabel}
    </span>
  );
}
