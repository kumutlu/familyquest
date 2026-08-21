import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { OnboardingCard } from '../components/OnboardingCard';
import type { OnboardingDraft } from '../lib/onboardingDraft';

interface Step6Props {
  draft: OnboardingDraft;
  patch: (partial: Partial<OnboardingDraft>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step6FamilyName({ draft, patch, onNext, onBack }: Step6Props) {
  const { t } = useTranslation('onboarding');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const value = draft.familyName;
  const canContinue = value.trim().length > 0;

  // A suggestion may be shown, but it is never persisted without explicit user
  // confirmation (tapping the chip). It is fully editable and optional.
  const suggestion = draft.parentFirstName.trim()
    ? t('s6.suggestion', { family: `${draft.parentFirstName.trim()}'s Family` })
    : '';

  return (
    <OnboardingCard>
      <h1 className="text-2xl font-extrabold text-gray-900 dark:text-slate-50 sm:text-3xl">{t('s6.title')}</h1>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canContinue) onNext();
        }}
      >
        <div>
          <label htmlFor="family-name" className="block text-sm font-semibold text-gray-700 dark:text-slate-300">
            {t('s6.label')}
          </label>
          <input
            id="family-name"
            ref={inputRef}
            type="text"
            required
            value={value}
            onChange={(event) => patch({ familyName: event.target.value })}
            placeholder={t('s6.placeholder')}
            className="mt-2 block min-h-12 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-100 dark:focus-visible:ring-offset-slate-900"
          />
        </div>
        {suggestion ? (
          <button
            type="button"
            onClick={() => patch({ familyName: `${draft.parentFirstName.trim()}'s Family` })}
            className="inline-flex min-h-11 items-center rounded-full border border-primary-200 bg-primary-50 px-4 py-2 text-sm font-semibold text-primary-700 hover:bg-primary-100 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-200"
          >
            {suggestion}
          </button>
        ) : null}
        <div className="flex flex-col gap-3 min-[400px]:flex-row min-[400px]:items-center">
          <Button variant="secondary" onClick={onBack}>
            {t('s6.back')}
          </Button>
          <Button type="submit" size="lg" className="flex-1" disabled={!canContinue}>
            {t('s6.continue')}
          </Button>
        </div>
      </form>
    </OnboardingCard>
  );
}
