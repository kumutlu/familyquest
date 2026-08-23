import React from 'react';
import { cn } from '../../lib/utils';
import { TactileCard, type TactileCardProps } from './TactileCard';
import type { QuekiProgressTone } from './Progress';

const TONE_RING: Record<QuekiProgressTone, string> = {
  brand: 'bg-primary-50 text-primary-600',
  xp: 'bg-xp-50 text-xp-500',
  mint: 'bg-mint-50 text-mint-600',
  coral: 'bg-coral-50 text-coral-500',
  streak: 'bg-streak-50 text-streak-500',
  family: 'bg-family-50 text-family-600',
};

export interface LivingHomeCardProps extends Omit<TactileCardProps, 'tone' | 'children'> {
  icon?: React.ReactNode;
  tone?: QuekiProgressTone;
  title: React.ReactNode;
  description?: React.ReactNode;
  trailing?: React.ReactNode;
}

/**
 * One dynamic "what matters right now" card on a Living Home.
 * Icon + title + optional description + optional trailing element, wrapped in
 * a tactile pressable card when `onPress` is provided.
 */
export function LivingHomeCard({ icon, tone = 'brand', title, description, trailing, className, ...rest }: LivingHomeCardProps) {
  return (
    <TactileCard tone={tone} className={cn('flex items-center gap-4 p-4', className)} {...rest}>
      {icon != null && (
        <span
          aria-hidden="true"
          className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', TONE_RING[tone])}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-card-title qk-text-primary">{title}</p>
        {description != null && <p className="mt-0.5 text-meta qk-text-secondary">{description}</p>}
      </div>
      {trailing != null && <div className="shrink-0">{trailing}</div>}
    </TactileCard>
  );
}
