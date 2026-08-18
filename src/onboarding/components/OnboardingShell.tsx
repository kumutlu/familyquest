import type { ReactNode } from 'react';

interface OnboardingShellProps {
  children: ReactNode;
  /** Optional progress indicator rendered above the step content. */
  progress?: ReactNode;
  /** Optional eyebrow / brand line. */
  eyebrow?: ReactNode;
}

/**
 * Warm, calm, mobile-first container for the onboarding flow. Caps width so the
 * mobile card never stretches across desktop, respects safe-area insets, and
 * uses `dvh` so mobile browser chrome never clips the sticky footer.
 */
export function OnboardingShell({ children, progress, eyebrow }: OnboardingShellProps) {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-amber-50 via-white to-white flex flex-col font-sans">
      <div className="mx-auto w-full max-w-md sm:max-w-lg lg:max-w-2xl px-4 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] flex flex-col flex-1">
        {eyebrow ? (
          <div className="text-center mb-4 text-sm font-bold tracking-tight text-primary-600">
            {eyebrow}
          </div>
        ) : null}
        {progress}
        <main className="flex-1 flex flex-col justify-center">{children}</main>
      </div>
    </div>
  );
}
