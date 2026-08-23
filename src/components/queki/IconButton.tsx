import React from 'react';
import { cn } from '../../lib/utils';
import { triggerHaptic } from '../../lib/interaction/haptics';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — required; icon-only buttons must never be unnamed. */
  'aria-label': string;
  /** Visual tone of the hit area. */
  tone?: 'neutral' | 'brand';
}

/**
 * Square, touch-first icon button with a guaranteed ≥44px hit target and a
 * required accessible label. A real <button>: keyboard + screen-reader safe.
 */
export function IconButton({ className, tone = 'neutral', onPointerDown, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-11 w-11 items-center justify-center rounded-xl transition-colors duration-[var(--animate-duration-tap)] ease-tap',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
        'disabled:opacity-50 disabled:pointer-events-none',
        tone === 'brand'
          ? 'bg-primary-500 text-white hover:bg-primary-600'
          : 'qk-bg-inset qk-text-secondary hover:bg-black/5 dark:hover:bg-white/10',
        className,
      )}
      onPointerDown={event => {
        triggerHaptic('tap');
        onPointerDown?.(event);
      }}
      {...props}
    />
  );
}
