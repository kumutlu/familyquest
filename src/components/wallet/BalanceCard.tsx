import { useEffect, useRef, useState } from 'react';
import { Wallet as WalletIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatPence, currencyCodeFromSymbol } from '../../i18n/format';
import { QUEKI_MOTION, prefersReducedMotion } from '../../design/motion';

interface BalanceCardProps {
  balance?: number;
  currency?: string;
  loading?: boolean;
  unavailable?: boolean;
}

/**
 * Count up/down to a new AUTHORITATIVE balance. The store value is always the
 * source of truth; this only animates the *displayed* number between two
 * confirmed values (never renders an unconfirmed optimistic balance as final).
 * Collapses to an instant switch under reduced motion.
 */
function useAnimatedBalance(target: number): number {
  const [displayed, setDisplayed] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    if (prefersReducedMotion()) {
      fromRef.current = target;
      setDisplayed(target);
      return;
    }
    const duration = QUEKI_MOTION.duration.balanceCount;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(from + (target - from) * eased));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      fromRef.current = target;
    };
  }, [target]);

  return displayed;
}

// Prominent "Available balance" hero — Queki v2 Wave 3 mint identity (real
// money is mint/green and never visually merged with points or XP). Canonical
// source is families/{familyId}/wallets/{childId}.balance (passed as `balance`).
export function BalanceCard({ balance, currency = '£', loading, unavailable }: BalanceCardProps) {
  const { t } = useTranslation('wallet');
  const animated = useAnimatedBalance(unavailable ? 0 : balance ?? 0);

  if (loading) {
    return (
      <section
        aria-label={t('balanceCard.label')}
        className="rounded-card bg-gradient-to-br from-mint-600 to-mint-800 p-6 text-white qk-shadow-card relative overflow-hidden"
      >
        <div className="absolute -top-10 -right-10 opacity-10">
          <WalletIcon size={140} strokeWidth={1} aria-hidden="true" />
        </div>
        <div className="relative z-10">
          <div className="h-4 w-28 rounded bg-white/20 animate-pulse" />
          <div className="mt-3 h-10 w-44 rounded bg-white/20 animate-pulse" />
          <div className="mt-3 h-3 w-32 rounded bg-white/10 animate-pulse" />
        </div>
        <span className="sr-only" role="status">{t('balanceCard.loading')}</span>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="balance-label"
      data-testid="wallet-balance-hero"
      className="rounded-card bg-gradient-to-br from-mint-500 to-mint-700 p-6 text-white qk-shadow-card relative overflow-hidden"
    >
      <div className="absolute -top-10 -right-10 opacity-10" aria-hidden="true">
        <WalletIcon size={140} strokeWidth={1} />
      </div>
      <div className="relative z-10">
        <p id="balance-label" className="text-white/80 font-medium text-sm uppercase tracking-wider">
          {t('balanceCard.walletName')}
        </p>
        <p
          className="mt-1 text-4xl font-extrabold tracking-tight tabular-nums"
          aria-live="polite"
          data-testid="wallet-balance-value"
        >
          {unavailable ? t('balanceCard.unavailable') : formatPence(animated, currencyCodeFromSymbol(currency))}
        </p>
        <p className="mt-2 text-xs text-white/70">{t('balanceCard.label')}</p>
      </div>
    </section>
  );
}
