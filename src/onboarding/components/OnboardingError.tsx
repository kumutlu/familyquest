import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Button } from '../../components/ui/Button';

interface OnboardingErrorProps {
  /** Already-localised, non-Firebase message. */
  message: string;
  /** Optional context heading so the error never appears context-less. */
  title?: string;
  onRetry?: () => void;
  onBack?: () => void;
  onStartOver?: () => void;
  /** When true, only Back/Start-over are offered (no retry). */
  retryLabel?: string;
}

/**
 * Shared, friendly error + recovery surface for the onboarding flow. Never
 * surfaces raw Firebase/error codes — callers must pass a localised message.
 */
export function OnboardingError({
  message,
  title,
  onRetry,
  onBack,
  onStartOver,
  retryLabel,
}: OnboardingErrorProps) {
  const { t } = useTranslation('onboarding');
  return (
    <div
      role="alert"
      className="rounded-2xl bg-red-50 border border-red-100 p-4 text-center"
    >
      <AlertTriangle className="w-8 h-8 text-danger-500 mx-auto mb-2" aria-hidden="true" />
      {title ? (
        <h2 className="text-base font-bold text-red-800 mb-1">{title}</h2>
      ) : null}
      <p className="text-sm text-red-700 mb-4">{message}</p>
      <div className="flex flex-col gap-2">
        {onRetry ? (
          <Button onClick={onRetry} fullWidth>
            {retryLabel ?? t('errors.retry')}
          </Button>
        ) : null}
        {onBack ? (
          <Button variant="secondary" onClick={onBack} fullWidth>
            {t('errors.back')}
          </Button>
        ) : null}
        {onStartOver ? (
          <button
            type="button"
            onClick={onStartOver}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            {t('errors.startOver')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
