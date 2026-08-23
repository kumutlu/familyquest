import { cn } from '../../lib/utils';
import type { QuekiProgressTone } from './Progress';

const TONES: Record<QuekiProgressTone, string> = {
  brand: 'bg-primary-50 text-primary-700 dark:text-primary-200',
  xp: 'bg-xp-50 text-xp-700',
  mint: 'bg-mint-50 text-mint-700',
  coral: 'bg-coral-50 text-coral-700',
  streak: 'bg-streak-50 text-streak-700',
  family: 'bg-family-50 text-family-700',
};

export interface StatusBadgeProps {
  tone?: QuekiProgressTone;
  children: React.ReactNode;
  className?: string;
  /** Optional leading dot; meaning is never carried by colour alone — pair it
   *  with text (the badge always renders its label). */
  dot?: boolean;
}

/** Small tinted status chip bound to a Queki semantic identity. */
export function StatusBadge({ tone = 'brand', dot = false, children, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-meta font-semibold',
        TONES[tone],
        className,
      )}
    >
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
