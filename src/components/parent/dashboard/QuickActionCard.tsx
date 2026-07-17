import React from 'react';
import { cn } from '../../../lib/utils';

export interface QuickActionCardProps {
  icon: React.ReactNode;
  label: string;
  helper?: string;
  onClick?: () => void;
  /** Tailwind classes for the icon container (background + text colour). */
  accent?: string;
}

export function QuickActionCard({
  icon,
  label,
  helper,
  onClick,
  accent = 'bg-primary-50 text-primary-600',
}: QuickActionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'group flex w-full items-center gap-3 rounded-2xl border border-gray-100 bg-white p-3 text-left shadow-sm',
        'transition-all hover:border-primary-300 hover:shadow-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
        'active:scale-[0.98] cursor-pointer sm:p-4',
      )}
    >
      <span className={cn('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', accent)}>
        {icon}
      </span>
      <span className="flex min-w-0 flex-col items-start">
        <span className="text-sm font-semibold text-gray-900">{label}</span>
        {helper && (
          <span className="mt-0.5 hidden text-xs text-gray-500 sm:block">{helper}</span>
        )}
      </span>
    </button>
  );
}
