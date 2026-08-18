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
      <h1 className="text-2xl font-extrabold text-gray-900">{t('s5.title')}</h1>
      <div className="mt-4">
        <MiniJourney childName={draft.childFirstName} />
      </div>
      <div className="mt-6 flex items-center gap-3">
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
