import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { OnboardingCard } from '../components/OnboardingCard';
import type { OnboardingDraft } from '../lib/onboardingDraft';

interface Step2Props {
  draft: OnboardingDraft;
  patch: (partial: Partial<OnboardingDraft>) => void;
  onNext: () => void;
  onSignOut: () => void;
}

export function Step2ParentName({ draft, patch, onNext, onSignOut }: Step2Props) {
  const { t } = useTranslation('onboarding');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const value = draft.parentFirstName;
  const canContinue = value.trim().length > 0;

  return (
    <OnboardingCard>
      <h1 className="text-2xl font-extrabold text-gray-900">{t('s2.title')}</h1>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canContinue) onNext();
        }}
      >
        <div>
          <label htmlFor="parent-first-name" className="block text-sm font-medium text-gray-700">
            {t('s2.label')}
          </label>
          <input
            id="parent-first-name"
            ref={inputRef}
            type="text"
            autoComplete="given-name"
            required
            value={value}
            onChange={(event) => patch({ parentFirstName: event.target.value })}
            placeholder={t('s2.placeholder')}
            className="mt-1 block w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" size="lg" className="flex-1" disabled={!canContinue}>
            {t('s2.continue')}
          </Button>
        </div>
      </form>
      <button
        type="button"
        onClick={onSignOut}
        className="mt-4 w-full text-center text-sm text-gray-400 hover:text-gray-600"
      >
        {t('s2.signOut')}
      </button>
    </OnboardingCard>
  );
}
