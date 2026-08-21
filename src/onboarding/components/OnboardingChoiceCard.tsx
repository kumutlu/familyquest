import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

interface OnboardingChoiceCardProps {
  label: string;
  description?: string;
  icon?: ReactNode;
  meta?: ReactNode;
  selected: boolean;
  onSelect: () => void;
  className?: string;
}

export function OnboardingChoiceCard({
  label,
  description,
  icon,
  meta,
  selected,
  onSelect,
  className = '',
}: OnboardingChoiceCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={[
        'group relative flex min-h-16 w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left',
        'transition-[border-color,background-color,box-shadow,transform] duration-200 motion-reduce:transition-none',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900',
        selected
          ? 'border-primary-500 bg-primary-50 shadow-sm dark:border-indigo-400 dark:bg-indigo-500/15'
          : 'border-gray-200 bg-white/80 hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900/70 dark:hover:border-indigo-500',
        className,
      ].join(' ')}
    >
      {icon ? (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-100 text-primary-700 dark:bg-indigo-500/20 dark:text-indigo-200">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-gray-900 dark:text-slate-100">{label}</span>
        {description ? <span className="mt-0.5 block text-sm text-gray-500 dark:text-slate-400">{description}</span> : null}
      </span>
      {meta ? <span className="shrink-0 text-sm font-bold text-primary-600 dark:text-indigo-300">{meta}</span> : null}
      <span
        aria-hidden="true"
        className={[
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors duration-200 motion-reduce:transition-none',
          selected
            ? 'border-primary-500 bg-primary-500 text-white'
            : 'border-gray-300 text-transparent dark:border-slate-600',
        ].join(' ')}
      >
        <Check className="h-4 w-4" />
      </span>
    </button>
  );
}
