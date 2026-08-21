import type { ReactNode } from 'react';

interface OnboardingShellProps {
  children: ReactNode;
  /** Optional progress indicator rendered above the step content. */
  progress?: ReactNode;
  /** Optional eyebrow / brand line. */
  eyebrow?: ReactNode;
  visual?: ReactNode;
  compact?: boolean;
}

/**
 * Warm, calm, mobile-first container for the onboarding flow. Caps width so the
 * mobile card never stretches across desktop, respects safe-area insets, and
 * uses `dvh` so mobile browser chrome never clips the sticky footer.
 */
export function OnboardingShell({ children, progress, eyebrow, visual, compact = false }: OnboardingShellProps) {
  return (
    <div
      data-testid="onboarding-shell"
      className="relative min-h-dvh overflow-hidden bg-gradient-to-br from-amber-50 via-white to-indigo-50 font-sans text-slate-900 dark:bg-slate-950 dark:from-slate-950 dark:via-slate-950 dark:to-indigo-950 dark:text-slate-100"
    >
      <div aria-hidden="true" className="pointer-events-none absolute -left-32 top-12 h-72 w-72 rounded-full bg-amber-200/35 blur-3xl dark:bg-amber-500/10" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-28 bottom-0 h-80 w-80 rounded-full bg-indigo-300/35 blur-3xl dark:bg-indigo-500/15" />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[1440px] flex-col px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-6 lg:flex-row lg:items-stretch lg:px-10 lg:py-8">
        <section
          data-testid="onboarding-visual-region"
          className={[
            'flex w-full shrink-0 flex-col lg:w-[45%] lg:justify-center lg:pr-10 xl:pr-16',
            visual ? (compact ? 'min-h-[22dvh]' : 'min-h-[34dvh] sm:min-h-[36dvh]') : 'min-h-0 lg:min-h-full',
          ].join(' ')}
        >
          {eyebrow ? (
            <div className="mb-3 text-center text-sm font-extrabold tracking-tight text-primary-600 dark:text-indigo-300 lg:text-left">
              {eyebrow}
            </div>
          ) : null}
          {visual ? <div className="mx-auto w-full max-w-md lg:max-w-xl">{visual}</div> : null}
        </section>
        <main
          data-testid="onboarding-content-region"
          className="flex w-full flex-1 flex-col justify-end lg:w-[55%] lg:justify-center lg:pl-6"
        >
          <div className="mx-auto w-full max-w-[500px]">
            {progress}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
