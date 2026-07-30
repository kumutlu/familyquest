import React from 'react';
import { cn } from '../../lib/utils';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  /** Optional call to action rendered under the copy. */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Shared empty state. Keeps card radius, border, padding and typography
 * identical across every screen so no surface looks like an unfinished
 * blank panel.
 */
export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'rounded-2xl bg-white border border-gray-100 p-8 text-center',
        className,
      )}
    >
      {icon && (
        <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center">
          {icon}
        </div>
      )}
      <p className="font-semibold text-gray-900">{title}</p>
      {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
