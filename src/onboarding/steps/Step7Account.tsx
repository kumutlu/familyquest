import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { GoogleButton } from '../../components/ui/GoogleButton';
import { OnboardingCard } from '../components/OnboardingCard';
import { OnboardingError } from '../components/OnboardingError';
import type { OnboardingDraft } from '../lib/onboardingDraft';

interface Step7Props {
  draft: OnboardingDraft;
  onGoogle: () => void;
  onEmail: () => void;
  /** Localised auth error (cancelled/failed), if any. */
  authError: string | null;
  onStartOver: () => void;
  onBack: () => void;
}

export function Step7Account({ draft, onGoogle, onEmail, authError, onStartOver, onBack }: Step7Props) {
  const { t } = useTranslation('onboarding');

  const parent = draft.parentFirstName.trim() || '—';
  const relationshipLabel = draft.parentRoleDisplay
    ? t(`s3.options.${draft.parentRoleDisplay as 'mum' | 'dad' | 'parent' | 'carer' | 'grandparent' | 'other'}`)
    : t('s3.options.parent');
  const child = draft.childFirstName.trim() || '—';
  const family = draft.familyName.trim() || '—';

  if (authError) {
    return (
      <OnboardingCard>
        <OnboardingError message={authError} onRetry={onGoogle} onBack={onBack} onStartOver={onStartOver} />
      </OnboardingCard>
    );
  }

  return (
    <OnboardingCard>
      <h1 className="text-2xl font-extrabold text-gray-900 dark:text-slate-50 sm:text-3xl">{t('s7.title')}</h1>

      <div className="mt-4 space-y-2 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-amber-50 p-4 text-sm dark:border-indigo-500/20 dark:from-indigo-500/10 dark:to-amber-500/5">
        <p className="font-semibold text-gray-800 dark:text-slate-100">
          {t('s7.summaryParent', { parent, relationship: relationshipLabel })}
        </p>
        <p className="text-gray-600 dark:text-slate-300">{t('s7.summaryChild', { child })}</p>
        <p className="text-gray-600 dark:text-slate-300">{t('s7.summaryFamily', { family })}</p>
      </div>

      <p className="mt-4 text-sm text-gray-600 dark:text-slate-300">{t('s7.body')}</p>

      <div className="mt-5 space-y-3">
        {/* Only the providers the app actually implements: Google + Email.
            Apple is intentionally NOT offered (deferred product decision). */}
        <GoogleButton onClick={onGoogle}>
          {t('s7.google')}
        </GoogleButton>
        <Button size="lg" variant="secondary" fullWidth onClick={onEmail}>
          {t('s7.email')}
        </Button>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          {t('s7.back')}
        </button>
        <button
          type="button"
          onClick={onStartOver}
          className="text-sm text-gray-400 hover:text-gray-600 underline"
        >
          {t('s7.startOver')}
        </button>
      </div>
    </OnboardingCard>
  );
}
