import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { OnboardingCard } from '../components/OnboardingCard';
import type { OnboardingDraft } from '../lib/onboardingDraft';
import { Baby, HeartHandshake, House, ShieldCheck, Sparkles, UsersRound } from 'lucide-react';
import { OnboardingChoiceCard } from '../components/OnboardingChoiceCard';
import { OnboardingActions } from '../components/OnboardingActions';

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

const OPTION_ICONS = {
  mum: HeartHandshake,
  dad: ShieldCheck,
  parent: UsersRound,
  carer: Baby,
  grandparent: House,
  other: Sparkles,
};

export function Step3Relationship({ draft, patch, onNext, onBack }: Step3Props) {
  const { t } = useTranslation('onboarding');
  const selected = draft.parentRoleDisplay;

  return (
    <OnboardingCard>
      <h1 className="text-2xl font-extrabold text-gray-900 dark:text-slate-50 sm:text-3xl">{t('s3.title')}</h1>
      <div role="radiogroup" aria-label={t('s3.title')} className="mt-5 grid grid-cols-1 gap-2 min-[430px]:grid-cols-2">
        {RELATIONSHIP_OPTIONS.map(option => {
          const isSelected = selected === option.value;
          const Icon = OPTION_ICONS[option.key];
          return (
            <OnboardingChoiceCard
              key={option.key}
              label={t(`s3.options.${option.key}`)}
              icon={<Icon className="h-5 w-5" />}
              selected={isSelected}
              onSelect={() => patch({ parentRoleDisplay: option.value })}
            />
          );
        })}
      </div>
      <p className="mt-4 rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:bg-slate-800/70 dark:text-slate-300">{t('s3.reassurance')}</p>
      <OnboardingActions
        secondary={<Button variant="secondary" onClick={onBack}>
          {t('s3.back')}
        </Button>}
        primary={<Button size="lg" fullWidth disabled={!selected} onClick={onNext}>
          {t('s3.continue')}
        </Button>}
      />
    </OnboardingCard>
  );
}
