import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

/**
 * <XpPop /> — a lightweight "you earned XP" toast animation.
 *
 * Architectural rules
 * -------------------
 *  - Presentational only. NEVER writes to authoritative state.
 *  - The host owns the trigger: when the parent decides an XP delta
 *    occurred, it renders an `<XpPop />` instance with the delta. The
 *    animation lifecycle is fully local.
 *  - Respects `prefers-reduced-motion` via the `--animate-duration-*`
 *    tokens (the toast's enter/exit collapse to ~0ms in that mode).
 *  - Currency identity: gold (xp) is reserved for XP. NEVER use this
 *    component for points or wallet money.
 *
 * Semantic variants
 * -----------------
 *  - `generic`  — default gold pop, "Awarded X XP".
 *  - `mystery`  — same visual; copy becomes "Mystery +X XP".
 *  - `comeback` — same visual; copy becomes "Comeback +X XP".
 *  - `reverse`  — coral, "−X XP" wording, downward drift.
 *
 *  The variant is a PRESENTATION CHOICE only. The amount and the
 *  decision to fire it are always authoritative. The host passes both.
 */

export type XpPopVariant = 'generic' | 'mystery' | 'comeback' | 'reverse';

export interface XpPopProps {
  /**
   * The amount of XP that was just awarded. Positive or zero. Negative
   * deltas (reversals) should use `<XpPop />` with `variant="reverse"` —
   * the host SHOULD hide the pop when the delta is exactly zero.
   */
  readonly amount: number;
  /** Visible flag. When false, the component renders nothing. */
  readonly visible: boolean;
  /**
   * Visual variant.
   *   - `generic`   → gold pop, "Awarded X XP" (default)
   *   - `mystery`   → gold pop, "Mystery +X XP"
   *   - `comeback`  → gold pop, "Comeback +X XP"
   *   - `reverse`   → coral pop, "−X XP" wording
   */
  readonly variant?: XpPopVariant;
  /**
   * Optional aria label override. The default is sourced from i18n.
   */
  readonly ariaLabel?: string;
  /** Optional layout class. */
  readonly className?: string;
}

const VISIBLE_MS = 1600;

/**
 * Render the XP-pop toast. Pure presentation. No timers leak across
 * unmounts: every started timeout is tracked and cleared on cleanup.
 */
export function XpPop({
  amount,
  visible,
  variant = 'generic',
  ariaLabel,
  className,
}: XpPopProps) {
  const { t } = useTranslation('home');
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (!visible) {
      setMounted(false);
      return undefined;
    }
    setMounted(true);
    if (typeof window === 'undefined') return undefined;
    const handle = window.setTimeout(() => setMounted(false), VISIBLE_MS);
    return () => window.clearTimeout(handle);
  }, [visible, amount, variant]);

  if (!mounted) return null;
  const safeAmount = Math.max(0, Math.floor(Number.isFinite(amount) ? amount : 0));
  const isReverse = variant === 'reverse';
  const sign = isReverse ? '−' : '+';

  // i18n-aware copy. Always English + Turkish available.
  let label: string;
  if (ariaLabel) {
    label = ariaLabel;
  } else if (isReverse) {
    label = t('child.xpPop.removed', { amount: safeAmount });
  } else if (variant === 'mystery') {
    label = t('child.xpPop.mysteryAwarded', { amount: safeAmount });
  } else if (variant === 'comeback') {
    label = t('child.xpPop.comebackAwarded', { amount: safeAmount });
  } else {
    label = t('child.xpPop.awarded', { amount: safeAmount });
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="xp-pop"
      data-xp-variant={variant}
      data-xp-amount={safeAmount}
      className={cn(
        'pointer-events-none inline-flex select-none items-center gap-1.5 rounded-full px-3 py-1.5 font-bold shadow-lg',
        'animate-[xp-pop-enter_var(--animate-duration-celebration,700ms)_var(--ease-celebrate,cubic-bezier(0.34,1.56,0.64,1))]',
        isReverse
          ? 'bg-coral-50 text-coral-700 ring-1 ring-coral-200'
          : 'bg-xp-500 text-white ring-1 ring-xp-600',
        className,
      )}
      aria-label={label}
    >
      <span aria-hidden="true" className="text-base tabular-nums">
        {sign}
        {safeAmount.toLocaleString()}
      </span>
      <span aria-hidden="true" className="text-meta font-semibold uppercase tracking-wide">
        XP
      </span>
      {!isReverse && (
        <span aria-hidden="true" className="text-meta">
          ✨
        </span>
      )}
    </div>
  );
}

export default XpPop;