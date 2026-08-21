import type { ReactNode } from 'react';

interface OnboardingCardProps {
  children: ReactNode;
  className?: string;
}

/** Rounded Queki-native card used to frame each onboarding step. */
export function OnboardingCard({ children, className }: OnboardingCardProps) {
  return (
    <div
      className={[
        'rounded-[1.75rem] border border-white/80 bg-white/90 p-6 shadow-[0_24px_70px_-38px_rgba(15,23,42,0.45)] backdrop-blur-sm sm:p-8',
        'dark:border-slate-700/80 dark:bg-slate-900/90 dark:shadow-[0_24px_70px_-38px_rgba(0,0,0,0.8)]',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </div>
  );
}
