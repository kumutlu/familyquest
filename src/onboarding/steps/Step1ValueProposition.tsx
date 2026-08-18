import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { OnboardingCard } from '../components/OnboardingCard';

interface Step1Props {
  onNext: () => void;
  onLogin: () => void;
}

const FLOATING_CARDS = [
  'Make your bed · +10 pts',
  'Homework · Completed',
  'New bike · £35 / £100',
  'Movie night · 150 pts',
];

export function Step1ValueProposition({ onNext, onLogin }: Step1Props) {
  const { t } = useTranslation('onboarding');
  return (
    <OnboardingCard>
      <p className="text-sm font-bold tracking-tight text-primary-600">{t('s1.eyebrow')}</p>
      <h1 className="mt-2 text-3xl font-extrabold text-gray-900 leading-tight">
        {t('s1.title')}
      </h1>
      <p className="mt-3 text-base text-gray-600">{t('s1.subtitle')}</p>

      {/* Decorative floating mini-cards — purely illustrative, hidden from AT. */}
      <div aria-hidden="true" className="mt-6 grid grid-cols-2 gap-2">
        {FLOATING_CARDS.map(card => (
          <div
            key={card}
            className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-[13px] font-semibold text-amber-800"
          >
            {card}
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600">
        {t('s1.weeklySummary', { count: 12, points: 240, saved: '£8' })}
      </div>

      <div className="mt-6 space-y-3">
        <Button size="lg" fullWidth onClick={onNext}>
          {t('s1.cta')}
        </Button>
        <button
          type="button"
          onClick={onLogin}
          className="w-full text-center text-sm text-gray-500 hover:text-gray-700 underline"
        >
          {t('s1.secondary')}
        </button>
      </div>
    </OnboardingCard>
  );
}
