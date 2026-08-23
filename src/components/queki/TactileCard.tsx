import React from 'react';
import { cn } from '../../lib/utils';
import { triggerHaptic } from '../../lib/interaction/haptics';

export interface TactileCardProps {
  children: React.ReactNode;
  className?: string;
  /** When set the whole card becomes a real button that depresses on touch. */
  onPress?: () => void;
  /** Accessible name for pressable cards. */
  'aria-label'?: string;
  tone?: 'neutral' | 'xp' | 'mint' | 'coral' | 'streak' | 'family' | 'brand';
}

const TONES: Record<NonNullable<TactileCardProps['tone']>, string> = {
  neutral: '',
  brand: 'border-l-4 border-l-primary-500',
  xp: 'border-l-4 border-l-xp-400',
  mint: 'border-l-4 border-l-mint-500',
  coral: 'border-l-4 border-l-coral-500',
  streak: 'border-l-4 border-l-streak-500',
  family: 'border-l-4 border-l-family-500',
};

/**
 * Queki v2 card. Static by default; with `onPress` it renders a real
 * `<button>` so keyboard/screen-reader users get the same affordance as
 * pointer users, with a visible depression on press.
 */
export function TactileCard({
  children,
  className,
  onPress,
  tone = 'neutral',
  ...rest
}: TactileCardProps) {
  const shell = cn(
    'rounded-card qk-bg-card qk-border-subtle qk-shadow-card border text-left',
    TONES[tone],
    className,
  );

  if (!onPress) {
    return (
      <div className={shell} {...rest}>
        {children}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onPress}
      onPointerDown={() => triggerHaptic('tap')}
      className={cn(
        shell,
        'w-full cursor-pointer transition-transform duration-[var(--animate-duration-tap)] ease-tap',
        'hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
