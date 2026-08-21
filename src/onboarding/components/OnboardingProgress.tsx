import { useTranslation } from 'react-i18next';

interface OnboardingProgressProps {
  /** 1-based current step. */
  current: number;
  /** Total number of steps in the visible phase. */
  total: number;
  /** i18n key for the accessible step label (defaults to the pre-auth label). */
  labelKey?: 'meta.stepLabel' | 'meta.continuationLabel';
}

/**
 * Semantic, accessible progress indicator. Uses an ordered list with
 * `aria-current="step"` on the active item and a visually-hidden `aria-live`
 * region announcing step changes. Purely presentational — the container decides
 * the current/total numbers.
 */
export function OnboardingProgress({ current, total, labelKey = 'meta.stepLabel' }: OnboardingProgressProps) {
  const { t } = useTranslation('onboarding');
  const clampedCurrent = Math.min(Math.max(current, 1), total);

  return (
    <nav aria-label={t(labelKey, { current: clampedCurrent, total })} className="mb-4">
      <ol className="flex items-center justify-center gap-2 lg:justify-start" aria-hidden={false}>
        {Array.from({ length: total }, (_, index) => {
          const stepNumber = index + 1;
          const isActive = stepNumber === clampedCurrent;
          const isComplete = stepNumber < clampedCurrent;
          return (
            <li
              key={stepNumber}
              aria-current={isActive ? 'step' : undefined}
              className={[
                'h-2 rounded-full transition-[width,background-color] duration-200 motion-reduce:transition-none',
                isActive
                  ? 'w-8 bg-primary-500 dark:bg-indigo-400'
                  : isComplete
                    ? 'w-3 bg-primary-200 dark:bg-indigo-700'
                    : 'w-3 bg-gray-200 dark:bg-slate-700',
              ].join(' ')}
            />
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite">
        {t(labelKey, { current: clampedCurrent, total })}
      </p>
    </nav>
  );
}
