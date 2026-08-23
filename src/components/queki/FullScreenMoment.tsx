import { cn } from '../../lib/utils';

export interface FullScreenMomentProps {
  children: React.ReactNode;
  /** Visual mood of the moment; drives the backdrop identity. */
  tone?: 'brand' | 'xp' | 'mint' | 'coral' | 'streak' | 'family';
  className?: string;
}

const TONES: Record<NonNullable<FullScreenMomentProps['tone']>, string> = {
  brand: 'from-primary-600 to-violet-600',
  xp: 'from-xp-500 to-streak-500',
  mint: 'from-mint-500 to-family-600',
  coral: 'from-coral-500 to-coral-700',
  streak: 'from-streak-500 to-coral-600',
  family: 'from-family-500 to-primary-600',
};

/**
 * Full-screen momentary shell for celebrations / big transitions (level-up,
 * reward unlocked). Wave 1 ships the shell only — flows adopt it in later waves.
 * Content is centred, safe-area aware, and rendered above a brand gradient.
 */
export function FullScreenMoment({ children, tone = 'brand', className }: FullScreenMomentProps) {
  return (
    <div
      role="status"
      className={cn(
        'fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-gradient-to-br p-8 text-white',
        'pb-[calc(2rem+env(safe-area-inset-bottom))]',
        TONES[tone],
        className,
      )}
      style={{ animation: 'qk-moment-in var(--animate-duration-enter) var(--ease-enter) both' }}
    >
      <style>{`@keyframes qk-moment-in { from { opacity: 0 } to { opacity: 1 } }`}</style>
      {children}
    </div>
  );
}
