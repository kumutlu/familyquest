import React from 'react';
import { cn } from '../../lib/utils';
import { triggerHaptic } from '../../lib/interaction/haptics';
import { playCue } from '../../lib/interaction/sound';

export interface TactileButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Visual family. Semantic variants map to Queki v2 identities:
   * `xp` (gold), `mint` (wallet/money), `coral` (rewards).
   */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'xp' | 'mint' | 'coral';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  /** Shows an accessible spinner and disables interaction. */
  loading?: boolean;
  /** Fires subtle haptic + optional sound feedback on press (opt-out-able). */
  feedback?: 'haptic' | 'none';
}

/**
 * Queki v2 tactile button.
 *
 * A real `<button>` (never a div click-handler): keyboard operable, focus-visible
 * ring, disabled/loading semantics for free. The "tactile" quality comes from a
 * hard bottom edge that collapses on `:active` — the button visibly depresses
 * under the finger — plus optional subtle haptics/sound.
 */
export function TactileButton({
  className,
  variant = 'primary',
  size = 'md',
  fullWidth,
  loading = false,
  feedback = 'haptic',
  disabled,
  onPointerDown,
  children,
  type = 'button',
  ...props
}: TactileButtonProps) {
  const inactive = disabled || loading;

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!inactive && feedback === 'haptic') {
      triggerHaptic('tap');
      playCue('tap');
    }
    onPointerDown?.(event);
  };

  const base =
    'relative inline-flex items-center justify-center gap-2 rounded-xl font-button select-none ' +
    'transition-[transform,box-shadow,background-color] duration-[var(--animate-duration-tap)] ease-tap ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ' +
    'disabled:opacity-50 disabled:pointer-events-none';

  // Tactile depression: a solid "edge" shadow that collapses while pressed.
  const variants = {
    primary:
      'bg-primary-500 text-white shadow-[0_4px_0_0_var(--color-primary-700)] hover:bg-primary-600 active:translate-y-[3px] active:shadow-[0_1px_0_0_var(--color-primary-700)]',
    secondary:
      'qk-bg-raised qk-text-primary border qk-border-subtle shadow-[0_4px_0_0_rgba(23,21,31,0.08)] active:translate-y-[3px] active:shadow-[0_1px_0_0_rgba(23,21,31,0.08)]',
    ghost: 'qk-text-secondary bg-transparent hover:bg-black/5 dark:hover:bg-white/10 active:scale-[0.98]',
    danger:
      'bg-danger-500 text-white shadow-[0_4px_0_0_var(--color-danger-600)] hover:bg-danger-600 active:translate-y-[3px] active:shadow-[0_1px_0_0_var(--color-danger-600)]',
    xp: 'bg-xp-400 text-xp-700 shadow-[0_4px_0_0_var(--color-xp-600)] hover:bg-xp-300 active:translate-y-[3px] active:shadow-[0_1px_0_0_var(--color-xp-600)]',
    mint: 'bg-mint-500 text-white shadow-[0_4px_0_0_var(--color-mint-700)] hover:bg-mint-600 active:translate-y-[3px] active:shadow-[0_1px_0_0_var(--color-mint-700)]',
    coral:
      'bg-coral-500 text-white shadow-[0_4px_0_0_var(--color-coral-700)] hover:bg-coral-600 active:translate-y-[3px] active:shadow-[0_1px_0_0_var(--color-coral-700)]',
  } as const;

  const sizes = {
    sm: 'min-h-9 px-3 text-sm',
    md: 'min-h-11 px-5',
    lg: 'min-h-13 px-7 text-base rounded-2xl',
  } as const;

  return (
    <button
      type={type}
      className={cn(base, variants[variant], sizes[size], fullWidth && 'w-full', className)}
      disabled={inactive}
      aria-busy={loading || undefined}
      onPointerDown={handlePointerDown}
      {...props}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}
