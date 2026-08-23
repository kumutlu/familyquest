import { cn } from '../../lib/utils';

export type QuekiProgressTone = 'brand' | 'xp' | 'mint' | 'coral' | 'streak' | 'family';

const TRACKS: Record<QuekiProgressTone, string> = {
  brand: 'bg-primary-500',
  xp: 'bg-xp-400',
  mint: 'bg-mint-500',
  coral: 'bg-coral-500',
  streak: 'bg-streak-500',
  family: 'bg-family-500',
};

export interface ProgressBarProps {
  /** 0–100. Values outside the range are clamped. */
  value: number;
  tone?: QuekiProgressTone;
  className?: string;
  /** Accessible name for the meter (e.g. "Level progress"). */
  'aria-label': string;
}

/** Linear progress meter with an accessible role="progressbar". */
export function ProgressBar({ value, tone = 'brand', className, 'aria-label': ariaLabel }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cn('h-2 w-full overflow-hidden rounded-full qk-bg-inset', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-[var(--animate-duration-card)] ease-enter', TRACKS[tone])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export interface ProgressRingProps {
  /** 0–100. */
  value: number;
  size?: number;
  strokeWidth?: number;
  tone?: QuekiProgressTone;
  className?: string;
  children?: React.ReactNode;
  'aria-label': string;
}

/** Circular progress ring (SVG). Centre content (level badge etc.) via children. */
export function ProgressRing({
  value,
  size = 72,
  strokeWidth = 7,
  tone = 'xp',
  className,
  children,
  'aria-label': ariaLabel,
}: ProgressRingProps) {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);

  const strokeColor = {
    brand: 'var(--color-primary-500)',
    xp: 'var(--color-xp-400)',
    mint: 'var(--color-mint-500)',
    coral: 'var(--color-coral-500)',
    streak: 'var(--color-streak-500)',
    family: 'var(--color-family-500)',
  }[tone];

  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--qk-surface-inset)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset var(--animate-duration-card) var(--ease-enter, ease)' }}
        />
      </svg>
      {children != null && (
        <div className="absolute inset-0 flex items-center justify-center">{children}</div>
      )}
    </div>
  );
}
