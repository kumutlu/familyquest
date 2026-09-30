import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { OnboardingCard } from '../components/OnboardingCard';
import { MiniJourney } from '../components/MiniJourney';
import type { OnboardingDraft } from '../lib/onboardingDraft';

interface Step5Props {
  draft: OnboardingDraft;
  onNext: () => void;
  onBack: () => void;
}

export function Step5MiniJourney({ draft, onNext, onBack }: Step5Props) {
  const { t } = useTranslation('onboarding');
  return (
    <OnboardingCard>
      <h1 className="text-2xl font-extrabold text-gray-900 dark:text-slate-50 sm:text-3xl">{t('s5.title')}</h1>
      <div className="mt-4">
        <MiniJourney childName={draft.childFirstName || 'your child'} />
      </div>
      <div className="mt-6 flex flex-col gap-3 min-[400px]:flex-row min-[400px]:items-center">
        <Button variant="secondary" onClick={onBack}>
          {t('s5.back')}
        </Button>
        <Button size="lg" className="flex-1" onClick={onNext}>
          {t('s5.continue')}
        </Button>
      </div>
    </OnboardingCard>
  );
}
