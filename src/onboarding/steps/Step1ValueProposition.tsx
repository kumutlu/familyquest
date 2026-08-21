import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { OnboardingCard } from '../components/OnboardingCard';
import { OnboardingActions } from '../components/OnboardingActions';

interface Step1Props {
  onNext: () => void;
  onLogin: () => void;
  onJoin: () => void;
}

export function Step1ValueProposition({ onNext, onLogin, onJoin }: Step1Props) {
  const { t } = useTranslation('onboarding');
  return (
    <OnboardingCard>
      <p className="text-sm font-bold tracking-tight text-primary-600 dark:text-indigo-300">{t('s1.eyebrow')}</p>
      <h1 className="mt-2 text-3xl font-extrabold leading-tight text-gray-900 dark:text-slate-50 sm:text-4xl">
        {t('s1.title')}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-gray-600 dark:text-slate-300">{t('s1.subtitle')}</p>
      <div className="mt-5 rounded-2xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm font-medium text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
        {t('s1.weeklySummary', { count: 12, points: 240, saved: '£8' })}
      </div>

      <OnboardingActions
        primary={<Button size="lg" fullWidth onClick={onNext}>
          {t('s1.cta')}
        </Button>}
        secondary={<Button size="lg" variant="secondary" fullWidth onClick={onJoin}>
          {t('s1.join')}
        </Button>}
        tertiary={<button
          type="button"
          onClick={onLogin}
          className="min-h-11 px-3 text-sm font-semibold text-gray-500 underline decoration-gray-300 underline-offset-4 hover:text-gray-700 dark:text-slate-400 dark:decoration-slate-600 dark:hover:text-slate-200"
        >
          {t('s1.secondary')}
        </button>}
      />
    </OnboardingCard>
  );
}
