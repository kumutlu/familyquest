import { Zap, Star, Flame, Wallet } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Semantic value displays — the core of the "XP ≠ points ≠ real money" rule.
 *
 * Each quantity owns a permanent visual identity that never changes across
 * surfaces or themes:
 *   XP      → gold    + lightning glyph   (growth / progression)
 *   Points  → gold-tinted star            (spendable reward currency)
 *   Streak  → orange  + flame             (consistency)
 *   Wallet  → mint    + wallet glyph      (real money, always formatted £x.yy)
 *
 * Every display renders an explicit text label so meaning never depends on
 * colour alone.
 */

export interface XPDisplayProps {
  total: number;
  /** Progress into the current level, 0–100. */
  levelProgress?: number;
  level?: number;
  compact?: boolean;
  className?: string;
}

export function XPDisplay({ total, levelProgress, level, compact = false, className }: XPDisplayProps) {
  return (
    <div
      className={cn('flex items-center gap-2', className)}
      aria-label={`XP: ${total} experience points${level ? `, level ${level}` : ''}`}
    >
      <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-xl bg-xp-50 text-xp-500">
        <Zap size={18} strokeWidth={2.5} />
      </span>
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className={cn('font-balance tabular-nums text-xp-600', compact ? 'text-title' : 'text-balance')}>
            {total.toLocaleString()}
          </span>
          <span className="text-meta font-semibold uppercase tracking-wide text-xp-500">XP</span>
          {level != null && (
            <span className="rounded-full bg-xp-50 px-2 py-0.5 text-meta font-bold text-xp-700">Lv {level}</span>
          )}
        </div>
        {!compact && typeof levelProgress === 'number' && (
          <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-xp-50">
            <div
              className="h-full rounded-full bg-xp-400"
              style={{ width: `${Math.min(100, Math.max(0, levelProgress))}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export interface PointsDisplayProps {
  points: number;
  compact?: boolean;
  className?: string;
}

export function PointsDisplay({ points, compact = false, className }: PointsDisplayProps) {
  return (
    <div className={cn('flex items-center gap-2', className)} aria-label={`${points} points`}>
      <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-xl bg-xp-50 text-xp-500 dark:bg-xp-100 dark:text-xp-400">
        <Star size={18} className="fill-current" />
      </span>
      <div>
        <span className={cn('font-balance tabular-nums qk-text-primary', compact ? 'text-card-title' : 'text-title')}>
          {points.toLocaleString()}
        </span>
        <span className="ml-1.5 text-meta font-semibold uppercase tracking-wide qk-text-secondary">pts</span>
      </div>
    </div>
  );
}

export interface StreakDisplayProps {
  days: number;
  className?: string;
}

export function StreakDisplay({ days, className }: StreakDisplayProps) {
  const lit = days > 0;
  return (
    <div className={cn('flex items-center gap-2', className)} aria-label={`${days} day streak`}>
      <span
        aria-hidden="true"
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-xl',
          lit ? 'bg-streak-50 text-streak-500' : 'qk-bg-inset qk-text-secondary',
        )}
      >
        <Flame size={18} className={lit ? 'fill-current' : ''} />
      </span>
      <div>
        <span className="font-balance tabular-nums qk-text-primary">{days}</span>
        <span className="ml-1.5 text-meta font-semibold uppercase tracking-wide qk-text-secondary">
          day{days === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}

export interface BalanceChipProps {
  /** Balance in pence. Always rendered as real money (£x.yy) — never a bare number. */
  balancePence: number;
  symbol?: string;
  className?: string;
}

/** Compact real-money chip. Mint identity is reserved for actual money. */
export function BalanceChip({ balancePence, symbol = '£', className }: BalanceChipProps) {
  const safe = Number.isFinite(balancePence) ? balancePence : 0;
  const formatted = `${symbol}${(safe / 100).toFixed(2)}`;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-mint-50 py-1 pl-1.5 pr-3',
        className,
      )}
      aria-label={`Wallet balance ${formatted}`}
    >
      <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-mint-500 text-white">
        <Wallet size={13} />
      </span>
      <span className="font-balance text-base tabular-nums font-extrabold text-mint-700">{formatted}</span>
    </span>
  );
}
