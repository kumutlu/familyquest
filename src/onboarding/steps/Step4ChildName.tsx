import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { OnboardingCard } from '../components/OnboardingCard';
import type { OnboardingDraft } from '../lib/onboardingDraft';

interface Step4Props {
  draft: OnboardingDraft;
  patch: (partial: Partial<OnboardingDraft>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step4ChildName({ draft, patch, onNext, onBack }: Step4Props) {
  const { t } = useTranslation('onboarding');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const value = draft.childFirstName;
  const canContinue = value.trim().length > 0;

  return (
    <OnboardingCard>
      <h1 className="text-2xl font-extrabold text-gray-900">{t('s4.title')}</h1>
      <p className="mt-2 text-base text-gray-600">{t('s4.body')}</p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canContinue) onNext();
        }}
      >
        <div>
          <label htmlFor="child-first-name" className="block text-sm font-medium text-gray-700">
            {t('s4.label')}
          </label>
          <input
            id="child-first-name"
            ref={inputRef}
            type="text"
            autoComplete="off"
            required
            value={value}
            onChange={(event) => patch({ childFirstName: event.target.value })}
            placeholder={t('s4.placeholder')}
            className="mt-1 block w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          />
        </div>
        <p role="note" className="text-sm text-gray-500">
          {t('s4.privacyNote')}
        </p>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={onBack}>
            {t('s4.back')}
          </Button>
          <Button type="submit" size="lg" className="flex-1" disabled={!canContinue}>
            {t('s4.continue')}
          </Button>
        </div>
      </form>
    </OnboardingCard>
  );
}
