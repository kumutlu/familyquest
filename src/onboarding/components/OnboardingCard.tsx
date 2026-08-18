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
        'bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </div>
  );
}
