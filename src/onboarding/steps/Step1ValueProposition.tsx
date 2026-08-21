import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { OnboardingCard } from '../components/OnboardingCard';
import { OnboardingActions } from '../components/OnboardingActions';
import { Check, PiggyBank, Star } from 'lucide-react';

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
      <div className="mt-5 rounded-2xl border border-amber-100 bg-gradient-to-r from-amber-50 to-white px-4 py-3 shadow-sm dark:border-amber-500/20 dark:from-amber-500/10 dark:to-slate-900">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-white shadow-md shadow-amber-500/20"><Star className="h-5 w-5" fill="currentColor" /></span>
          <p className="text-sm font-semibold leading-snug text-amber-950 dark:text-white">{t('s1.weeklySummary', { count: 12, points: 240, saved: '£8' })}</p>
          <span aria-hidden="true" className="ml-auto hidden items-center gap-1 text-emerald-600 dark:text-emerald-300 sm:flex"><Check className="h-4 w-4" /><PiggyBank className="h-5 w-5" /></span>
        </div>
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
