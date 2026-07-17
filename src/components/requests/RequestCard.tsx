import React from 'react';
import { cn } from '../../lib/utils';
import { Avatar } from '../ui/Avatar';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { RequestStatusBadge } from './RequestStatusBadge';
import type { NormalizedRequest } from '../../lib/requestModel';

interface RequestCardProps {
  request: NormalizedRequest;
  onOpen?: () => void;
  /** Inline action buttons (e.g. quick approve). They must stop propagation. */
  actions?: React.ReactNode;
  className?: string;
}

function formatDateTime(value: number | null): string {
  if (value == null) return '';
  const date = new Date(value);
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * A single, fully-tappable request card. The whole surface opens the detail
 * sheet; inline `actions` (if any) stop propagation so they do not also open it.
 */
export function RequestCard({ request, onOpen, actions, className }: RequestCardProps) {
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!onOpen) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${request.typeLabel}: ${request.primarySummary}`}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      className={cn(
        'group w-full text-left bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden',
        'transition-colors hover:border-primary-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
        'cursor-pointer select-none',
        request.statusKind === 'pending' && 'border-warning-200 bg-warning-50/30',
        className,
      )}
    >
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            {request.typeLabel}
          </span>
          <RequestStatusBadge statusKind={request.statusKind} statusLabel={request.statusLabel} />
        </div>

        <div className="flex items-start gap-3">
          {request.requestedBy && (
            <Avatar
              src={request.requestedBy.avatarUrl}
              fallback={(request.requestedBy.name || '?')[0]}
              size="sm"
              className="shrink-0"
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-gray-900 leading-tight break-words">
              {request.primarySummary}
            </p>
            {request.secondarySummary && (
              <p className="mt-1 text-sm text-gray-600 line-clamp-2 break-words">
                {request.secondarySummary}
              </p>
            )}
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              {request.amountPence != null && (
                <span className="font-bold text-gray-900">
                  <CurrencyDisplay amountPence={request.amountPence} forceColor={false} />
                </span>
              )}
              {request.createdAt != null && (
                <span className="text-xs text-gray-400">{formatDateTime(request.createdAt)}</span>
              )}
            </div>
          </div>
        </div>

        {actions && (
          <div
            className="flex gap-2 self-end"
            onClick={event => event.stopPropagation()}
            onKeyDown={event => event.stopPropagation()}
          >
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
