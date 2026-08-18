import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { OnboardingCard } from '../components/OnboardingCard';
import type { OnboardingDraft } from '../lib/onboardingDraft';

interface Step3Props {
  draft: OnboardingDraft;
  patch: (partial: Partial<OnboardingDraft>) => void;
  onNext: () => void;
  onBack: () => void;
}

const RELATIONSHIP_OPTIONS: Array<{
  key: 'mum' | 'dad' | 'parent' | 'carer' | 'grandparent' | 'other';
  value: string;
}> = [
  { key: 'mum', value: 'mum' },
  { key: 'dad', value: 'dad' },
  { key: 'parent', value: 'parent' },
  { key: 'carer', value: 'carer' },
  { key: 'grandparent', value: 'grandparent' },
  { key: 'other', value: 'other' },
];

export function Step3Relationship({ draft, patch, onNext, onBack }: Step3Props) {
  const { t } = useTranslation('onboarding');
  const selected = draft.parentRoleDisplay;

  return (
    <OnboardingCard>
      <h1 className="text-2xl font-extrabold text-gray-900">{t('s3.title')}</h1>
      <div role="radiogroup" aria-label={t('s3.title')} className="mt-5 grid grid-cols-2 gap-2">
        {RELATIONSHIP_OPTIONS.map(option => {
          const isSelected = selected === option.value;
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => patch({ parentRoleDisplay: option.value })}
              className={[
                'min-h-[44px] rounded-xl border px-4 py-3 text-base font-semibold transition-colors',
                isSelected
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-primary-300',
              ].join(' ')}
            >
              {t(`s3.options.${option.key}`)}
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-gray-500">{t('s3.reassurance')}</p>
      <div className="mt-6 flex items-center gap-3">
        <Button variant="secondary" onClick={onBack}>
          {t('s3.back')}
        </Button>
        <Button size="lg" className="flex-1" disabled={!selected} onClick={onNext}>
          {t('s3.continue')}
        </Button>
      </div>
    </OnboardingCard>
  );
}
